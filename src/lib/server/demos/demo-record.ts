// A whole MatchRecord built from an official match demo, for matches CS2Live did not record
// (played before you installed it, or while it wasn't running). Pure: takes the rows
// demoparser2 returns; `readDemoMatch` in demo-file.ts collects them.
//
// Everything is read from the demo, so it is OBSERVED, and the field meanings follow the live
// tracker's (round-builder.ts) so imported and recorded matches compare fairly:
// - Rounds are numbered by freeze end (`total_rounds_played + 1`), like the damage. Kills,
//   deaths and assists after the round is decided count for that round, as in GSI.
// - Money: at the start of freeze time. Equipment value, money after buying and weapons: the
//   last reading within 15 s of freeze end, before your first kill or death in the round.
// - Kills and HS kills per round count enemies only; match totals are the scoreboard's.
// - Teammates become sightings with their final scoreboard. Opponents are left out: a recording
//   only ever sees teammates (you spectate them while dead).
// - The demo has no clock. Tick 0 is placed at Steam's match time, which is when the match was
//   made; the server starts recording up to a minute or so later, so times are approximate.
import { createHash } from 'node:crypto';
import {
	damageTotals,
	derivedRates,
	MATCH_RECORD_VERSION,
	type KillEventRecord,
	type MatchRecord,
	type RoundRecord,
	type SightingRecord
} from '#lib/match-record.ts';
import { classifyBuy } from '#lib/cs2/economy.ts';
import { isPrimaryType } from '#lib/cs2/weapons.ts';
import type { Side } from '#lib/cs2/rounds.ts';
import { damageByRound, type FreezeEndEvent, type HurtEvent } from './demo-damage.ts';
import { inventoryWeapons, killWeapon } from './demo-weapons.ts';

export const TICK_RATE = 64;
/** The tracker keeps reading your buy this long into the round (BUY_WINDOW_MS). */
const BUY_WINDOW_TICKS = 15 * TICK_RATE;

type SteamIdValue = string | number | null | undefined;

export interface DemoEvent {
	tick: number;
	total_rounds_played?: number | null;
	is_warmup_period?: boolean | null;
}

export interface RoundEndEvent extends DemoEvent {
	/** `CT` / `T` (or the team number). */
	winner?: string | number | null;
	/** `t_killed`, `bomb_defused`, … (or the engine's reason number). */
	reason?: string | number | null;
}

export interface DeathEvent extends DemoEvent {
	attacker_steamid?: SteamIdValue;
	user_steamid?: SteamIdValue;
	assister_steamid?: SteamIdValue;
	attacker_team_num?: number | null;
	user_team_num?: number | null;
	weapon?: string | null;
	headshot?: boolean | null;
}

export interface BombEvent {
	tick: number;
	kind: 'planted' | 'defused' | 'exploded';
}

/** One player's state at one tick (`parseTicks`). */
export interface PlayerTick {
	tick: number;
	steamid?: SteamIdValue;
	name?: string | null;
	team_num?: number | null;
	balance?: number | null;
	current_equip_value?: number | null;
	health?: number | null;
	is_alive?: boolean | null;
	inventory?: string[] | null;
	kills_total?: number | null;
	deaths_total?: number | null;
	assists_total?: number | null;
	mvps?: number | null;
	score?: number | null;
}

/** The player props `readDemoMatch` asks for at every sample tick. */
export const PLAYER_PROPS = [
	'team_num',
	'balance',
	'current_equip_value',
	'health',
	'is_alive',
	'inventory',
	'kills_total',
	'deaths_total',
	'assists_total',
	'mvps',
	'score'
] as const;

export interface DemoEvents {
	map: string | null;
	/** `rank_update.rank_type_id`: 7 Wingman, 11 Premier, 12 Competitive. */
	rankTypeIds: number[];
	/** `server_cvar` values, e.g. game_mode, mp_maxrounds. */
	cvars: Record<string, string>;
	matchStarts: DemoEvent[];
	roundStarts: DemoEvent[];
	freezeEnds: FreezeEndEvent[];
	roundEnds: RoundEndEvent[];
	/** `cs_win_panel_match`: the match was played to the end. */
	matchEnds: DemoEvent[];
	deaths: DeathEvent[];
	hurt: HurtEvent[];
	bombs: BombEvent[];
}

