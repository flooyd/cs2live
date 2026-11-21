// Builds per-round records from GSI transitions. Pure.
//
// A round starts when the round number changes during freezetime/live, gets its buy snapshot
// when freeze time ends, and closes when the next round starts or the match ends. Your own
// numbers are only read from payloads where `player` is you; while you are dead the `player`
// block describes the teammate you spectate.
import type { GsiMatchStats, GsiPayload } from './schema.ts';
import type { KillEventRecord, RoundRecord, WeaponSnap } from '#lib/match-record.ts';
import { classifyBuy } from '#lib/cs2/economy.ts';
import { modeInfo } from '#lib/cs2/modes.ts';
import { asSide, parseWinReason, type Side } from '#lib/cs2/rounds.ts';
import {
	activeWeapon,
	currentRoundNumber,
	isSelf,
	primaryWeapon,
	spectatedPlayer,
	weaponSnaps
} from './payload.ts';

/** How long into the live phase we still treat money/equipment changes as part of the buy. */
export const BUY_WINDOW_MS = 15_000;

interface Stats {
	kills: number;
	assists: number;
	deaths: number;
	mvps: number;
}

function stats(ms: GsiMatchStats | undefined): Stats | null {
	if (!ms) return null;
	return {
		kills: ms.kills ?? 0,
		assists: ms.assists ?? 0,
		deaths: ms.deaths ?? 0,
		mvps: ms.mvps ?? 0
	};
}

export interface RoundDraft {
	number: number;
	mySide: Side | null;
	startedAt: number | null;
	liveAt: number | null;
	endedAt: number | null;
	bombPlantedAt: number | null;
	sawFreezeStart: boolean;
	over: boolean;
	moneyFreezeStart: number | null;
	moneyFreezeEnd: number | null;
	moneyEnd: number | null;
	equipValue: number | null;
	weaponsFreezeEnd: WeaponSnap[];
	primaryWeapon: string | null;
	kills: number;
	hsKills: number;
	damage: number;
	healthEnd: number | null;
	sawDeath: boolean;
	sawSpectating: boolean;
	/** Joined mid-round: the first round_kills we see are from before we were watching. */
	needKillBaseline: boolean;
	base: Stats | null;
	latest: Stats | null;
	winnerSide: Side | null;
	bomb: string | null;
	halfStart: boolean;
}

export interface RoundContext {
	mode: string;
	mySide: Side | null;
}

export class RoundBuilder {
	finished: RoundRecord[] = [];
	killEvents: KillEventRecord[] = [];
	current: RoundDraft | null = null;
	private lastRoundKills = 0;
	private lastRoundKillHs = 0;

