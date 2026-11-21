// The match state machine. Pure: time is passed in, ids come from an injectable factory.
//
//   idle ──warmup──▶ warmup ──live──▶ in_match (round loop) ──gameover──▶ gameover ─▶ persist
//                                        │
//                                        └─ no in-match data for INCOMPLETE_TIMEOUT ─▶ persist
//                                           as incomplete (resumable on reconnect)
//
// GSI sends no match id, so we mint one when a match starts. A reconnect to the same match
// (same map and mode, score carried on, within the resume window) reuses the same id, and
// persistence upserts by id, so a match is never saved twice.
import type { GsiPayload } from './schema.ts';
import {
	MATCH_RECORD_VERSION,
	damageTotals,
	derivedRates,
	type MatchRecord,
	type RoundRecord,
	type SightingRecord
} from '#lib/match-record.ts';
import { asSide, type Side } from '#lib/cs2/rounds.ts';
import { isObserverPayload, isSelf, playerSide, scoreSum, spectatedPlayer } from './payload.ts';
import { RoundBuilder, reconcileWithRoundWins } from './round-builder.ts';

export interface TrackerOptions {
	/** The SteamID64 we record for. Payloads from any other account are ignored. */
	steamId: string | null;
	incompleteTimeoutMs: number;
	/** How long after an incomplete save a reconnect may still resume the same match. */
	resumeWindowMs?: number;
	appVersion?: string;
	newId?: () => string;
}

export type TrackerState = 'idle' | 'warmup' | 'in_match' | 'gameover';

export type IgnoreReason = 'no_steam_id' | 'other_account' | 'observer' | 'no_provider';

export type TrackerEvent =
	| { type: 'match_started'; matchId: string; resumed: boolean }
	| { type: 'round_ended'; matchId: string; round: RoundRecord }
	| { type: 'match_ended'; record: MatchRecord }
	| { type: 'match_discarded'; matchId: string; reason: string }
	| { type: 'ignored'; reason: IgnoreReason };

interface SelfStats {
	kills: number;
	assists: number;
	deaths: number;
	mvps: number;
	score: number;
}

export interface MatchDraft {
	id: string;
	recorderSteamId: string;
	recorderName: string | null;
	map: string;
	mode: string;
	startedAt: number;
	lastDataAt: number;
	endedAt: number | null;
	firstRound: number;
	joinedMidMatch: boolean;
	gsiVersion: number | null;
	mySideStart: Side | null;
	mySide: Side | null;
	scoreCT: number;
	scoreT: number;
	consecutiveLossesCT: number;
	consecutiveLossesT: number;
	roundWins: Record<string, string>;
	selfStats: SelfStats | null;
	rounds: RoundBuilder;
	sightings: Map<string, SightingRecord>;
	finalized: boolean;
	status: 'complete' | 'incomplete' | null;
}

const DEFAULT_RESUME_WINDOW_MS = 30 * 60_000;

export class MatchTracker {
	state: TrackerState = 'idle';
	match: MatchDraft | null = null;
	/** The last match we closed, kept so a reconnect can resume it. */
	lastClosed: MatchDraft | null = null;
	private opts: Required<TrackerOptions>;

	constructor(options: TrackerOptions) {
		this.opts = {
			resumeWindowMs: DEFAULT_RESUME_WINDOW_MS,
			appVersion: 'dev',
			newId: () => crypto.randomUUID(),
			...options
		};
	}

	get steamId() {
		return this.opts.steamId;
	}

	setSteamId(steamId: string | null) {
		if (steamId === this.opts.steamId) return;
		this.opts.steamId = steamId;
		// A match being tracked for another account is meaningless now.
		this.match = null;
		this.lastClosed = null;
		this.state = 'idle';
	}

