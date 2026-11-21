// Saves a MatchRecord. Idempotent: upserts the match by id and replaces its rounds, kill
// events and sightings, so a duplicate gameover or a re-sent upload never creates a second
// match. No framework imports (the seed script uses it too).
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { killEvents, matches, players, rounds, sightings } from './schema.ts';
import type { MatchRecord } from '#lib/match-record.ts';

export class RecorderMismatchError extends Error {}

/** How close two recordings' start times must be to count as the same game. */
const SAME_GAME_WINDOW_MS = 10 * 60_000;

/**
 * A match with no damage at all is stored as unknown. CS2 sends no round_totaldmg, and CS2Live
 * versions from before Nov 2026 recorded that as 0 damage (and 0 ADR) instead of null.
 */
export function withUnknownDamage(record: MatchRecord): MatchRecord {
	// A demo is exact, so 0 from a demo is a real 0.
	if (record.damage !== 0 || record.damageSource === 'demo') return record;
	return {
		...record,
		damage: null,
		damageSource: null,
		adr: null,
		rounds: record.rounds.map((r) => ({ ...r, damage: null }))
	};
}

export async function persistMatch(
	db: Db,
	input: MatchRecord,
	source: 'direct' | 'upload' = 'direct'
) {
	const record = withUnknownDamage(input);
	const startedAt = new Date(record.startedAt);
	const endedAt = new Date(record.endedAt);

	await db.transaction(async (tx) => {
		const existing = await tx
			.select({ recorder: matches.recorderSteamId })
			.from(matches)
			.where(eq(matches.id, record.id));
		if (existing[0] && existing[0].recorder !== record.recorderSteamId) {
			throw new RecorderMismatchError('This match id belongs to another player.');
		}

		const people = new Map<string, string | null>([[record.recorderSteamId, record.recorderName]]);
		for (const s of record.sightings) if (!people.has(s.steamId)) people.set(s.steamId, s.name);
		for (const [steamId, name] of people) {
			const isRecorder = steamId === record.recorderSteamId;
			await tx
				.insert(players)
				.values({
					steamId,
					name,
					firstSeenAt: startedAt,
					lastSeenAt: endedAt,
					lastRecordedAt: isRecorder ? endedAt : null
				})
				.onConflictDoUpdate({
					target: players.steamId,
					set: {
						name: sql`coalesce(${name}, ${players.name})`,
						firstSeenAt: sql`least(${players.firstSeenAt}, ${startedAt.toISOString()}::timestamptz)`,
						lastSeenAt: sql`greatest(${players.lastSeenAt}, ${endedAt.toISOString()}::timestamptz)`,
						...(isRecorder
							? {
									lastRecordedAt: sql`greatest(coalesce(${players.lastRecordedAt}, ${endedAt.toISOString()}::timestamptz), ${endedAt.toISOString()}::timestamptz)`
								}
							: {})
					}
				});
		}

		const gameId = await findGameId(tx as unknown as Db, record, startedAt);

		const values = {
			id: record.id,
			recorderSteamId: record.recorderSteamId,
			gameId,
			map: record.map,
			mode: record.mode,
			startedAt,
			endedAt,
			durationS: Math.round(record.durationS),
			status: record.status,
			result: record.result,
			joinedMidMatch: record.joinedMidMatch,
			firstRound: record.firstRound,
			myTeamStart: record.mySideStart,
			scoreMine: record.scoreMine,
			scoreTheirs: record.scoreTheirs,
			kills: record.kills,
			assists: record.assists,
			deaths: record.deaths,
			mvps: record.mvps,
			score: record.score,
			hsKills: record.hsKills,
			damage: record.damage,
			// Older clients send no source; their damage, if any, came from GSI.
			damageSource: record.damageSource ?? (record.damage !== null ? 'gsi' : null),
			roundsPlayed: record.roundsPlayed,
			adr: record.adr,
			hsPct: record.hsPct,
			kd: record.kd,
			roundWins: record.roundWins,
			gsiVersion: record.gsiVersion,
			appVersion: record.appVersion,
			source
		};
		const { id: _id, ...update } = values;
		await tx
			.insert(matches)
			.values(values)
			.onConflictDoUpdate({ target: matches.id, set: { ...update, updatedAt: new Date() } });

		await tx.delete(rounds).where(eq(rounds.matchId, record.id));
		await tx.delete(killEvents).where(eq(killEvents.matchId, record.id));
		await tx.delete(sightings).where(eq(sightings.matchId, record.id));

		if (record.rounds.length) {
			await tx.insert(rounds).values(
				record.rounds.map((r) => ({
					matchId: record.id,
					number: r.number,
					mySide: r.mySide,
					winnerSide: r.winnerSide,
					winReason: r.winReason,
					iWon: r.iWon,
					bomb: r.bomb,
					kills: r.kills,
					hsKills: r.hsKills,
					damage: r.damage,
					assists: r.assists,
					survived: r.survived,
					healthEnd: r.healthEnd,
					moneyFreezeStart: r.moneyFreezeStart,
					moneyFreezeEnd: r.moneyFreezeEnd,
					moneyEnd: r.moneyEnd,
					equipValue: r.equipValue,
					weaponsFreezeEnd: r.weaponsFreezeEnd,
					primaryWeapon: r.primaryWeapon,
					buyType: r.buyType,
					mvp: r.mvp,
					startedAt: r.startedAt ? new Date(r.startedAt) : null,
					liveAt: r.liveAt ? new Date(r.liveAt) : null,
					endedAt: r.endedAt ? new Date(r.endedAt) : null,
					durationS: r.durationS,
					partial: r.partial
				}))
			);
		}
		if (record.killEvents.length) {
			await tx.insert(killEvents).values(
				record.killEvents.map((k) => ({
					matchId: record.id,
					round: k.round,
					at: new Date(k.at),
					weapon: k.weapon,
					headshot: k.headshot
				}))
			);
		}
		const others = record.sightings.filter((s) => s.steamId !== record.recorderSteamId);
		if (others.length) {
			await tx.insert(sightings).values(
				others.map((s) => ({
					matchId: record.id,
					steamId: s.steamId,
					name: s.name,
					side: s.side,
					teammate: s.teammate,
					kills: s.kills,
					assists: s.assists,
					deaths: s.deaths,
					mvps: s.mvps,
					score: s.score,
					firstRound: s.firstRound,
					lastRound: s.lastRound,
					lastSeenAt: new Date(s.lastSeenAt)
				}))
			);
		}
	});
}

