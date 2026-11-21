// Gets a match's demo onto disk and reads your damage from it. Node-only.
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import bz2 from 'unbzip2-stream';
import { findCs2CfgDir } from '../gsi/cs2-paths.ts';
import { decodeMatchInfo, type GcMatch } from './gc-match-list.ts';
import { damageByRound, type FreezeEndEvent, type HurtEvent } from './demo-damage.ts';
import {
	PLAYER_PROPS,
	sampleTicks,
	type BombEvent,
	type DeathEvent,
	type DemoEvent,
	type DemoEvents,
	type DemoMatchData,
	type PlayerTick,
	type RoundEndEvent
} from './demo-record.ts';
import { DemoError } from './steam.ts';

/** CS2's own demo folder (`game/csgo/replays`), where the Watch tab saves downloads. */
export function cs2ReplaysDir(): string | null {
	const cfg = findCs2CfgDir();
	return cfg ? join(dirname(cfg), 'replays') : null;
}

/** A demo you already downloaded in CS2, found by the match id in its `.dem.info`. */
async function findLocalDemo(match: GcMatch, replaysDir: string | null): Promise<string | null> {
	if (!replaysDir || !existsSync(replaysDir)) return null;
	for (const name of await readdir(replaysDir)) {
		if (!name.endsWith('.dem.info')) continue;
		const demo = join(replaysDir, name.slice(0, -'.info'.length));
		try {
			const info = decodeMatchInfo(await readFile(join(replaysDir, name)));
			if (info.matchId === match.matchId && existsSync(demo)) return demo;
		} catch {
			// Not a match info file we can read; skip it.
		}
	}
	return null;
}

/** Valve's replay servers (Perfect World's for China). Nothing else gets downloaded. */
const DEMO_HOST = /^(?:[a-z0-9-]+\.)*(?:valve\.net|wmsj\.cn)$/i;

export interface DemoOnDisk {
	path: string;
	/** Downloaded by us, so delete it after reading. */
	temporary: boolean;
}

export async function obtainDemo(
	match: GcMatch,
	workDir: string,
	replaysDir: string | null = cs2ReplaysDir()
): Promise<DemoOnDisk> {
	const local = await findLocalDemo(match, replaysDir);
	if (local) return { path: local, temporary: false };
	if (!match.demoUrl) {
		throw new DemoError('no-demo', 'Valve has no demo for this match (yet, or any more).');
	}
	const url = new URL(match.demoUrl);
	if (!/^https?:$/.test(url.protocol) || !DEMO_HOST.test(url.hostname)) {
		throw new DemoError('failed', `Unexpected demo address host: ${url.hostname}`);
	}
	await mkdir(workDir, { recursive: true });
	const dem = join(workDir, `${match.matchId}.dem`);
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
		if (res.status === 404) throw new DemoError('no-demo', 'Valve no longer has this demo.');
		if (!res.ok || !res.body) {
			throw new DemoError('failed', `Downloading the demo failed (HTTP ${res.status}).`);
		}
		const body = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
		// Valve serves .dem.bz2 (about 25 MB for 40 MB of demo); unpacked as it arrives.
		if (url.pathname.endsWith('.bz2')) await pipeline(body, bz2(), createWriteStream(dem));
		else await pipeline(body, createWriteStream(dem));
		return { path: dem, temporary: true };
	} catch (err) {
		await rm(dem, { force: true });
		if (err instanceof DemoError) throw err;
		throw new DemoError('failed', `Downloading the demo failed: ${(err as Error).message}`, {
			cause: err
		});
	}
}

interface DemoParser {
	parseHeader(path: string): { map_name?: string };
	parsePlayerInfo(path: string): { steamid?: string | number }[];
	parseEvent(path: string, event: string, player?: string[], other?: string[]): unknown[];
	parseEvents(path: string, events: string[], player?: string[], other?: string[]): unknown[];
	parseTicks(path: string, props: string[], ticks?: number[]): unknown[];
}

