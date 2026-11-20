// Builds the LiveView sent to the browser. Pure: everything comes in through ViewInput.
import type { GsiPayload, GsiPlayer, GsiWeapon } from '../gsi/schema.ts';
import { buildRoundPips } from '#lib/round-pips.ts';
import type { MatchDraft, TrackerState } from '../gsi/match-tracker.ts';
import type {
	LiveView,
	MeView,
	RoundPip,
	SyncView,
	TeamView,
	TimerView,
	WeaponView
} from '#lib/live/types.ts';
import { BOMB_TIMER_S, ROUND_OVER_S, mapLabel, modeInfo } from '#lib/cs2/modes.ts';
import { estimateNextRoundMoney } from '#lib/cs2/economy.ts';
import { asSide, parseWinReason, type Side } from '#lib/cs2/rounds.ts';
import { isPrimaryType, weaponLabel } from '#lib/cs2/weapons.ts';
import { derivedRates } from '#lib/match-record.ts';
import {
	activeWeapon,
	currentRoundNumber,
	grenades,
	isObserverPayload,
	isSelf,
	spectatedPlayer,
	weaponList
} from '../gsi/payload.ts';

export interface PhaseClock {
	/** round.phase and when we saw it begin. `observed` is false if we joined mid-phase. */
	roundPhase: string | null;
	roundPhaseAt: number | null;
	roundPhaseObserved: boolean;
	bombPlantedAt: number | null;
	bombPlantObserved: boolean;
}

export interface ViewInput {
	now: number;
	latest: GsiPayload | null;
	latestAt: number | null;
	/** Last payload where `player` was you, for showing your state while you spectate. */
	lastSelf: GsiPayload | null;
	payloadCount: number;
	clock: PhaseClock;
	steamId: string | null;
	tokenConfigured: boolean;
	capturing: boolean;
	trackerState: TrackerState;
	match: MatchDraft | null;
	ignoredReason: string | null;
	lastSaved: { matchId: string; at: number } | null;
	sync: SyncView;
}

export function buildLiveView(input: ViewInput): LiveView {
	const p = input.latest;
	const map = p?.map;
	const inGame = !!map?.name;
	const mode = modeInfo(map?.mode);
	const self = p ? isSelf(p) : false;
	const sameMatch = (q: GsiPayload | null) => !!q && q.map?.name === map?.name;
	const selfPayload = self ? p : sameMatch(input.lastSelf) ? input.lastSelf : null;
	const providerId = p?.provider?.steamid ?? null;

	const team = (t: NonNullable<GsiPayload['map']>['team_ct']): TeamView => ({
		score: t?.score ?? 0,
		name: t?.name ?? null,
		timeoutsRemaining: t?.timeouts_remaining ?? null,
		consecutiveLosses: t?.consecutive_round_losses ?? 0
	});

	const me = selfPayload?.player ? meView(selfPayload.player, !self) : null;
	const mySide = me?.team ?? input.match?.mySide ?? null;
	const roundNumber = p ? roundNumberForView(p, input.match) : 0;

	return {
		serverTime: input.now,
		connection: {
			lastPayloadAt: input.latestAt,
			payloadCount: input.payloadCount,
			providerSteamId: providerId,
			providerName: self ? (p?.player?.name ?? null) : (input.lastSelf?.player?.name ?? null),
			gsiVersion: p?.provider?.version ?? null,
			tokenConfigured: input.tokenConfigured,
			capturing: input.capturing
		},
		setup: {
			steamId: input.steamId,
			accountMismatch: !!input.steamId && !!providerId && providerId !== input.steamId,
			sync: input.sync
		},
		tracking: {
			state: input.trackerState,
			matchId: input.match?.id ?? null,
			recording: !!input.match && !input.match.finalized,
			ignoredReason: input.ignoredReason,
			lastSavedMatchId: input.lastSaved?.matchId ?? null,
			lastSavedAt: input.lastSaved?.at ?? null
		},
		activity: (self ? p?.player?.activity : input.lastSelf?.player?.activity) ?? null,
		inGame,
		observer: p ? isObserverPayload(p) : false,
		map:
			inGame && map
				? {
						name: map.name!,
						label: mapLabel(map.name),
						mode: map.mode ?? '',
						modeLabel: mode.label,
						phase: map.phase ?? 'unknown',
						round: roundNumber,
						ct: team(map.team_ct),
						t: team(map.team_t),
						regulationRounds: mode.regulationRounds,
						halfLength: mode.halfLength
					}
				: null,
		round: inGame
			? {
					phase: p?.round?.phase ?? null,
					bomb: p?.round?.bomb ?? null,
					winTeam: asSide(p?.round?.win_team)
				}
			: null,
		timer:
			inGame && p && input.latestAt !== null
				? phaseTimer(p, input.latestAt, input.clock, mode)
				: null,
		bombTimer:
			inGame && p && input.latestAt !== null ? bombTimer(p, input.latestAt, input.clock) : null,
		history: inGame && p ? history(p, input.match) : [],
		me,
		spectating: p ? spectatingView(p) : null,
		matchStats: selfPayload ? matchStats(selfPayload, input.match) : null,
		roundStats: selfPayload?.player?.state
			? {
					kills: selfPayload.player.state.round_kills ?? 0,
					hsKills: selfPayload.player.state.round_killhs ?? 0,
					damage: selfPayload.player.state.round_totaldmg ?? 0
				}
			: null,
		economy:
			me && map
				? economy(me, mySide, map, roundNumber, p?.round?.phase ?? null, mode.halfLength)
				: null,
		allPlayers: p?.allplayers
			? Object.entries(p.allplayers).map(([steamId, pl]) => ({
					steamId: pl.steamid ?? steamId,
					name: pl.name ?? null,
					team: asSide(pl.team),
					kills: pl.match_stats?.kills ?? 0,
					assists: pl.match_stats?.assists ?? 0,
					deaths: pl.match_stats?.deaths ?? 0,
					health: pl.state?.health ?? null,
					money: pl.state?.money ?? null
				}))
			: null,
		recentRounds: recentRounds(input.match)
	};
}

