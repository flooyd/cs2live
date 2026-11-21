import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, TEST_DATABASE_URL, type TestDb } from '../testing.ts';
import { persistMatch } from '../persist.ts';
import { listGames, matchDetail, playerMatches } from './matches.ts';
import { playerStats } from './player-stats.ts';
import { filterOptions, playerProfile, searchPlayers } from './players.ts';
import { loadFixture, runFrames } from '../../gsi/testing.ts';
import { SIM_ME, SIM_TEAMMATES } from '../../gsi/sim/simulate.ts';
import { sql } from 'drizzle-orm';
import { parseMatchFilters } from '#lib/match-filters.ts';
import { fakeSteamId } from '#lib/cs2/steamid.ts';
import type { MatchRecord } from '#lib/match-record.ts';

const recordOf = (fixture: string): MatchRecord => ({
	...runFrames(loadFixture(fixture), { steamId: SIM_ME.steamId }).records[0],
	id: randomUUID()
});
const noFilters = parseMatchFilters(new URLSearchParams());

describe.skipIf(!TEST_DATABASE_URL)('stats queries', () => {
	let t: TestDb;
	let full: MatchRecord;
	let spectate: MatchRecord;
	let mateCopy: MatchRecord;
	const MATE = SIM_TEAMMATES[0];

	beforeAll(async () => {
		t = await openTestDb();
		await t.reset();
		full = recordOf('synthetic/full-match');
		spectate = recordOf('synthetic/death-spectate');
		// The first teammate also recorded the death-spectate game.
		mateCopy = {
			...spectate,
			id: randomUUID(),
			recorderSteamId: MATE.steamId,
			recorderName: MATE.name,
			sightings: []
		};
		for (const r of [full, spectate, mateCopy]) await persistMatch(t.db, r);
	});
	afterAll(() => t?.close());

	it('lists one row per game', async () => {
		const games = await listGames(t.db, noFilters);
		expect(games.total).toBe(2);
		const shared = games.rows.find((g) => g.gameId === spectate.id || g.id === spectate.id);
		expect(shared?.recordings).toBe(2);
	});

	it("lists a player's own recordings and their partial sightings, without duplicates", async () => {
		const sightedOnly = spectate.sightings.find(
			(s) => s.steamId !== MATE.steamId && s.steamId !== SIM_ME.steamId
		)!;
		const theirs = await playerMatches(t.db, sightedOnly.steamId, noFilters);
		// One row per game they were spectated in (full-match may have seen them too).
		const gamesSeen = [full, spectate].filter((r) =>
			r.sightings.some((x) => x.steamId === sightedOnly.steamId)
		);
		expect(theirs.rows).toHaveLength(gamesSeen.length);
		const row = theirs.rows.find((r) => r.id === spectate.id)!;
		expect(row).toMatchObject({
			kind: 'sighting',
			recorderSteamId: SIM_ME.steamId,
			kills: sightedOnly.kills,
			adr: null
		});
		// A teammate's sighting shows the recorder's result and score.
		if (sightedOnly.teammate) {
			expect(row.result).toBe(spectate.result);
			expect(row.scoreMine).toBe(spectate.scoreMine);
		}
		const hidden = await playerMatches(t.db, sightedOnly.steamId, {
			...noFilters,
			sightings: false
		});
		expect(hidden.total).toBe(0);

		// The teammate recorded the game they were also spectated in: listed once, as recorded.
		const mate = await playerMatches(t.db, MATE.steamId, noFilters);
		expect(mate.rows.filter((r) => r.kind === 'sighting')).toHaveLength(
			full.sightings.some((s) => s.steamId === MATE.steamId) ? 1 : 0
		);
		expect(mate.rows.filter((r) => r.kind === 'recorded').map((r) => r.id)).toEqual([mateCopy.id]);

		const mine = await playerMatches(t.db, SIM_ME.steamId, noFilters);
		expect(mine.rows.map((r) => r.kind)).toEqual(['recorded', 'recorded']);
		expect(mine.rows[0].startedAt.getTime()).toBeGreaterThanOrEqual(
			mine.rows[1].startedAt.getTime()
		);
	});

	it('filters by map and result', async () => {
		const mirage = await playerMatches(t.db, SIM_ME.steamId, { ...noFilters, map: 'de_mirage' });
		expect(mirage.rows.map((r) => r.id)).toEqual([full.id]);
		const res = await playerMatches(t.db, SIM_ME.steamId, {
			...noFilters,
			result: full.result
		});
		expect(res.rows.map((r) => r.id)).toContain(full.id);
		const opts = await filterOptions(t.db, SIM_ME.steamId);
		expect(opts.maps.sort()).toEqual([full.map, spectate.map].sort());
	});

	it('adds up stats in SQL to the same totals as the records', async () => {
		const s = await playerStats(t.db, SIM_ME.steamId, noFilters);
		const recs = [full, spectate];
		const sum = (k: keyof MatchRecord) => recs.reduce((n, r) => n + (r[k] as number), 0);
		expect(s.totals).toMatchObject({
			matches: 2,
			kills: sum('kills'),
			deaths: sum('deaths'),
			damage: sum('damage'),
			rounds: sum('roundsPlayed'),
			hsKills: sum('hsKills')
		});
		expect(s.rates.adr).toBeCloseTo(sum('damage') / sum('roundsPlayed'), 5);
		const sideRounds = s.sides.reduce((n, x) => n + x.rounds, 0);
		const roundsWithSide = recs.flatMap((r) => r.rounds).filter((r) => r.mySide).length;
		expect(sideRounds).toBe(roundsWithSide);
		// Oldest first (both fixtures may start at the same instant).
		expect(s.form.map((f) => f.id).sort()).toEqual(recs.map((r) => r.id).sort());
		const times = s.form.map((f) => f.startedAt.getTime());
		expect(times).toEqual([...times].sort((a, b) => a - b));
		const killEventCount = recs.reduce((n, r) => n + r.killEvents.length, 0);
		expect(s.weapons.reduce((n, w) => n + w.kills, 0)).toBeLessThanOrEqual(killEventCount);
	});

	it('finds players and builds a match page', async () => {
		const hits = await searchPlayers(t.db, 'sim');
		expect(hits.map((h) => h.steamId)).toContain(SIM_ME.steamId);
		expect(await searchPlayers(t.db, '%')).toEqual([]);

		const profile = await playerProfile(t.db, MATE.steamId);
		expect(profile).toMatchObject({ recorded: 1, claimed: false });

		const detail = await matchDetail(t.db, spectate.id);
		expect(detail?.rounds).toHaveLength(spectate.roundsPlayed);
		expect(detail?.linked.map((l) => l.id)).toEqual([mateCopy.id]);
		expect(detail?.sightings.length).toBe(
			spectate.sightings.filter((s) => s.steamId !== SIM_ME.steamId).length
		);
		// Weapon tally: one row per weapon, adding up to the kill events, most kills first.
		const tally = detail?.weapons ?? [];
		expect(tally.reduce((n, w) => n + w.kills, 0)).toBe(spectate.killEvents.length);
		expect(new Set(tally.map((w) => w.weapon)).size).toBe(tally.length);
		expect(tally.map((w) => w.kills)).toEqual(tally.map((w) => w.kills).sort((a, b) => b - a));
		expect(tally.every((w) => w.hs <= w.kills)).toBe(true);
		expect(await matchDetail(t.db, randomUUID())).toBeNull();
	});
});