// demoparser2 is a native module. Loaded on first use, from a variable so bundlers and Vercel's
// file tracer leave it alone (it only runs on the PC you play on).
const PARSER_PACKAGE = '@laihoe/demoparser2';
let parser: DemoParser | null = null;
function loadParser(): DemoParser {
	parser ??= createRequire(import.meta.url)(PARSER_PACKAGE) as DemoParser;
	return parser;
}

export interface ParsedDemo {
	map: string | null;
	/** Whether the player is in the demo at all. */
	present: boolean;
	rounds: number;
	damage: Map<number, number>;
}

export function parseDemo(path: string, steamId: string): ParsedDemo {
	try {
		const dp = loadParser();
		const header = dp.parseHeader(path);
		const players = dp.parsePlayerInfo(path);
		const hurt = dp.parseEvent(path, 'player_hurt', ['team_num'], ['is_warmup_period']);
		const freeze = dp.parseEvent(
			path,
			'round_freeze_end',
			[],
			['total_rounds_played', 'is_warmup_period']
		);
		return {
			map: header.map_name ?? null,
			present: players.some((p) => String(p.steamid) === steamId),
			...damageByRound(steamId, hurt as HurtEvent[], freeze as FreezeEndEvent[])
		};
	} catch (err) {
		throw new DemoError('failed', `Could not read the demo: ${(err as Error).message}`, {
			cause: err
		});
	}
}

const MATCH_EVENTS = [
	'begin_new_match',
	'round_start',
	'round_freeze_end',
	'round_end',
	'cs_win_panel_match',
	'player_death',
	'player_hurt',
	'bomb_planted',
	'bomb_defused',
	'bomb_exploded',
	'rank_update',
	'server_cvar'
];

/** Everything `matchFromDemo` needs, in two passes over the demo (events, then player state). */
export function readDemoMatch(path: string, steamId: string): DemoMatchData {
	try {
		const dp = loadParser();
		const header = dp.parseHeader(path);
		const rows = dp.parseEvents(
			path,
			MATCH_EVENTS,
			['team_num'],
			['total_rounds_played', 'is_warmup_period']
		) as (DemoEvent & Record<string, unknown>)[];
		const of = <T>(name: string) => rows.filter((r) => r.event_name === name) as T[];
		const bomb = (name: string, kind: BombEvent['kind']): BombEvent[] =>
			of<DemoEvent>(name).map((e) => ({ tick: e.tick, kind }));
		const cvars: Record<string, string> = {};
		for (const c of of<Record<string, unknown>>('server_cvar')) {
			const name = c.name ?? c.cvarname;
			const value = c.value ?? c.cvarvalue;
			if (typeof name === 'string' && (typeof value === 'string' || typeof value === 'number')) {
				cvars[name] = String(value);
			}
		}
		const events: DemoEvents = {
			map: header.map_name ?? null,
			rankTypeIds: of<{ rank_type_id?: unknown }>('rank_update')
				.map((e) => e.rank_type_id)
				.filter((t): t is number => typeof t === 'number'),
			cvars,
			matchStarts: of<DemoEvent>('begin_new_match'),
			roundStarts: of<DemoEvent>('round_start'),
			freezeEnds: of<FreezeEndEvent>('round_freeze_end'),
			roundEnds: of<RoundEndEvent>('round_end'),
			matchEnds: of<DemoEvent>('cs_win_panel_match'),
			deaths: of<DeathEvent>('player_death'),
			hurt: of<HurtEvent>('player_hurt'),
			bombs: [
				...bomb('bomb_planted', 'planted'),
				...bomb('bomb_defused', 'defused'),
				...bomb('bomb_exploded', 'exploded')
			].sort((a, b) => a.tick - b.tick)
		};
		const ticks = dp.parseTicks(path, [...PLAYER_PROPS], sampleTicks(events, steamId));
		return { ...events, ticks: ticks as PlayerTick[] };
	} catch (err) {
		throw new DemoError('failed', `Could not read the demo: ${(err as Error).message}`, {
			cause: err
		});
	}
}