	/** Feeds one in-match payload. Returns rounds that closed because of it. */
	update(p: GsiPayload, at: number, ctx: RoundContext): RoundRecord[] {
		const closed: RoundRecord[] = [];
		// CS2 ends a match with map.phase "gameover" and round.phase "freezetime", skipping "over"
		// for the last round. That round is over, and no new one is starting; your state in that
		// payload is already reset for a round that never comes, so it is not read.
		const gameover = p.map?.phase === 'gameover';
		const phase = gameover ? 'over' : p.round?.phase;
		const self = isSelf(p);
		const state = self && !gameover ? p.player?.state : undefined;
		const matchStats = self ? stats(p.player?.match_stats) : null;

		if (phase === 'freezetime' || phase === 'live') {
			const number = currentRoundNumber(p);
			if (!this.current || this.current.number !== number) {
				if (this.current) {
					const done = this.close(at, matchStats);
					if (done) closed.push(done);
				}
				this.current = this.start(number, at, phase === 'freezetime', ctx);
			}
		}

		const d = this.current;
		if (!d) return closed;

		if (self && ctx.mySide) d.mySide ??= ctx.mySide;
		if (matchStats) {
			d.base ??= matchStats;
			d.latest = matchStats;
		}

		if (phase === 'live' && d.liveAt === null) d.liveAt = at;
		if (phase === 'over' && !d.over) {
			d.over = true;
			d.endedAt = at;
		}
		if (phase === 'over') d.winnerSide = asSide(p.round?.win_team) ?? d.winnerSide;
		if (p.round?.bomb) {
			d.bomb = p.round.bomb;
			if (p.round.bomb === 'planted' && d.bombPlantedAt === null) d.bombPlantedAt = at;
		}

		if (spectatedPlayer(p) && (phase === 'live' || phase === 'over')) d.sawSpectating = true;

		if (state) {
			const money = state.money ?? null;
			if (phase === 'freezetime') {
				// No kills or damage happen in freeze time, and round_* counters may still hold
				// last round's values in the first update, so only the buy is read here.
				if (d.moneyFreezeStart === null) d.moneyFreezeStart = money;
				this.snapshotBuy(d, p);
			} else if (phase === 'live' || phase === 'over') {
				// Late buys count, until the fighting starts: a kill pays its reward into your
				// money, and dying empties `weapons` (equip_value keeps the old value).
				const quiet = (state.health ?? 0) > 0 && (state.round_kills ?? 0) === 0;
				if (phase === 'live' && d.liveAt !== null && at - d.liveAt <= BUY_WINDOW_MS && quiet) {
					this.snapshotBuy(d, p);
				}
				if (d.moneyFreezeEnd === null) this.snapshotBuy(d, p);
				this.trackKills(d, p, at);
				d.damage = Math.max(d.damage, state.round_totaldmg ?? 0);
				d.healthEnd = state.health ?? d.healthEnd;
				if (state.health === 0) d.sawDeath = true;
				d.moneyEnd = money ?? d.moneyEnd;
			}
		}

		return closed;
	}

	/**
	 * Closes the open round. `after` is your match_stats from the first update after the round
	 * (the next round's freeze time), which catches deaths, assists and MVPs we could not see
	 * while spectating. Rounds that never reached `over` are dropped unless `force` is set
	 * (the match ended, so the round did too).
	 */
	close(at: number, after: Stats | null, force = false): RoundRecord | null {
		const d = this.current;
		this.current = null;
		this.lastRoundKills = 0;
		this.lastRoundKillHs = 0;
		if (!d || (!d.over && !force)) return null;

		const end = after ?? d.latest;
		const delta = (k: keyof Stats) => (d.base && end ? Math.max(0, end[k] - d.base[k]) : 0);
		const deaths = delta('deaths');
		const kills = Math.max(d.kills, delta('kills'));
		const known = d.base !== null || d.healthEnd !== null;

		const record: RoundRecord = {
			number: d.number,
			mySide: d.mySide,
			winnerSide: d.winnerSide,
			winReason: null,
			iWon: d.winnerSide && d.mySide ? d.winnerSide === d.mySide : null,
			bomb: d.bomb,
			kills,
			hsKills: Math.min(d.hsKills, kills),
			damage: d.damage,
			assists: delta('assists'),
			survived: known ? !(deaths > 0 || d.sawDeath || d.sawSpectating) : null,
			healthEnd: d.healthEnd,
			moneyFreezeStart: d.moneyFreezeStart,
			moneyFreezeEnd: d.moneyFreezeEnd,
			moneyEnd: d.moneyEnd,
			equipValue: d.equipValue,
			weaponsFreezeEnd: d.weaponsFreezeEnd,
			primaryWeapon: d.primaryWeapon,
			buyType: classifyBuy({
				equipValue: d.equipValue,
				moneyFreezeStart: d.moneyFreezeStart,
				halfStart: d.halfStart
			}),
			mvp: delta('mvps') > 0,
			startedAt: iso(d.startedAt),
			liveAt: iso(d.liveAt),
			endedAt: iso(d.endedAt ?? (force ? at : null)),
			durationS: d.liveAt !== null ? Math.round(((d.endedAt ?? at) - d.liveAt) / 100) / 10 : null,
			partial: !d.sawFreezeStart
		};
		this.finished = this.finished.filter((r) => r.number !== record.number);
		this.finished.push(record);
		this.finished.sort((a, b) => a.number - b.number);
		return record;
	}