describe.skipIf(!TEST_DATABASE_URL)('unknown damage', () => {
	let t: TestDb;
	beforeAll(async () => {
		t = await openTestDb();
		await t.reset();
	});
	afterAll(() => t?.close());

	it('leaves matches without damage out of ADR instead of counting them as 0', async () => {
		const me = fakeSteamId(100);
		// A real match: CS2 sent no round_totaldmg, so damage is null.
		const real: MatchRecord = {
			...runFrames(loadFixture('real/wingman-inferno'), { steamId: me }).records[0],
			id: randomUUID()
		};
		// The same player in a match with damage (the simulator still sends round_totaldmg).
		const sim = runFrames(loadFixture('synthetic/full-match'), { steamId: SIM_ME.steamId });
		const withDamage: MatchRecord = {
			...sim.records[0],
			id: randomUUID(),
			recorderSteamId: me,
			sightings: []
		};
		// What a CS2Live version from before Nov 2026 uploads for a real match: 0, not null.
		const old: MatchRecord = {
			...real,
			id: randomUUID(),
			damage: 0,
			adr: 0,
			rounds: real.rounds.map((r) => ({ ...r, damage: 0 }))
		};
		for (const r of [real, withDamage, old]) await persistMatch(t.db, r);

		const s = await playerStats(t.db, me, noFilters);
		expect(s.totals.matches).toBe(3);
		expect(s.totals.damage).toBe(withDamage.damage);
		expect(s.totals.damageRounds).toBe(withDamage.roundsPlayed);
		expect(s.rates.adr).toBeCloseTo(withDamage.damage! / withDamage.roundsPlayed, 5);

		const stored = await t.db.execute<{ id: string; damage: number | null; adr: number | null }>(
			sql`select id, damage, adr from matches where id in (${real.id}, ${old.id})`
		);
		expect(stored.map((m) => [m.damage, m.adr])).toEqual([
			[null, null],
			[null, null]
		]);
		const oldRounds = await t.db.execute<{ n: number }>(
			sql`select count(*)::int as n from rounds where match_id = ${old.id} and damage is not null`
		);
		expect(oldRounds[0].n).toBe(0);
	});

	it('stores where damage came from, and keeps a real 0 from a demo', async () => {
		const me = fakeSteamId(101);
		const base: MatchRecord = {
			...runFrames(loadFixture('real/wingman-inferno'), { steamId: fakeSteamId(100) }).records[0],
			recorderSteamId: me
		};
		// An upload from an older client: damage but no source, so it came from GSI.
		const { damageSource: _, ...oldClient } = {
			...base,
			id: randomUUID(),
			damage: 700,
			adr: 50,
			rounds: base.rounds.map((r) => ({ ...r, damage: 50 }))
		};
		// A demo where you did no damage at all: 0 is a real number here.
		const zeroDemo: MatchRecord = {
			...base,
			id: randomUUID(),
			damage: 0,
			adr: 0,
			damageSource: 'demo',
			rounds: base.rounds.map((r) => ({ ...r, damage: 0 }))
		};
		const unknown: MatchRecord = { ...base, id: randomUUID() };
		for (const r of [oldClient, zeroDemo, unknown]) await persistMatch(t.db, r);

		const rows = await t.db.execute<{ id: string; damage: number | null; source: string | null }>(
			sql`select id, damage, damage_source as source from matches where recorder_steam_id = ${me}`
		);
		const byId = new Map(rows.map((r) => [r.id, [r.damage, r.source]]));
		expect(byId.get(oldClient.id)).toEqual([700, 'gsi']);
		expect(byId.get(zeroDemo.id)).toEqual([0, 'demo']);
		expect(byId.get(unknown.id)).toEqual([null, null]);
		expect((await matchDetail(t.db, zeroDemo.id))?.match.damageSource).toBe('demo');
	});
});