function roundNumberForView(p: GsiPayload, match: MatchDraft | null): number {
	// While a round is "over" the counters may already point at the next round; the tracker's
	// open round is the reliable answer then.
	if (p.round?.phase === 'over' && match?.rounds.current) return match.rounds.current.number;
	if (p.round?.phase === 'over' && typeof p.map?.round === 'number')
		return Math.max(1, p.map.round);
	return currentRoundNumber(p);
}

function weaponView(w: GsiWeapon | null | undefined): WeaponView | null {
	if (!w?.name) return null;
	return {
		name: w.name,
		label: weaponLabel(w.name),
		type: w.type ?? null,
		clip: w.ammo_clip ?? null,
		clipMax: w.ammo_clip_max ?? null,
		reserve: w.ammo_reserve ?? null
	};
}

function meView(player: GsiPlayer, stale: boolean): MeView {
	const s = player.state ?? {};
	const list = weaponList(player);
	const health = s.health ?? 0;
	return {
		steamId: player.steamid ?? '',
		name: player.name ?? null,
		team: asSide(player.team),
		alive: !stale && health > 0,
		health: stale ? 0 : health,
		armor: s.armor ?? 0,
		helmet: s.helmet ?? false,
		defuseKit: s.defusekit ?? false,
		flashed: s.flashed ?? 0,
		smoked: s.smoked ?? 0,
		burning: s.burning ?? 0,
		money: s.money ?? 0,
		equipValue: s.equip_value ?? 0,
		activeWeapon: weaponView(activeWeapon(player)),
		primary: weaponView(list.find((w) => isPrimaryType(w.type))),
		secondary: weaponView(list.find((w) => w.type === 'Pistol')),
		grenades: grenades(player),
		hasBomb: list.some((w) => w.type === 'C4' || w.name === 'weapon_c4'),
		stale
	};
}

function spectatingView(p: GsiPayload): LiveView['spectating'] {
	const other = spectatedPlayer(p);
	if (!other || isObserverPayload(p)) return null;
	return {
		steamId: other.steamid!,
		name: other.name ?? null,
		team: asSide(other.team),
		health: other.state?.health ?? null,
		kills: other.match_stats?.kills ?? null,
		assists: other.match_stats?.assists ?? null,
		deaths: other.match_stats?.deaths ?? null,
		weapon: activeWeapon(other)?.name ? weaponLabel(activeWeapon(other)!.name) : null
	};
}