export interface DemoMatchData extends DemoEvents {
	/** Every player's state at `sampleTicks(...)`. */
	ticks: PlayerTick[];
}

interface DemoRound {
	number: number;
	startTick: number;
	freezeEndTick: number;
	endTick: number;
	/** The last tick before the next round starts (or the match ends). */
	closeTick: number;
	winner: Side | null;
	reason: string | null;
}

const STEAM_ID = /^\d{17}$/;
const sid = (v: SteamIdValue): string | null => (v === null || v === undefined ? null : String(v));
const sideOf = (team: number | null | undefined): Side | null =>
	team === 2 ? 'T' : team === 3 ? 'CT' : null;
const live = (e: DemoEvent) => !e.is_warmup_period;

function winnerSide(w: RoundEndEvent['winner']): Side | null {
	if (w === 2 || w === 'T' || w === 't') return 'T';
	if (w === 3 || w === 'CT' || w === 'ct') return 'CT';
	return null;
}

/** The engine's round end reasons by number, as demoparser2 names them. */
const REASON_NAMES: Record<number, string> = {
	1: 'bomb_exploded',
	7: 'bomb_defused',
	8: 't_killed',
	9: 'ct_killed',
	10: 'draw',
	11: 'hostage_rescued',
	12: 'target_saved',
	13: 'hostages_not_rescued',
	17: 't_surrender',
	18: 'ct_surrender'
};

/** demoparser2's reason as GSI's `round_wins` value (`t_killed` -> `ct_win_elimination`). */
export function gsiWinReason(reason: RoundEndEvent['reason'], winner: Side | null): string | null {
	const name = typeof reason === 'number' ? (REASON_NAMES[reason] ?? null) : (reason ?? null);
	const kind: Record<string, string> = {
		t_killed: 'elimination',
		ct_killed: 'elimination',
		bomb_exploded: 'bomb',
		target_bombed: 'bomb',
		bomb_defused: 'defuse',
		target_saved: 'time',
		time_ran_out: 'time',
		hostage_rescued: 'rescue',
		hostages_not_rescued: 'time',
		t_surrender: 'surrender',
		ct_surrender: 'surrender'
	};
	if (!winner) return name;
	return `${winner.toLowerCase()}_win_${name ? (kind[name] ?? name) : 'unknown'}`;
}

/** The rounds in the demo, from the last match start (warmup and restarts left out). */
function demoRounds(d: DemoEvents): DemoRound[] {
	const matchStart = Math.max(0, ...d.matchStarts.filter(live).map((e) => e.tick));
	const after = <T extends DemoEvent>(rows: T[]) =>
		rows.filter((e) => live(e) && e.tick >= matchStart).sort((a, b) => a.tick - b.tick);

	const freezes = new Map<number, number>();
	for (const e of after(d.freezeEnds)) {
		if (typeof e.total_rounds_played === 'number') freezes.set(e.total_rounds_played + 1, e.tick);
	}
	const freezeList = [...freezes].sort((a, b) => a[1] - b[1]);
	const ends = after(d.roundEnds);
	const starts = d.roundStarts.map((e) => e.tick).sort((a, b) => a - b);
	const matchEnd = after(d.matchEnds).at(-1)?.tick ?? null;

	const rounds: Omit<DemoRound, 'closeTick'>[] = [];
	for (const [i, [number, freezeEndTick]] of freezeList.entries()) {
		const next = freezeList[i + 1]?.[1] ?? Infinity;
		const end = ends.filter((e) => e.tick > freezeEndTick && e.tick < next).at(-1);
		if (!end) continue; // The demo stops mid-round.
		// After the previous round ended; never before the match (re)started.
		const floor = rounds.length ? rounds.at(-1)!.endTick + 1 : matchStart;
		const start = starts.filter((t) => t <= freezeEndTick).at(-1) ?? freezeEndTick;
		const winner = winnerSide(end.winner);
		rounds.push({
			number,
			startTick: Math.max(start, floor),
			freezeEndTick,
			endTick: end.tick,
			winner,
			reason: gsiWinReason(end.reason, winner)
		});
	}
	return rounds.map((r, i) => ({
		...r,
		closeTick:
			i + 1 < rounds.length
				? rounds[i + 1].startTick - 1
				: Math.max(r.endTick, matchEnd ?? r.endTick + 3 * TICK_RATE)
	}));
}

