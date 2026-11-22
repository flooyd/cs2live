// The demo fetcher with its real dependencies: the Steam helper, the download and the parser.
import { join } from 'node:path';
import type { MatchRecord } from '#lib/match-record.ts';
import { DemoFetcher, type DemoDeps, type DemoFetcherOptions } from './fetcher.ts';
import { boilerPath, isCs2Running, recentMatches } from './steam.ts';
import { obtainDemo, parseDemo, playdemoCommand, readDemoMatch, savedDemos } from './demo-file.ts';

const deps: DemoDeps = {
	available: () => boilerPath() !== null,
	isCs2Running,
	recentMatches,
	obtainDemo: (match, ownDir) => obtainDemo(match, ownDir),
	parseDemo,
	readDemoMatch,
	savedDemos: (ownDir) => savedDemos(ownDir),
	playdemo: (path) => playdemoCommand(path)
};

export function createDemoFetcher(
	dataDir: string,
	sink: { enqueue(record: MatchRecord): void },
	opts: Pick<DemoFetcherOptions, 'enabled' | 'steamId' | 'appVersion' | 'onChange'>
): DemoFetcher {
	return new DemoFetcher({ dir: join(dataDir, 'demos'), deps, sink, ...opts });
}
