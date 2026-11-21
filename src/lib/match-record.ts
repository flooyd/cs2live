// MatchRecord: one recorded match, as produced by the match tracker. It is the single format
// for the local outbox, the upload API body and what persistence writes to the database.
// Pure; the zod schema validates uploads on the site.
import { z } from 'zod';

export const MATCH_RECORD_VERSION = 1;

const side = z.enum(['CT', 'T']);
const nint = z.number().int().nullable();

export const weaponSnapSchema = z.object({
	name: z.string(),
	type: z.string().nullable(),
	/** Grenades: how many you hold. */
	count: z.number().int().nullable()
});

export const roundRecordSchema = z.object({
	number: z.number().int().positive(),
	mySide: side.nullable(),
	winnerSide: side.nullable(),
	winReason: z.string().nullable(),
	iWon: z.boolean().nullable(),
	/** planted | exploded | defused (the last bomb state seen this round). */
	bomb: z.string().nullable(),
	kills: z.number().int().min(0),
	/** Inferred from round_killhs. */
	hsKills: z.number().int().min(0),
	/**
	 * round_totaldmg as last seen while you were alive and in view. Null when CS2 sent none: as
	 * of Nov 2026 it never does. Older CS2Live versions sent 0 instead.
	 */
	damage: z.number().int().min(0).nullable(),
	/** Inferred from the match_stats.assists delta. */
	assists: z.number().int().min(0),
	/** Inferred from health, death count and being seen spectating. */
	survived: z.boolean().nullable(),
	healthEnd: nint,
	moneyFreezeStart: nint,
	moneyFreezeEnd: nint,
	moneyEnd: nint,
	equipValue: nint,
	weaponsFreezeEnd: z.array(weaponSnapSchema),
	primaryWeapon: z.string().nullable(),
	/** Derived, see src/lib/cs2/economy.ts. */
	buyType: z.enum(['pistol', 'eco', 'force', 'full', 'save']).nullable(),
	/** Inferred from the match_stats.mvps delta. */
	mvp: z.boolean(),
	startedAt: z.iso.datetime().nullable(),
	liveAt: z.iso.datetime().nullable(),
	endedAt: z.iso.datetime().nullable(),
	/** Seconds from freeze time ending to the round ending. */
	durationS: z.number().nullable(),
	/** True when we did not see the whole round (joined mid-round, reconnect). */
	partial: z.boolean()
});

export const killEventSchema = z.object({
	round: z.number().int().positive(),
	at: z.iso.datetime(),
	/** INFERRED: your active weapon when round_kills went up. */
	weapon: z.string().nullable(),
	/** INFERRED: round_killhs went up in the same update. */
	headshot: z.boolean()
});

export const sightingSchema = z.object({
	steamId: z.string().regex(/^\d{17}$/),
	name: z.string().nullable(),
	side: side.nullable(),
	/** Same side as the recorder when last seen. */
	teammate: z.boolean().nullable(),
	/** PARTIAL: match_stats as last seen while the recorder spectated this player. */
	kills: nint,
	assists: nint,
	deaths: nint,
	mvps: nint,
	score: nint,
	firstRound: nint,
	lastRound: nint,
	lastSeenAt: z.iso.datetime()
});

export const matchRecordSchema = z.object({
	v: z.literal(MATCH_RECORD_VERSION),
	/** Created by the recorder's tracker when the match started; stable across retries. */
	id: z.uuid(),
	recorderSteamId: z.string().regex(/^\d{17}$/),
	recorderName: z.string().nullable(),
	map: z.string().min(1).max(200),
	mode: z.string().min(1).max(100),
	startedAt: z.iso.datetime(),
	endedAt: z.iso.datetime(),
	durationS: z.number().min(0),
	status: z.enum(['complete', 'incomplete']),
	result: z.enum(['win', 'loss', 'tie', 'incomplete']),
	joinedMidMatch: z.boolean(),
	firstRound: z.number().int().positive(),
	mySideStart: side.nullable(),
	scoreMine: z.number().int().min(0),
	scoreTheirs: z.number().int().min(0),
	kills: z.number().int(),
	assists: z.number().int().min(0),
	deaths: z.number().int().min(0),
	mvps: z.number().int().min(0),
	score: z.number().int(),
	hsKills: z.number().int().min(0),
	/** Sum over rounds with damage; null when no round had any (see the round field). */
	damage: z.number().int().min(0).nullable(),
	/**
	 * Where damage came from: `demo` (the match demo's hit events, exact) or `gsi`
	 * (round_totaldmg, which current CS2 never sends). Optional: older clients leave it out.
	 */
	damageSource: z.enum(['gsi', 'demo']).nullable().optional(),
	roundsPlayed: z.number().int().min(0),
	adr: z.number().nullable(),
	hsPct: z.number().nullable(),
	kd: z.number().nullable(),
	/** map.round_wins as last seen: includes rounds from before a mid-match join. */
	roundWins: z.record(z.string(), z.string()),
	gsiVersion: z.number().int().nullable(),
	appVersion: z.string(),
	rounds: z.array(roundRecordSchema).max(200),
	killEvents: z.array(killEventSchema).max(1000),
	sightings: z.array(sightingSchema).max(50)
});

export type WeaponSnap = z.infer<typeof weaponSnapSchema>;
export type RoundRecord = z.infer<typeof roundRecordSchema>;
export type KillEventRecord = z.infer<typeof killEventSchema>;
export type SightingRecord = z.infer<typeof sightingSchema>;
export type MatchRecord = z.infer<typeof matchRecordSchema>;

/** Damage summed over the rounds that have it, and how many those are. */
export function damageTotals(rounds: { damage: number | null }[]) {
	const known = rounds.filter((r): r is { damage: number } => r.damage !== null);
	return {
		damage: known.length ? known.reduce((n, r) => n + r.damage, 0) : null,
		damageRounds: known.length
	};
}

/**
 * ADR, HS% and K/D from totals. Null when undefined (no damage data / no kills). ADR divides
 * by the rounds that have damage, not all rounds played.
 */
export function derivedRates(t: {
	damage: number | null;
	damageRounds: number;
	hsKills: number;
	roundKills: number;
	kills: number;
	deaths: number;
}) {
	const round2 = (n: number) => Math.round(n * 100) / 100;
	return {
		adr: t.damage !== null && t.damageRounds > 0 ? round2(t.damage / t.damageRounds) : null,
		hsPct: t.roundKills > 0 ? round2((100 * t.hsKills) / t.roundKills) : null,
		kd: round2(t.kills / Math.max(1, t.deaths))
	};
}