function matchStats(selfPayload: GsiPayload, match: MatchDraft | null): LiveView['matchStats'] {
	const ms = selfPayload.player?.match_stats ?? {};
	const rounds = match?.rounds.finished ?? [];
	const damage = rounds.reduce((n, r) => n + r.damage, 0);
	const hsKills = rounds.reduce((n, r) => n + r.hsKills, 0);
	const roundKills = rounds.reduce((n, r) => n + r.kills, 0);
	const kills = ms.kills ?? 0;
	const deaths = ms.deaths ?? 0;
	const rates = derivedRates({
		damage,
		roundsPlayed: rounds.length,
		hsKills,
		roundKills,
		kills,
		deaths
	});
	return {
		kills,
		assists: ms.assists ?? 0,
		deaths,
		mvps: ms.mvps ?? 0,
		score: ms.score ?? 0,
		...rates,
		roundsCompleted: rounds.length
	};
}

function economy(
	me: MeView,
	mySide: Side | null,
	map: NonNullable<GsiPayload['map']>,
	round: number,
	roundPhase: string | null,
	halfLength: number | null
): LiveView['economy'] {
	const losses =
		mySide === 'T'
			? (map.team_t?.consecutive_round_losses ?? 0)
			: (map.team_ct?.consecutive_round_losses ?? 0);
	const est = estimateNextRoundMoney(me.money, losses, mySide);
	return {
		money: me.money,
		consecutiveLosses: losses,
		...est,
		resetNext: halfLength !== null && round === halfLength && roundPhase !== 'freezetime'
	};
}

function phaseTimer(
	p: GsiPayload,
	at: number,
	clock: PhaseClock,
	mode: ReturnType<typeof modeInfo>
): TimerView | null {
	const pc = p.phase_countdowns;
	if (pc?.phase && typeof pc.phase_ends_in === 'number') {
		return { phase: pc.phase, endsAt: at + pc.phase_ends_in * 1000, estimated: false };
	}
	const phase = p.round?.phase;
	if (
		!phase ||
		clock.roundPhase !== phase ||
		clock.roundPhaseAt === null ||
		!clock.roundPhaseObserved
	) {
		return null;
	}
	const start = clock.roundPhaseAt;
	switch (phase) {
		case 'freezetime':
			return { phase, endsAt: start + mode.freezeTimeS * 1000, estimated: true };
		case 'live':
			// Once the bomb is down the round clock no longer matters; the bomb timer takes over.
			if (p.round?.bomb === 'planted') return null;
			return { phase, endsAt: start + mode.roundTimeS * 1000, estimated: true };
		case 'over':
			return { phase, endsAt: start + ROUND_OVER_S * 1000, estimated: true };
		default:
			return null;
	}
}

function bombTimer(p: GsiPayload, at: number, clock: PhaseClock): TimerView | null {
	const pc = p.phase_countdowns;
	if ((pc?.phase === 'bomb' || pc?.phase === 'defuse') && typeof pc.phase_ends_in === 'number') {
		return { phase: pc.phase, endsAt: at + pc.phase_ends_in * 1000, estimated: false };
	}
	if (p.round?.bomb !== 'planted' || clock.bombPlantedAt === null || !clock.bombPlantObserved)
		return null;
	return { phase: 'bomb', endsAt: clock.bombPlantedAt + BOMB_TIMER_S * 1000, estimated: true };
}

function history(p: GsiPayload, match: MatchDraft | null): RoundPip[] {
	const sides = new Map<number, Side | null>();
	for (const r of match?.rounds.finished ?? []) sides.set(r.number, r.mySide);
	const current = match?.rounds.current;
	if (current) sides.set(current.number, current.mySide);
	return buildRoundPips(p.map?.mode, p.map?.round_wins, sides);
}

function recentRounds(match: MatchDraft | null): LiveView['recentRounds'] {
	if (!match) return [];
	return match.rounds.finished
		.slice(-12)
		.reverse()
		.map((r) => {
			const reason = match.roundWins[String(r.number)] ?? null;
			const winner = parseWinReason(reason).side ?? r.winnerSide;
			return {
				number: r.number,
				mySide: r.mySide,
				iWon: winner && r.mySide ? winner === r.mySide : r.iWon,
				winKind: parseWinReason(reason).kind,
				kills: r.kills,
				hsKills: r.hsKills,
				damage: r.damage,
				survived: r.survived,
				buyType: r.buyType,
				equipValue: r.equipValue
			};
		});
}
