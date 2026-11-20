// Test helpers: load NDJSON fixtures and run them through the tracker. Node-only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePayload } from './schema.ts';
import { MatchTracker, type TrackerEvent, type TrackerOptions } from './match-tracker.ts';
import type { Frame } from './sim/simulate.ts';
import type { MatchRecord } from '#lib/match-record.ts';

/** Reads an NDJSON capture or fixture: skips the meta line and blank lines. */
export function readNdjson(path: string): Frame[] {
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as { t?: number; p?: unknown; meta?: unknown })
		.filter((row): row is Frame => typeof row.t === 'number' && !!row.p);
}

export function loadFixture(name: string): Frame[] {
	return readNdjson(
		join(process.cwd(), 'fixtures', name.endsWith('.ndjson') ? name : `${name}.ndjson`)
	);
}

const TICK_MS = 5000;

export interface RunResult {
	tracker: MatchTracker;
	events: TrackerEvent[];
	records: MatchRecord[];
}

/** Feeds frames to a fresh tracker, then ticks well past the timeout. */
export function runFrames(
	frames: Frame[],
	options: Partial<TrackerOptions> & { steamId: string },
	{ tickAfterMs = 10 * 60_000 } = {}
): RunResult {
	let n = 0;
	const tracker = new MatchTracker({
		incompleteTimeoutMs: 120_000,
		newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
		...options
	});
	const events: TrackerEvent[] = [];
	// The live runtime ticks every 5 s of wall time, including through gaps in the feed.
	let nextTick = (frames[0]?.t ?? 0) + TICK_MS;
	for (const f of frames) {
		for (; nextTick <= f.t; nextTick += TICK_MS) events.push(...tracker.tick(nextTick));
		const p = parsePayload(f.p);
		if (p) events.push(...tracker.ingest(p, f.t));
	}
	const last = frames.at(-1)?.t ?? 0;
	events.push(...tracker.tick(last + tickAfterMs));
	const records = events.flatMap((e) => (e.type === 'match_ended' ? [e.record] : []));
	return { tracker, events, records };
}
