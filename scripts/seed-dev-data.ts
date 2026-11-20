// yarn db:seed [--matches 40] [--reset] [--yes]
//
// Fills the database with simulated matches so the history and stats pages have something to
// show. Every player it creates has a synthetic Steam ID from the reserved fake range (see
// src/lib/cs2/steamid.ts), so seed data never mixes with real accounts, and --reset deletes
// exactly those rows. Matches go through the real simulator -> match tracker -> persistMatch
// path, so they look like real recordings.
//
// It refuses to touch a Neon database unless you pass --yes.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../src/lib/server/db/client.ts';
import { persistMatch } from '../src/lib/server/db/persist.ts';
import { runFrames } from '../src/lib/server/gsi/testing.ts';
import {
	rng,
	simulateMatch,
	SIM_ME,
	SIM_TEAMMATES,
	type SimPlayer
} from '../src/lib/server/gsi/sim/simulate.ts';
import { fakeSteamId, FAKE_STEAMID_FIRST } from '../src/lib/cs2/steamid.ts';
import type { MatchRecord } from '../src/lib/match-record.ts';

const args = process.argv.slice(2);
const has = (name: string) => args.includes(name);
const value = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set (put it in .env).');
	process.exit(1);
}
if (/neon\.tech/.test(url) && !has('--yes')) {
	console.error(
		'DATABASE_URL points at Neon. Seed data is clearly fake but lives next to real data;\n' +
			'pass --yes if you really want it there (and `yarn db:seed --reset` removes it).'
	);
	process.exit(1);
}

/** Other recorders: friends who also run CS2Live. */
const FRIENDS: SimPlayer[] = [
	{ steamId: fakeSteamId(6), name: 'Friend Six' },
	{ steamId: fakeSteamId(7), name: 'Friend Seven' }
];
const MAPS = [
	'de_mirage',
	'de_inferno',
	'de_ancient',
	'de_nuke',
	'de_anubis',
	'de_dust2',
	'de_train'
];
const FAKE_LAST = FAKE_STEAMID_FIRST + 1_000_000n;

async function reset(db: Db) {
	const range = sql`::numeric between ${FAKE_STEAMID_FIRST.toString()}::numeric and ${FAKE_LAST.toString()}::numeric`;
	const res = await db.execute(
		sql`delete from matches where recorder_steam_id${range} returning id`
	);
	await db.execute(sql`delete from sightings where steam_id${range}`);
	await db.execute(
		sql`delete from players p where steam_id${range} and not exists (select 1 from steam_links l where l.steam_id = p.steam_id)`
	);
	console.log(`Removed ${res.length} seeded matches and their players.`);
}

interface Plan {
	me: SimPlayer;
	teammates: SimPlayer[];
	seed: number;
	map: string;
	mode: string;
	startAt: number;
	extra: Partial<Parameters<typeof simulateMatch>[0]>;
}

function record(plan: Plan): MatchRecord | null {
	const frames = simulateMatch({
		seed: plan.seed,
		map: plan.map,
		mode: plan.mode,
		me: plan.me,
		teammates: plan.teammates,
		startAt: plan.startAt,
		winChance: 0.35 + (plan.seed % 7) / 20,
		...plan.extra
	});
	const { records } = runFrames(frames, { steamId: plan.me.steamId, newId: randomUUID });
	return records[0] ?? null;
}

/**
 * A teammate's recording of the same game: same map, score and round results, but their own
 * personal numbers (taken from another simulated run). persistMatch links the two by game_id.
 */