/**
 * Another player's recording of the same game: same map and mode, started within ten minutes,
 * and the same final score from either side (or one of them incomplete). Links them with a
 * shared game_id so a match page can show every recording.
 */
async function findGameId(db: Db, record: MatchRecord, startedAt: Date): Promise<string> {
	const lo = new Date(startedAt.getTime() - SAME_GAME_WINDOW_MS);
	const hi = new Date(startedAt.getTime() + SAME_GAME_WINDOW_MS);
	const candidates = await db
		.select({
			id: matches.id,
			gameId: matches.gameId,
			status: matches.status,
			scoreMine: matches.scoreMine,
			scoreTheirs: matches.scoreTheirs
		})
		.from(matches)
		.where(
			and(
				eq(matches.map, record.map),
				eq(matches.mode, record.mode),
				ne(matches.recorderSteamId, record.recorderSteamId),
				ne(matches.id, record.id),
				gte(matches.startedAt, lo),
				lte(matches.startedAt, hi)
			)
		);
	const match = candidates.find(
		(c) =>
			c.status === 'incomplete' ||
			record.status === 'incomplete' ||
			(c.scoreMine === record.scoreMine && c.scoreTheirs === record.scoreTheirs) ||
			(c.scoreMine === record.scoreTheirs && c.scoreTheirs === record.scoreMine)
	);
	if (!match) {
		const own = await db
			.select({ gameId: matches.gameId })
			.from(matches)
			.where(eq(matches.id, record.id));
		return own[0]?.gameId ?? record.id;
	}
	const gameId = match.gameId ?? match.id;
	if (!match.gameId) await db.update(matches).set({ gameId }).where(eq(matches.id, match.id));
	return gameId;
}