const roundOf = (rounds: DemoRound[], tick: number): DemoRound | null =>
	rounds.find((r) => r.startTick <= tick && tick <= r.closeTick) ?? null;

/** Your enemy kills and your death, per round. */
function myEvents(d: DemoEvents, rounds: DemoRound[], steamId: string) {
	const kills: (DeathEvent & { round: DemoRound })[] = [];
	const assists: DeathEvent[] = [];
	const deaths = new Map<number, number>();
	for (const e of d.deaths.filter(live).sort((a, b) => a.tick - b.tick)) {
		const round = roundOf(rounds, e.tick);
		if (!round) continue;
		const victim = sid(e.user_steamid);
		const enemies =
			typeof e.attacker_team_num !== 'number' ||
			typeof e.user_team_num !== 'number' ||
			e.attacker_team_num !== e.user_team_num;
		if (victim === steamId && !deaths.has(round.number)) deaths.set(round.number, e.tick);
		if (victim === steamId || !enemies) continue;
		if (sid(e.attacker_steamid) === steamId) kills.push({ ...e, round });
		else if (sid(e.assister_steamid) === steamId) assists.push(e);
	}
	return { kills, assists, deaths };
}

/** When your buy is read: within 15 s of freeze end, before your first kill or death. */
function buyTick(r: DemoRound, firstAction: number | undefined): number {
	let tick = Math.min(r.freezeEndTick + BUY_WINDOW_TICKS, r.endTick);
	if (firstAction !== undefined && firstAction > r.freezeEndTick) {
		tick = Math.min(tick, firstAction - 1);
	}
	return Math.max(r.freezeEndTick, tick);
}

function plan(d: DemoEvents, steamId: string) {
	const rounds = demoRounds(d);
	const mine = myEvents(d, rounds, steamId);
	const buyTicks = new Map<number, number>();
	for (const r of rounds) {
		const firstKill = mine.kills.find((k) => k.round === r)?.tick;
		const death = mine.deaths.get(r.number);
		const first = Math.min(firstKill ?? Infinity, death ?? Infinity);
		buyTicks.set(r.number, buyTick(r, Number.isFinite(first) ? first : undefined));
	}
	return { rounds, mine, buyTicks };
}

/** The ticks `readDemoMatch` must sample player state at, for this player. */
export function sampleTicks(d: DemoEvents, steamId: string): number[] {
	const { rounds, mine, buyTicks } = plan(d, steamId);
	const ticks = new Set<number>();
	for (const r of rounds) {
		ticks.add(r.startTick).add(r.endTick).add(r.closeTick).add(buyTicks.get(r.number)!);
		const death = mine.deaths.get(r.number);
		if (death !== undefined) ticks.add(death);
	}
	return [...ticks].sort((a, b) => a - b);
}