	ingest(p: GsiPayload, at: number): TrackerEvent[] {
		const providerId = p.provider?.steamid;
		if (!providerId) return [{ type: 'ignored', reason: 'no_provider' }];
		if (!this.opts.steamId) return [{ type: 'ignored', reason: 'no_steam_id' }];
		if (providerId !== this.opts.steamId) return [{ type: 'ignored', reason: 'other_account' }];
		if (isObserverPayload(p)) return [{ type: 'ignored', reason: 'observer' }];

		const map = p.map;
		// No map block: main menu or loading. Not in-match data, so the timeout keeps running.
		if (!map?.name || !map.phase) return [];

		const events: TrackerEvent[] = [];
		const open = this.match && !this.match.finalized ? this.match : null;

		switch (map.phase) {
			case 'warmup': {
				if (open && (open.map !== map.name || roundsOf(open) > 0)) {
					events.push(...this.close(open, at, 'incomplete'));
				}
				this.state = 'warmup';
				return events;
			}
			case 'live':
			case 'intermission': {
				let m = open;
				if (
					m &&
					(m.map !== map.name || m.mode !== (map.mode ?? '') || scoreSum(p) < m.scoreCT + m.scoreT)
				) {
					events.push(...this.close(m, at, 'incomplete'));
					m = null;
				}
				if (!m) {
					m = this.tryResume(p, at) ?? this.start(p, at);
					events.push({ type: 'match_started', matchId: m.id, resumed: m.startedAt !== at });
				}
				events.push(...this.update(m, p, at));
				this.state = 'in_match';
				return events;
			}
			case 'gameover': {
				let m = open;
				if (!m) {
					// Only resume an incomplete save (we timed out, then reconnected right at the end).
					m = this.tryResume(p, at);
					if (!m) return events;
					events.push({ type: 'match_started', matchId: m.id, resumed: true });
				}
				events.push(...this.update(m, p, at));
				events.push(...this.close(m, at, 'complete'));
				this.state = 'gameover';
				return events;
			}
			default:
				return events;
		}
	}

	/** Call periodically. Saves a match as incomplete once in-match data has stopped. */
	tick(at: number): TrackerEvent[] {
		const m = this.match;
		if (!m || m.finalized) return [];
		if (at - m.lastDataAt < this.opts.incompleteTimeoutMs) return [];
		this.state = 'idle';
		return this.close(m, m.lastDataAt, 'incomplete');
	}

	private start(p: GsiPayload, at: number): MatchDraft {
		const map = p.map!;
		const completed = scoreSum(p);
		const m: MatchDraft = {
			id: this.opts.newId(),
			recorderSteamId: this.opts.steamId!,
			recorderName: isSelf(p) ? (p.player?.name ?? null) : null,
			map: map.name!,
			mode: map.mode ?? '',
			startedAt: at,
			lastDataAt: at,
			endedAt: null,
			firstRound: completed + 1,
			joinedMidMatch: completed > 0,
			gsiVersion: p.provider?.version ?? null,
			mySideStart: null,
			mySide: null,
			scoreCT: 0,
			scoreT: 0,
			consecutiveLossesCT: 0,
			consecutiveLossesT: 0,
			roundWins: {},
			selfStats: null,
			rounds: new RoundBuilder(),
			sightings: new Map(),
			finalized: false,
			status: null
		};
		this.match = m;
		return m;
	}

	private tryResume(p: GsiPayload, at: number): MatchDraft | null {
		const c = this.lastClosed;
		if (!c || c.status !== 'incomplete' || c.endedAt === null) return null;
		if (c.map !== p.map?.name || c.mode !== (p.map?.mode ?? '')) return null;
		if (at - c.endedAt > this.opts.resumeWindowMs) return null;
		if (scoreSum(p) < c.scoreCT + c.scoreT) return null;
		c.finalized = false;
		c.status = null;
		c.endedAt = null;
		this.match = c;
		this.lastClosed = null;
		return c;
	}

	private update(m: MatchDraft, p: GsiPayload, at: number): TrackerEvent[] {
		const map = p.map!;
		m.lastDataAt = at;
		m.scoreCT = map.team_ct?.score ?? m.scoreCT;
		m.scoreT = map.team_t?.score ?? m.scoreT;
		m.consecutiveLossesCT = map.team_ct?.consecutive_round_losses ?? m.consecutiveLossesCT;
		m.consecutiveLossesT = map.team_t?.consecutive_round_losses ?? m.consecutiveLossesT;
		if (map.round_wins && Object.keys(map.round_wins).length > 0) {
			m.roundWins = { ...m.roundWins, ...map.round_wins };
		}
		m.gsiVersion = p.provider?.version ?? m.gsiVersion;

		if (isSelf(p)) {
			const player = p.player!;
			m.recorderName = player.name ?? m.recorderName;
			m.mySide = playerSide(player) ?? m.mySide;
			m.mySideStart ??= m.mySide;
			const ms = player.match_stats;
			if (ms) {
				m.selfStats = {
					kills: ms.kills ?? 0,
					assists: ms.assists ?? 0,
					deaths: ms.deaths ?? 0,
					mvps: ms.mvps ?? 0,
					score: ms.score ?? 0
				};
			}
		} else {
			const other = spectatedPlayer(p);
			if (other?.steamid && /^\d{17}$/.test(other.steamid)) this.sight(m, other, at);
		}

		const closed = m.rounds.update(p, at, { mode: m.mode, mySide: m.mySide });
		return closed.map((round) => ({ type: 'round_ended' as const, matchId: m.id, round }));
	}

