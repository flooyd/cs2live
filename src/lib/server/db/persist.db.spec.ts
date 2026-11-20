import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, TEST_DATABASE_URL, type TestDb } from './testing.ts';
import { persistMatch, RecorderMismatchError } from './persist.ts';
import { killEvents, matches, players, rounds, sightings } from './schema.ts';
import { loadFixture, runFrames } from '../gsi/testing.ts';
import { SIM_ME, SIM_TEAMMATES } from '../gsi/sim/simulate.ts';
import type { MatchRecord } from '#lib/match-record.ts';

function recordOf(fixture: string): MatchRecord {
	const { records } = runFrames(loadFixture(fixture), { steamId: SIM_ME.steamId });
	expect(records).toHaveLength(1);
	// Fresh ids so runs never collide with each other.
	return { ...records[0], id: randomUUID() };
}

describe.skipIf(!TEST_DATABASE_URL)('persistMatch', () => {
	let t: TestDb;
	beforeAll(async () => {
		t = await openTestDb();
	});
	afterAll(() => t?.close());
	beforeEach(() => t.reset());

	const countOf = async (table: typeof rounds | typeof killEvents | typeof sightings, id: string) =>
		(await t.db.select({ n: count() }).from(table).where(eq(table.matchId, id)))[0].n;

	it('saves a full match with its rounds and kill events', async () => {
		const rec = recordOf('synthetic/full-match');
		await persistMatch(t.db, rec);

		const [m] = await t.db.select().from(matches).where(eq(matches.id, rec.id));
		expect(m).toMatchObject({
			recorderSteamId: SIM_ME.steamId,
			map: 'de_mirage',
			status: 'complete',
			roundsPlayed: 24,
			gameId: rec.id,
			source: 'direct'
		});
		expect(await countOf(rounds, rec.id)).toBe(24);
		expect(await countOf(killEvents, rec.id)).toBe(rec.killEvents.length);

		const [me] = await t.db.select().from(players).where(eq(players.steamId, SIM_ME.steamId));
		expect(me.name).toBe(SIM_ME.name);
		expect(me.lastRecordedAt?.toISOString()).toBe(new Date(rec.endedAt).toISOString());
	});

	it('is idempotent: saving the same match again replaces it', async () => {
		const rec = recordOf('synthetic/full-match');
		await persistMatch(t.db, rec);
		await persistMatch(t.db, { ...rec, kills: rec.kills + 1 }, 'upload');

		const all = await t.db.select().from(matches);
		expect(all).toHaveLength(1);
		expect(all[0].kills).toBe(rec.kills + 1);
		expect(all[0].source).toBe('upload');
		expect(await countOf(rounds, rec.id)).toBe(24);
		expect(await countOf(killEvents, rec.id)).toBe(rec.killEvents.length);
	});

	it("refuses to overwrite another player's match", async () => {
		const rec = recordOf('synthetic/full-match');
		await persistMatch(t.db, rec);
		const mate = SIM_TEAMMATES[0];
		await expect(
			persistMatch(t.db, { ...rec, recorderSteamId: mate.steamId, recorderName: mate.name })
		).rejects.toBeInstanceOf(RecorderMismatchError);
		const [m] = await t.db.select().from(matches);
		expect(m.recorderSteamId).toBe(SIM_ME.steamId);
	});

	it('stores partial sightings and creates players for them', async () => {
		const rec = recordOf('synthetic/death-spectate');
		expect(rec.sightings.length).toBeGreaterThan(0);
		await persistMatch(t.db, rec);

		const seen = await t.db.select().from(sightings).where(eq(sightings.matchId, rec.id));
		expect(seen.map((s) => s.steamId).sort()).toEqual(
			rec.sightings
				.map((s) => s.steamId)
				.filter((id) => id !== SIM_ME.steamId)
				.sort()
		);
		for (const s of seen) {
			const [p] = await t.db.select().from(players).where(eq(players.steamId, s.steamId));
			expect(p.lastRecordedAt).toBeNull();
		}
	});

	it('links recordings of the same game by different players', async () => {
		const mine = recordOf('synthetic/full-match');
		const mate = SIM_TEAMMATES[0];
		const foe = { steamId: '76561198000000001', name: 'Opponent' };
		const shifted = (ms: number) => (iso: string) => new Date(Date.parse(iso) + ms).toISOString();

		await persistMatch(t.db, mine);
		// A teammate's recording: same score, started a minute later.
		const mateRec: MatchRecord = {
			...mine,
			id: randomUUID(),
			recorderSteamId: mate.steamId,
			recorderName: mate.name,
			startedAt: shifted(60_000)(mine.startedAt),
			sightings: []
		};
		// An opponent's recording: mirrored score.
		const foeRec: MatchRecord = {
			...mine,
			id: randomUUID(),
			recorderSteamId: foe.steamId,
			recorderName: foe.name,
			scoreMine: mine.scoreTheirs,
			scoreTheirs: mine.scoreMine,
			sightings: []
		};
		// Same players, different map: a different game.
		const other: MatchRecord = { ...mateRec, id: randomUUID(), map: 'de_inferno' };
		for (const r of [mateRec, foeRec, other]) await persistMatch(t.db, r);

		const rows = await t.db.select({ id: matches.id, gameId: matches.gameId }).from(matches);
		const game = (id: string) => rows.find((r) => r.id === id)?.gameId;
		expect(game(mateRec.id)).toBe(game(mine.id));
		expect(game(foeRec.id)).toBe(game(mine.id));
		expect(game(other.id)).toBe(other.id);
	});
});