function teammateRecording(mine: MatchRecord, mate: SimPlayer, seed: number): MatchRecord | null {
	const other = record({
		me: mate,
		teammates: [SIM_ME, ...SIM_TEAMMATES.filter((t) => t.steamId !== mate.steamId).slice(0, 3)],
		seed,
		map: mine.map,
		mode: mine.mode,
		startAt: Date.parse(mine.startedAt),
		extra: {}
	});
	if (!other) return null;
	const rounds = mine.rounds.map((r, i) => {
		const o = other.rounds[i];
		return o ? { ...r, ...pick(o), number: r.number } : { ...r, kills: 0, hsKills: 0, damage: 0 };
	});
	const sum = (k: 'kills' | 'hsKills' | 'damage') => rounds.reduce((n, r) => n + r[k], 0);
	const kills = sum('kills');
	const damage = sum('damage');
	return {
		...mine,
		id: randomUUID(),
		recorderSteamId: mate.steamId,
		recorderName: mate.name,
		startedAt: new Date(Date.parse(mine.startedAt) + 40_000).toISOString(),
		kills,
		hsKills: sum('hsKills'),
		damage,
		deaths: other.deaths,
		assists: other.assists,
		mvps: other.mvps,
		score: other.score,
		adr: mine.roundsPlayed ? Math.round((damage / mine.roundsPlayed) * 100) / 100 : null,
		hsPct: kills ? Math.round((10000 * sum('hsKills')) / kills) / 100 : null,
		kd: Math.round((kills / Math.max(1, other.deaths)) * 100) / 100,
		rounds,
		killEvents: [],
		sightings: []
	};
}

function pick(r: MatchRecord['rounds'][number]) {
	const { kills, hsKills, damage, assists, survived, healthEnd, buyType, equipValue, mvp } = r;
	return { kills, hsKills, damage, assists, survived, healthEnd, buyType, equipValue, mvp };
}

const { db, client } = createDb(url, { max: 2 });
try {
	if (has('--reset')) {
		await reset(db);
	} else {
		const count = Number(value('--matches') ?? 40);
		const rand = rng(20261120).next;
		const now = Date.now();
		const day = 86_400_000;
		const plans: Plan[] = [];

		for (let i = 0; i < count; i++) {
			const r = rand();
			const wingman = r < 0.12;
			plans.push({
				me: SIM_ME,
				teammates: wingman ? SIM_TEAMMATES.slice(0, 1) : SIM_TEAMMATES,
				seed: 1000 + i,
				map: wingman ? ['de_inferno', 'de_nuke', 'de_vertigo'][i % 3] : MAPS[i % MAPS.length],
				mode: wingman ? 'scrimcomp2v2' : rand() < 0.6 ? 'competitive' : 'premier',
				startAt:
					now - Math.floor((count - i) * (60 / count) * day) - Math.floor(rand() * 6) * 3_600_000,
				extra: {
					joinAtRound: rand() < 0.08 ? 3 + Math.floor(rand() * 6) : undefined,
					quitAfterRound: rand() < 0.06 ? 8 + Math.floor(rand() * 8) : undefined,
					forceOvertime: rand() < 0.06
				}
			});
		}
		for (const [n, friend] of FRIENDS.entries()) {
			for (let i = 0; i < 8; i++) {
				plans.push({
					me: friend,
					teammates: SIM_TEAMMATES.slice(1),
					seed: 5000 + n * 100 + i,
					map: MAPS[(i * 3 + n) % MAPS.length],
					mode: 'premier',
					startAt: now - (i * 6 + n + 1) * day,
					extra: {}
				});
			}
		}

		let saved = 0;
		let linked = 0;
		for (const [i, plan] of plans.entries()) {
			const rec = record(plan);
			if (!rec) continue;
			await persistMatch(db, rec);
			saved++;
			// Every fifth match of the main player was also recorded by a teammate.
			if (plan.me === SIM_ME && i % 5 === 2 && rec.status === 'complete') {
				const mate = SIM_TEAMMATES[i % SIM_TEAMMATES.length];
				const theirs = teammateRecording(rec, mate, plan.seed + 77);
				if (theirs) {
					await persistMatch(db, theirs);
					linked++;
				}
			}
		}
		console.log(
			`Seeded ${saved} matches (+${linked} teammate recordings of the same games).\n` +
				`Main player: ${SIM_ME.name} ${SIM_ME.steamId}. Remove with: yarn db:seed --reset`
		);
	}
} finally {
	await client.end();
}