	private sight(m: MatchDraft, player: NonNullable<GsiPayload['player']>, at: number) {
		const steamId = player.steamid!;
		const side = asSide(player.team);
		const round = m.rounds.current?.number ?? null;
		const prev = m.sightings.get(steamId);
		const ms = player.match_stats;
		m.sightings.set(steamId, {
			steamId,
			name: player.name ?? prev?.name ?? null,
			side: side ?? prev?.side ?? null,
			teammate: side && m.mySide ? side === m.mySide : (prev?.teammate ?? null),
			kills: ms?.kills ?? prev?.kills ?? null,
			assists: ms?.assists ?? prev?.assists ?? null,
			deaths: ms?.deaths ?? prev?.deaths ?? null,
			mvps: ms?.mvps ?? prev?.mvps ?? null,
			score: ms?.score ?? prev?.score ?? null,
			firstRound: prev?.firstRound ?? round,
			lastRound: round ?? prev?.lastRound ?? null,
			lastSeenAt: new Date(at).toISOString()
		});
	}

	private close(m: MatchDraft, at: number, status: 'complete' | 'incomplete'): TrackerEvent[] {
		const events: TrackerEvent[] = [];
		const last = m.rounds.close(at, m.selfStats, status === 'complete');
		if (last) events.push({ type: 'round_ended', matchId: m.id, round: last });

		m.finalized = true;
		m.status = status;
		m.endedAt = at;
		if (this.match === m) this.match = null;
		this.lastClosed = m;

		if (m.rounds.finished.length === 0) {
			events.push({ type: 'match_discarded', matchId: m.id, reason: 'no completed rounds' });
			return events;
		}
		events.push({ type: 'match_ended', record: buildRecord(m, this.opts.appVersion) });
		return events;
	}
}

function roundsOf(m: MatchDraft): number {
	return m.rounds.finished.length + (m.rounds.current?.over ? 1 : 0);
}

export function buildRecord(m: MatchDraft, appVersion: string): MatchRecord {
	const rounds = reconcileWithRoundWins(m.rounds.finished, m.roundWins);
	const side = m.mySide ?? m.mySideStart;
	const scoreMine = side === 'T' ? m.scoreT : m.scoreCT;
	const scoreTheirs = side === 'T' ? m.scoreCT : m.scoreT;
	const self = m.selfStats ?? { kills: 0, assists: 0, deaths: 0, mvps: 0, score: 0 };
	const roundKills = rounds.reduce((n, r) => n + r.kills, 0);
	const hsKills = rounds.reduce((n, r) => n + r.hsKills, 0);
	const { damage, damageRounds } = damageTotals(rounds);
	const endedAt = m.endedAt ?? m.lastDataAt;
	const result: MatchRecord['result'] =
		m.status !== 'complete'
			? 'incomplete'
			: scoreMine > scoreTheirs
				? 'win'
				: scoreMine < scoreTheirs
					? 'loss'
					: 'tie';

	return {
		v: MATCH_RECORD_VERSION,
		id: m.id,
		recorderSteamId: m.recorderSteamId,
		recorderName: m.recorderName,
		map: m.map,
		mode: m.mode || 'unknown',
		startedAt: new Date(m.startedAt).toISOString(),
		endedAt: new Date(endedAt).toISOString(),
		durationS: Math.max(0, Math.round((endedAt - m.startedAt) / 1000)),
		status: m.status ?? 'incomplete',
		result,
		joinedMidMatch: m.joinedMidMatch,
		firstRound: m.firstRound,
		mySideStart: m.mySideStart,
		scoreMine,
		scoreTheirs,
		kills: self.kills,
		assists: self.assists,
		deaths: self.deaths,
		mvps: self.mvps,
		score: self.score,
		hsKills,
		damage,
		roundsPlayed: rounds.length,
		...derivedRates({
			damage,
			damageRounds,
			hsKills,
			roundKills,
			kills: self.kills,
			deaths: self.deaths
		}),
		roundWins: m.roundWins,
		gsiVersion: m.gsiVersion,
		appVersion,
		rounds,
		killEvents: m.rounds.killEvents,
		sightings: [...m.sightings.values()]
	};
}
