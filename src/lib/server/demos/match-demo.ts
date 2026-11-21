// Which demo belongs to a recorded match, and the match with the demo's damage filled in. Pure.
import { damageTotals, derivedRates, type MatchRecord } from '#lib/match-record.ts';
import { STEAMID64_BASE } from '#lib/cs2/steamid.ts';
import type { GcMatch } from './gc-match-list.ts';

/** Official matchmaking modes: the only matches Valve keeps demos for. */
export const DEMO_MODES: ReadonlySet<string> = new Set(['competitive', 'premier', 'scrimcomp2v2']);

/** Whether a finished match should wait for its demo to fill in damage. */
export function wantsDemoDamage(record: MatchRecord): boolean {
	return DEMO_MODES.has(record.mode) && record.damage === null;
}

export function accountIdOf(steamId: string): number {
	return Number(BigInt(steamId) - STEAMID64_BASE);
}

/**
 * How far before our start the Game Coordinator's match time may be. It is when the server
 * started the match; we start counting when we first see it, which can be much later when you
 * join mid-match.
 */
const EARLIEST_MS = 90 * 60_000;

/**
 * The Game Coordinator's entry for a recorded match: you played in it, it started in the window
 * around our start time, and among those the final score matches if it can, then the closest start.
 */
export function findGcMatch(record: MatchRecord, matches: GcMatch[]): GcMatch | null {
	const me = accountIdOf(record.recorderSteamId);
	const start = Date.parse(record.startedAt);
	const end = Date.parse(record.endedAt);
	const score = [record.scoreMine, record.scoreTheirs].sort((a, b) => a - b).join('-');
	const candidates = matches
		.filter((m) => m.accountIds.includes(me))
		.filter((m) => m.matchTime >= start - EARLIEST_MS && m.matchTime <= end)
		.map((m) => ({
			m,
			sameScore: [...m.teamScores].sort((a, b) => a - b).join('-') === score,
			gap: Math.abs(m.matchTime - start)
		}))
		.sort((a, b) => +b.sameScore - +a.sameScore || a.gap - b.gap);
	return candidates[0]?.m ?? null;
}

/** The record with damage per round from the demo. Rounds the demo lacks stay unknown. */
export function withDemoDamage(record: MatchRecord, damage: Map<number, number>): MatchRecord {
	const rounds = record.rounds.map((r) => ({ ...r, damage: damage.get(r.number) ?? null }));
	const totals = damageTotals(rounds);
	const { adr } = derivedRates({
		...totals,
		hsKills: record.hsKills,
		roundKills: rounds.reduce((n, r) => n + r.kills, 0),
		kills: record.kills,
		deaths: record.deaths
	});
	return {
		...record,
		rounds,
		damage: totals.damage,
		damageSource: totals.damage === null ? null : 'demo',
		adr
	};
}
