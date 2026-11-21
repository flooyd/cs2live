// The demo fetcher with its real dependencies: the Steam helper, the download and the parser.
import { join } from 'node:path';
import type { MatchRecord } from '#lib/match-record.ts';
import { DemoFetcher, type DemoDeps } from './fetcher.ts';
import { boilerPath, isCs2Running, recentMatches } from './steam.ts';
import { obtainDemo, parseDemo } from './demo-file.ts';

const deps: DemoDeps = {
	available: () => boilerPath() !== null,
	isCs2Running,
	recentMatches,
	obtainDemo: (match, workDir) => obtainDemo(match, workDir),
	parseDemo
};

export function createDemoFetcher(
	dataDir: string,
	sink: { enqueue(record: MatchRecord): void },
	enabled: () => boolean,
	onChange: () => void
): DemoFetcher {
	return new DemoFetcher({ dir: join(dataDir, 'demos'), deps, sink, enabled, onChange });
}