	private start(number: number, at: number, inFreeze: boolean, ctx: RoundContext): RoundDraft {
		const prev = this.finished.at(-1);
		const mode = modeInfo(ctx.mode);
		const regulationHalfStart =
			mode.halfLength !== null &&
			mode.regulationRounds !== null &&
			number <= mode.regulationRounds &&
			(number - 1) % mode.halfLength === 0;
		const sideSwitched =
			!!prev && prev.number === number - 1 && !!ctx.mySide && prev.mySide !== ctx.mySide;
		return {
			number,
			mySide: ctx.mySide,
			startedAt: inFreeze ? at : null,
			liveAt: inFreeze ? null : at,
			endedAt: null,
			bombPlantedAt: null,
			sawFreezeStart: inFreeze,
			over: false,
			moneyFreezeStart: null,
			moneyFreezeEnd: null,
			moneyEnd: null,
			equipValue: null,
			weaponsFreezeEnd: [],
			primaryWeapon: null,
			kills: 0,
			hsKills: 0,
			damage: 0,
			healthEnd: null,
			sawDeath: false,
			sawSpectating: false,
			needKillBaseline: !inFreeze,
			base: null,
			latest: null,
			winnerSide: null,
			bomb: null,
			halfStart: number === 1 || regulationHalfStart || sideSwitched
		};
	}

	private snapshotBuy(d: RoundDraft, p: GsiPayload) {
		const state = p.player?.state;
		d.moneyFreezeEnd = state?.money ?? d.moneyFreezeEnd;
		d.equipValue = state?.equip_value ?? d.equipValue;
		// A living player always holds at least a knife; an empty list means dead (or no data).
		const weapons = weaponSnaps(p.player);
		if (weapons.length) {
			d.weaponsFreezeEnd = weapons;
			d.primaryWeapon = primaryWeapon(p.player);
		}
	}

	/** INFERRED kill events: round_kills went up; headshot if round_killhs went up too. */
	private trackKills(d: RoundDraft, p: GsiPayload, at: number) {
		const state = p.player?.state;
		const k = state?.round_kills ?? 0;
		const hs = state?.round_killhs ?? 0;
		if (d.needKillBaseline) {
			d.needKillBaseline = false;
			this.lastRoundKills = k;
			this.lastRoundKillHs = hs;
		}
		const newKills = k - this.lastRoundKills;
		const newHs = Math.max(0, hs - this.lastRoundKillHs);
		if (newKills > 0) {
			const weapon = activeWeapon(p.player)?.name ?? null;
			for (let i = 0; i < newKills; i++) {
				this.killEvents.push({
					round: d.number,
					at: new Date(at).toISOString(),
					weapon,
					headshot: i < newHs
				});
			}
		}
		this.lastRoundKills = Math.max(this.lastRoundKills, k);
		this.lastRoundKillHs = Math.max(this.lastRoundKillHs, hs);
		d.kills = Math.max(d.kills, k);
		d.hsKills = Math.max(d.hsKills, hs);
	}
}

function iso(ms: number | null): string | null {
	return ms === null ? null : new Date(ms).toISOString();
}

/** Fills winner and reason from map.round_wins, which is authoritative when present. */
export function reconcileWithRoundWins(
	rounds: RoundRecord[],
	roundWins: Record<string, string>
): RoundRecord[] {
	return rounds.map((r) => {
		const reason = roundWins[String(r.number)];
		if (!reason) return r;
		const { side } = parseWinReason(reason);
		const winnerSide = side ?? r.winnerSide;
		return {
			...r,
			winReason: reason,
			winnerSide,
			iWon: winnerSide && r.mySide ? winnerSide === r.mySide : r.iWon
		};
	});
}