/** A stable id per match and player, so importing the same demo twice updates one match. */
export function demoRecordId(gcMatchId: string, steamId: string): string {
	const h = createHash('sha256').update(`cs2live-demo:${gcMatchId}:${steamId}`).digest('hex');
	const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function demoMode(d: Pick<DemoEvents, 'rankTypeIds' | 'cvars'>, players: number): string {
	const types = new Set(d.rankTypeIds);
	if (types.has(7)) return 'scrimcomp2v2';
	if (types.has(11)) return 'premier';
	if (types.has(12)) return 'competitive';
	if (d.cvars.game_mode === '2' || players <= 4) return 'scrimcomp2v2';
	return 'competitive';
}

export interface DemoRecordOptions {
	steamId: string;
	/** Steam's match id, for the record id. */
	gcMatchId: string;
	/** Steam's match time (ms): where tick 0 goes. */
	matchTime: number;
	appVersion: string;
}

/** The match as a MatchRecord, or null when the player isn't in any round of it. */
export function matchFromDemo(d: DemoMatchData, opts: DemoRecordOptions): MatchRecord | null {
	const { steamId } = opts;
	const { rounds, mine, buyTicks } = plan(d, steamId);
	const at = (tick: number) => new Date(opts.matchTime + (tick * 1000) / TICK_RATE).toISOString();

	const states = new Map<number, Map<string, PlayerTick>>();
	for (const row of d.ticks) {
		const id = sid(row.steamid);
		if (!id) continue;
		if (!states.has(row.tick)) states.set(row.tick, new Map());
		states.get(row.tick)!.set(id, row);
	}
	const state = (tick: number, id = steamId) => states.get(tick)?.get(id) ?? null;
	const num = (v: number | null | undefined) => (typeof v === 'number' ? v : null);

	const { damage } = damageByRound(steamId, d.hurt, d.freezeEnds);
	const out: RoundRecord[] = [];
	const killEvents: KillEventRecord[] = [];
	let prevSide: Side | null = null;
	let prevMvps: number | null = null;
	for (const r of rounds) {
		const start = state(r.startTick);
		const buy = state(buyTicks.get(r.number)!);
		const side = sideOf(buy?.team_num ?? start?.team_num);
		if (!side) continue; // Not playing this round (not joined yet, or left).
		const end = state(r.endTick);
		const close = state(r.closeTick);
		const deathTick = mine.deaths.get(r.number);
		const kills = mine.kills.filter((k) => k.round === r);
		const weapons = inventoryWeapons(buy?.inventory);
		const halfStart = out.length === 0 ? r.number === 1 : side !== prevSide;
		const mvps = num(close?.mvps);
		const equipValue = num(buy?.current_equip_value);
		const moneyFreezeStart = num(start?.balance);
		out.push({
			number: r.number,
			mySide: side,
			winnerSide: r.winner,
			winReason: r.reason,
			iWon: r.winner ? r.winner === side : null,
			// Plants after the round is decided don't count, as in GSI.
			bomb:
				d.bombs.filter((b) => b.tick >= r.freezeEndTick && b.tick <= r.endTick).at(-1)?.kind ??
				null,
			kills: kills.length,
			hsKills: kills.filter((k) => k.headshot).length,
			damage: damage.get(r.number) ?? null,
			assists: mine.assists.filter((a) => roundOf(rounds, a.tick) === r).length,
			survived: end ? end.is_alive !== false && (end.health ?? 1) > 0 : null,
			healthEnd: num(end?.health),
			moneyFreezeStart,
			moneyFreezeEnd: num(buy?.balance),
			moneyEnd: num((deathTick !== undefined ? state(deathTick) : close)?.balance),
			equipValue,
			weaponsFreezeEnd: weapons,
			primaryWeapon: weapons.find((w) => isPrimaryType(w.type ?? undefined))?.name ?? null,
			buyType: classifyBuy({ equipValue, moneyFreezeStart, halfStart }),
			mvp: mvps !== null && mvps > (prevMvps ?? num(start?.mvps) ?? 0),
			startedAt: at(r.startTick),
			liveAt: at(r.freezeEndTick),
			endedAt: at(r.endTick),
			durationS: Math.round(((r.endTick - r.freezeEndTick) * 10) / TICK_RATE) / 10,
			partial: false
		});
		for (const k of kills) {
			killEvents.push({
				round: r.number,
				at: at(k.tick),
				weapon: killWeapon(k.weapon, side),
				headshot: !!k.headshot
			});
		}
		prevSide = side;
		prevMvps = mvps ?? prevMvps;
	}
	if (!out.length) return null;

	const first = rounds.find((r) => r.number === out[0].number)!;
	const last = rounds.find((r) => r.number === out.at(-1)!.number)!;
	const finalTick = last.closeTick;
	const me = state(finalTick) ?? state(last.endTick);
	const finished = d.matchEnds.some(live) && last === rounds.at(-1);
	const scoreMine = out.filter((r) => r.iWon === true).length;
	const scoreTheirs = out.filter((r) => r.iWon === false).length;
	const roundKills = out.reduce((n, r) => n + r.kills, 0);
	const hsKills = out.reduce((n, r) => n + r.hsKills, 0);
	const kills = num(me?.kills_total) ?? roundKills;
	const deaths = num(me?.deaths_total) ?? mine.deaths.size;
	const totals = damageTotals(out);

	const players = new Set(d.ticks.map((t) => sid(t.steamid)).filter(Boolean));
	// Everyone who played a round on your side, also if they left early. Bots have no Steam ID.
	const teammates = new Map<string, { played: number[]; tick: number }>();
	for (const mineRound of out) {
		const r = rounds.find((x) => x.number === mineRound.number)!;
		for (const [id, row] of states.get(r.endTick) ?? []) {
			if (id === steamId || !STEAM_ID.test(id) || sideOf(row.team_num) !== mineRound.mySide) {
				continue;
			}
			const mate = teammates.get(id) ?? { played: [], tick: r.endTick };
			mate.played.push(r.number);
			mate.tick = state(r.closeTick, id) ? r.closeTick : r.endTick;
			teammates.set(id, mate);
		}
	}
	const sightings: SightingRecord[] = [];
	for (const [id, { played, tick }] of teammates) {
		const row = state(tick, id)!;
		sightings.push({
			steamId: id,
			name: row.name ?? null,
			side: sideOf(row.team_num),
			teammate: true,
			kills: num(row.kills_total),
			assists: num(row.assists_total),
			deaths: num(row.deaths_total),
			mvps: num(row.mvps),
			score: num(row.score),
			firstRound: played[0],
			lastRound: played.at(-1)!,
			lastSeenAt: at(rounds.find((r) => r.number === played.at(-1))!.endTick)
		});
	}

	const startedAt = at(first.startTick);
	const endedAt = at(last.endTick);
	return {
		v: MATCH_RECORD_VERSION,
		id: demoRecordId(opts.gcMatchId, steamId),
		recorderSteamId: steamId,
		recorderName: me?.name ?? null,
		map: d.map ?? 'unknown',
		mode: demoMode(d, players.size),
		startedAt,
		endedAt,
		durationS: Math.max(0, Math.round((last.endTick - first.startTick) / TICK_RATE)),
		status: finished ? 'complete' : 'incomplete',
		result: !finished
			? 'incomplete'
			: scoreMine > scoreTheirs
				? 'win'
				: scoreMine < scoreTheirs
					? 'loss'
					: 'tie',
		joinedMidMatch: out[0].number > 1,
		firstRound: out[0].number,
		mySideStart: out[0].mySide,
		scoreMine,
		scoreTheirs,
		kills,
		assists: num(me?.assists_total) ?? mine.assists.length,
		deaths,
		mvps: num(me?.mvps) ?? out.filter((r) => r.mvp).length,
		score: num(me?.score) ?? 0,
		hsKills,
		damage: totals.damage,
		damageSource: totals.damage === null ? null : 'demo',
		origin: 'demo',
		roundsPlayed: out.length,
		...derivedRates({ ...totals, hsKills, roundKills, kills, deaths }),
		roundWins: Object.fromEntries(
			rounds.filter((r) => r.reason).map((r) => [String(r.number), r.reason!])
		),
		gsiVersion: null,
		appVersion: opts.appVersion,
		rounds: out,
		killEvents,
		sightings
	};
}
