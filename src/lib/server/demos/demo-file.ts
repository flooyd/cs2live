// Gets a match's demo onto this PC, keeps it for watching in CS2, and reads it. Node-only.
//
// Demos go in CS2's own replays folder (`game/csgo/replays`), named the way CS2 names the demos it
// downloads from the Watch tab and with the same `.dem.info` next to them, so CS2 can play them
// (`playdemo replays/match730_…`). They are never deleted. Without CS2 on this PC, or when its
// folder can't be written, they go in CS2Live's data folder instead.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import bz2 from 'unbzip2-stream';
import { findCs2CfgDir } from '../gsi/cs2-paths.ts';
import { cs2DemoName, decodeMatchInfo, type GcMatch } from './gc-match-list.ts';
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

/** The file name (without `.dem`) a match's demo has, or gets, on this PC. */
function demoName(match: GcMatch): string {
	return (match.demoUrl && cs2DemoName(match.demoUrl)) || `match730_${match.matchId}`;
}

/** The match's demo if it is already on this PC: by its name, or by the match id in a `.dem.info`. */
async function findLocalDemo(match: GcMatch, dirs: string[]): Promise<string | null> {
	const name = `${demoName(match)}.dem`;
	for (const dir of dirs) {
		if (existsSync(join(dir, name))) return join(dir, name);
	}
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const file of await readdir(dir)) {
			if (!file.endsWith('.dem.info')) continue;
			const demo = join(dir, file.slice(0, -'.info'.length));
			try {
				const info = decodeMatchInfo(await readFile(join(dir, file)));
				if (info.matchId === match.matchId && existsSync(demo)) return demo;
			} catch {
				// Not a match info file we can read; skip it.
			}
		}
	}
	return null;
}

/** Valve's replay servers (Perfect World's for China). Nothing else gets downloaded. */
const DEMO_HOST = /^(?:[a-z0-9-]+\.)*(?:valve\.net|wmsj\.cn)$/i;

export interface DemoOnDisk {
	path: string;
	/** Downloaded just now, rather than already on this PC. */
	downloaded: boolean;
}

/** Creates `file` in the first of `dirs` that lets us. */
async function createIn(
	dirs: string[],
	file: string
): Promise<{ dir: string; handle: FileHandle }> {
	let error: unknown = null;
	for (const dir of dirs) {
		try {
			await mkdir(dir, { recursive: true });
			return { dir, handle: await open(join(dir, file), 'w') };
		} catch (err) {
			error ??= err;
		}
	}
	throw new DemoError('failed', `Could not save the demo: ${(error as Error).message}`, {
		cause: error
	});
}

/**
 * The match's demo on this PC: found where CS2 or CS2Live saved it, or downloaded from Valve into
 * CS2's replays folder (`ownDir` when CS2's can't be used) and kept there.
 */
export async function obtainDemo(
	match: GcMatch,
	ownDir: string,
	replaysDir: string | null = cs2ReplaysDir()
): Promise<DemoOnDisk> {
	const dirs = replaysDir ? [replaysDir, ownDir] : [ownDir];
	const local = await findLocalDemo(match, dirs);
	if (local) return { path: local, downloaded: false };
	if (!match.demoUrl) {
		throw new DemoError('no-demo', 'Valve has no demo for this match (yet, or any more).');
	}
	const url = new URL(match.demoUrl);
	if (!/^https?:$/.test(url.protocol) || !DEMO_HOST.test(url.hostname)) {
		throw new DemoError('failed', `Unexpected demo address host: ${url.hostname}`);
	}
	const name = demoName(match);
	let part: string | null = null;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
		if (res.status === 404) throw new DemoError('no-demo', 'Valve no longer has this demo.');
		if (!res.ok || !res.body) {
			throw new DemoError('failed', `Downloading the demo failed (HTTP ${res.status}).`);
		}
		// Written under another name until it is complete, so a cut download never looks like a demo.
		const { dir, handle } = await createIn(dirs, `${name}.dem.part`).catch(async (err) => {
			await res.body?.cancel().catch(() => {});
			throw err;
		});
		part = join(dir, `${name}.dem.part`);
		const out = handle.createWriteStream();
		// Straight into the pipeline, which handles its errors (a dropped connection).
		const body = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
		// Valve serves .dem.bz2 (about 25 MB for 40 MB of demo); unpacked as it arrives.
		if (url.pathname.endsWith('.bz2')) await pipeline(body, bz2(), out);
		else await pipeline(body, out);
		const dem = join(dir, `${name}.dem`);
		await rename(part, dem);
		part = null;
		// CS2 keeps the match details next to a demo it downloads; CS2Live finds demos by it too.
		if (match.info) await writeFile(`${dem}.info`, match.info).catch(() => {});
		return { path: dem, downloaded: true };
	} catch (err) {
		if (part) await rm(part, { force: true }).catch(() => {});
		if (err instanceof DemoError) throw err;
		throw new DemoError('failed', `Downloading the demo failed: ${(err as Error).message}`, {
			cause: err
		});
	}
}

export interface SavedDemos {
	/** Where new demos go. */
	dir: string;
	count: number;
	bytes: number;
}

/** The match demos on this PC: CS2's own downloads and the ones CS2Live kept. */
export function savedDemos(
	ownDir: string,
	replaysDir: string | null = cs2ReplaysDir()
): SavedDemos {
	const dirs = replaysDir ? [replaysDir, ownDir] : [ownDir];
	let count = 0;
	let bytes = 0;
	for (const dir of dirs) {
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith('.dem'));
		} catch {
			continue; // Not there yet.
		}
		for (const file of files) {
			try {
				bytes += statSync(join(dir, file)).size;
				count++;
			} catch {
				// Gone since the listing.
			}
		}
	}
	return { dir: dirs[0], count, bytes };
}

/**
 * The CS2 console command that plays a demo (`playdemo replays/match730_…`): CS2 looks for demos
 * under `game/csgo`. Null for a demo outside it, which CS2 can't reach by name.
 */
export function playdemoCommand(
	path: string,
	replaysDir: string | null = cs2ReplaysDir()
): string | null {
	if (!replaysDir) return null;
	const rel = relative(dirname(replaysDir), path);
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
	return `playdemo ${rel
		.split(sep)
		.join('/')
		.replace(/\.dem$/i, '')}`;
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
