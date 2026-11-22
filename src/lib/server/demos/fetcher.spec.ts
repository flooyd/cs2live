import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative as relativePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture, runFrames } from '../gsi/testing.ts';
import { fakeSteamId } from '#lib/cs2/steamid.ts';
import type { MatchRecord } from '#lib/match-record.ts';
import { DemoFetcher, type DemoDeps } from './fetcher.ts';
import type { GcMatch, GcMatchList } from './gc-match-list.ts';
import { accountIdOf } from './match-demo.ts';
import { DemoError } from './steam.ts';
import { demoRecordId } from './demo-record.ts';
import { syntheticDemo } from './testing.ts';

const ME = fakeSteamId(100);
const real = runFrames(loadFixture('real/wingman-inferno'), { steamId: ME }).records[0];
const ended = Date.parse(real.endedAt);
const HOUR = 3600_000;

const listed: GcMatch = {
	matchId: '42',
	matchTime: Date.parse(real.startedAt) - 60_000,
	accountIds: [accountIdOf(ME)],
	teamScores: [real.scoreMine, real.scoreTheirs],
	demoUrl: 'http://replay1.valve.net/730/42.dem.bz2',
	durationS: 800
};
const fullDamage = () => new Map(real.rounds.map((r) => [r.number, 60]));

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs2live-demos-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(
	over: Partial<DemoDeps> = {},
	opts: { now?: number; enabled?: boolean; steamId?: string | null } = {}
) {
	const sent: MatchRecord[] = [];
	const list: GcMatchList = { accountId: accountIdOf(ME), matches: [listed] };
	const deps: DemoDeps = {
		available: () => true,
		isCs2Running: vi.fn(() => Promise.resolve(false)),
		recentMatches: vi.fn(() => Promise.resolve(list)),
		obtainDemo: vi.fn(() => {
			const file = join(dir, 'demo.dem');
			writeFileSync(file, 'demo');
			return Promise.resolve({ path: file, downloaded: false });
		}),
		parseDemo: vi.fn(() => ({ map: real.map, present: true, rounds: 14, damage: fullDamage() })),
		readDemoMatch: vi.fn(() => syntheticDemo(ME)),
		savedDemos: (ownDir) => ({ dir: ownDir, count: 0, bytes: 0 }),
		playdemo: (path) => `playdemo ${basename(path, '.dem')}`,
		...over
	};
	let now = opts.now ?? ended + 10 * 60_000;
	const fetcher = new DemoFetcher({
		dir,
		deps,
		sink: { enqueue: (r) => sent.push(r) },
		enabled: () => opts.enabled ?? true,
		steamId: () => (opts.steamId === undefined ? ME : opts.steamId),
		appVersion: 'test',
		now: () => now
	});
	return { fetcher, deps, sent, advance: (ms: number) => (now += ms), at: () => now };
}

describe('DemoFetcher', () => {
	it('keeps official matches without damage, and only those, across restarts', () => {
		const { fetcher } = setup();
		fetcher.remember({ ...real, mode: 'casual', id: crypto.randomUUID() });
		fetcher.remember({ ...real, damage: 900, id: crypto.randomUUID() });
		fetcher.remember(real);
		expect(readdirSync(join(dir, 'jobs'))).toEqual([`${real.id}.json`]);
		const again = setup().fetcher;
		expect(again.view().jobs).toMatchObject([{ matchId: real.id, status: 'waiting' }]);
	});

	it('waits while CS2 is sending data, then fills in damage once it is closed', async () => {
		const { fetcher, deps, sent, at } = setup();
		fetcher.remember(real);
		fetcher.tick(at(), at() - 30_000);
		expect(deps.isCs2Running).not.toHaveBeenCalled();
		expect(fetcher.view().state).toBe('waiting-for-cs2');

		fetcher.tick(at(), at() - 5 * 60_000);
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		const [record] = sent;
		expect(record.damageSource).toBe('demo');
		expect(record.damage).toBe(60 * real.rounds.length);
		expect(record.adr).toBe(60);
		expect(deps.obtainDemo).toHaveBeenCalledWith(listed, join(dir, 'files'));
		await vi.waitFor(() => expect(fetcher.view().jobs[0].status).toBe('done'));
		expect(fetcher.view()).toMatchObject({
			state: 'idle',
			jobs: [{ adr: 60, demo: { file: join(dir, 'demo.dem'), playdemo: 'playdemo demo' } }]
		});
	});

	it('does not run while the CS2 process is up, or when turned off', async () => {
		const running = setup({ isCs2Running: vi.fn(() => Promise.resolve(true)) });
		running.fetcher.remember(real);
		running.fetcher.tick(running.at(), null);
		await vi.waitFor(() => expect(running.fetcher.view().state).toBe('waiting-for-cs2'));
		expect(running.deps.recentMatches).not.toHaveBeenCalled();
		running.fetcher.tick(running.at() + 1000, null); // checks at most once a minute
		expect(running.deps.isCs2Running).toHaveBeenCalledTimes(1);

		const off = setup({}, { enabled: false });
		off.fetcher.tick(off.at(), null);
		expect(off.deps.isCs2Running).not.toHaveBeenCalled();
	});

	it('hands the outside world absolute paths, even for a relative data folder', async () => {
		const { fetcher, deps } = setup();
		fetcher.remember(real);
		const relative = new DemoFetcher({
			dir: relativePath(process.cwd(), dir),
			deps,
			sink: { enqueue: () => {} },
			enabled: () => true,
			now: () => ended + 60_000
		});
		await relative.run();
		expect(deps.recentMatches).toHaveBeenCalledWith(dir);
	});

	it('reports a Steam problem and keeps the match waiting', async () => {
		const { fetcher } = setup({
			recentMatches: vi.fn(() => Promise.reject(new DemoError('cs2-open', 'CS2 is open.')))
		});
		fetcher.remember(real);
		await fetcher.run();
		expect(fetcher.view()).toMatchObject({
			state: 'waiting-for-cs2',
			message: 'CS2 is open.',
			jobs: [{ status: 'waiting' }]
		});
	});

	it('gives up on matches Steam does not list after a few hours', async () => {
		const empty = (): Promise<GcMatchList> =>
			Promise.resolve({ accountId: accountIdOf(ME), matches: [] });
		const fresh = setup({ recentMatches: vi.fn(empty) });
		fresh.fetcher.remember(real);
		await fresh.fetcher.run();
		expect(fresh.fetcher.view().jobs[0]).toMatchObject({ status: 'waiting' });

		const late = setup({ recentMatches: vi.fn(empty) }, { now: ended + 4 * HOUR });
		await late.fetcher.run();
		expect(late.fetcher.view().jobs[0]).toMatchObject({ status: 'no-demo' });
	});

	it('waits for a demo that is not there yet, and stops after a day', async () => {
		const noDemo = vi.fn(() =>
			Promise.reject(
				new DemoError('no-demo', 'Valve has no demo for this match (yet, or any more).')
			)
		);
		const soon = setup({ obtainDemo: noDemo });
		soon.fetcher.remember(real);
		await soon.fetcher.run();
		expect(soon.fetcher.view().jobs[0].status).toBe('waiting');
		soon.advance(25 * HOUR);
		await soon.fetcher.run();
		expect(soon.fetcher.view().jobs[0].status).toBe('no-demo');
	});

	it('fails after three bad demos, and retries on request', async () => {
		const { fetcher, sent, deps } = setup({
			parseDemo: vi.fn(() => ({ map: 'de_dust2', present: true, rounds: 14, damage: fullDamage() }))
		});
		fetcher.remember(real);
		for (let i = 0; i < 3; i++) await fetcher.run();
		expect(fetcher.view().jobs[0]).toMatchObject({
			status: 'failed',
			message: `The demo is on de_dust2, not ${real.map}.`
		});
		expect(sent).toHaveLength(0);
		await fetcher.run();
		expect(deps.recentMatches).toHaveBeenCalledTimes(3);
		await fetcher.run({ retry: true });
		expect(deps.recentMatches).toHaveBeenCalledTimes(4);
	});

	it('imports listed matches CS2Live never recorded, once', async () => {
		const unrecorded: GcMatch = {
			...listed,
			matchId: '43',
			matchTime: listed.matchTime - 4 * HOUR
		};
		const notMine: GcMatch = { ...listed, matchId: '44', accountIds: [7] };
		const { fetcher, deps, sent } = setup({
			recentMatches: vi.fn(() =>
				Promise.resolve({ accountId: accountIdOf(ME), matches: [listed, unrecorded, notMine] })
			)
		});
		// The listed match whose recording is waiting for damage is not imported again.
		fetcher.remember(real);
		await fetcher.importRecent();
		// Its demo is saved, though, like every listed match you played. Not the other player's.
		expect(vi.mocked(deps.obtainDemo).mock.calls).toEqual([
			[unrecorded, join(dir, 'files')],
			[listed, join(dir, 'files')]
		]);
		expect(fetcher.demoFor(real.id)?.file).toBe(join(dir, 'demo.dem'));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			id: demoRecordId('43', ME),
			origin: 'demo',
			appVersion: 'test',
			recorderSteamId: ME
		});
		const view = fetcher.view();
		expect(view.message).toBe('Imported 1 match.');
		expect(view.jobs.find((j) => j.matchId === sent[0].id)).toMatchObject({
			status: 'done',
			imported: true
		});

		// A restart remembers it; a second import finds nothing new.
		const again = setup({ recentMatches: deps.recentMatches });
		await again.fetcher.importRecent();
		expect(again.deps.obtainDemo).not.toHaveBeenCalled();
		expect(again.sent).toEqual([]);
		expect(again.fetcher.view().message).toBe(
			'Nothing new: CS2Live already has all 3 matches Steam lists.'
		);
	});

	it('imports only with CS2 closed, a Steam ID, and the right account', async () => {
		const running = setup({ isCs2Running: vi.fn(() => Promise.resolve(true)) });
		await running.fetcher.importRecent();
		expect(running.fetcher.view().state).toBe('waiting-for-cs2');
		expect(running.deps.recentMatches).not.toHaveBeenCalled();

		const noId = setup({}, { steamId: null });
		await noId.fetcher.importRecent();
		expect(noId.fetcher.view().message).toMatch(/Steam ID/);

		const other = setup({
			recentMatches: vi.fn(() => Promise.resolve({ accountId: 1, matches: [listed] }))
		});
		await other.fetcher.importRecent();
		expect(other.fetcher.view()).toMatchObject({ state: 'error' });
		expect(other.deps.obtainDemo).not.toHaveBeenCalled();
	});

	it('reports a demo it could not import and carries on', async () => {
		const second: GcMatch = { ...listed, matchId: '43', matchTime: listed.matchTime + HOUR };
		let calls = 0;
		const { fetcher, sent } = setup({
			recentMatches: vi.fn(() =>
				Promise.resolve({ accountId: accountIdOf(ME), matches: [listed, second] })
			),
			obtainDemo: vi.fn(() =>
				++calls === 1
					? Promise.reject(new DemoError('no-demo', 'Valve no longer has this demo.'))
					: Promise.resolve({ path: 'demo.dem', downloaded: true })
			)
		});
		await fetcher.importRecent();
		expect(sent).toHaveLength(1);
		expect(fetcher.view().message).toBe(
			'Imported 1 match. 1 could not be imported: Valve no longer has this demo.'
		);
	});

	it('skips matches from another Steam account', async () => {
		const other = setup({
			recentMatches: vi.fn(() => Promise.resolve({ accountId: 1, matches: [listed] }))
		});
		other.fetcher.remember(real);
		await other.fetcher.run();
		expect(other.fetcher.view().jobs[0].message).toMatch(/different account/);
		expect(other.deps.obtainDemo).not.toHaveBeenCalled();
	});

	it('keeps the demos, and the matches that point to them past the usual month', async () => {
		const { fetcher, sent } = setup();
		fetcher.remember(real);
		await fetcher.run();
		expect(sent).toHaveLength(1);
		const file = join(dir, 'demo.dem');
		expect(existsSync(file)).toBe(true);
		const saved = { file, playdemo: 'playdemo demo' };
		expect(fetcher.demoFor(real.id)).toEqual(saved);
		expect(fetcher.demoFor(crypto.randomUUID())).toBeNull();

		const later = { now: ended + 40 * 24 * HOUR };
		expect(setup({}, later).fetcher.demoFor(real.id)).toEqual(saved);
		rmSync(file);
		expect(setup({}, later).fetcher.view().jobs).toEqual([]);
		expect(readdirSync(join(dir, 'jobs'))).toEqual([]);
	});

	it('saves the demos of the listed matches you played whenever it asks Steam', async () => {
		const unrecorded: GcMatch = { ...listed, matchId: '43', matchTime: listed.matchTime - HOUR };
		const notMine: GcMatch = { ...listed, matchId: '44', accountIds: [7] };
		// A finished match from before demos were kept: it has none yet.
		mkdirSync(join(dir, 'jobs'));
		const old = { record: real, status: 'done', attempts: 0, message: null, updatedAt: 0 };
		writeFileSync(join(dir, 'jobs', `${real.id}.json`), JSON.stringify(old));
		const { fetcher, deps } = setup({
			recentMatches: vi.fn(() =>
				Promise.resolve({ accountId: accountIdOf(ME), matches: [listed, unrecorded, notMine] })
			),
			obtainDemo: vi.fn((match: GcMatch) => {
				const file = join(dir, `${match.matchId}.dem`);
				const downloaded = !existsSync(file);
				writeFileSync(file, 'demo');
				return Promise.resolve({ path: file, downloaded });
			})
		});

		// Nothing is waiting, but asked to check, it goes to Steam for the demos.
		await fetcher.run({ retry: true });
		expect(vi.mocked(deps.obtainDemo).mock.calls.map(([m]) => m.matchId)).toEqual(['42', '43']);
		expect(fetcher.view().message).toBe('Saved 2 demos.');
		expect(fetcher.demoFor(real.id)?.file).toBe(join(dir, '42.dem'));

		// The next time, only the one no match points to is looked for again, and found.
		await fetcher.run({ retry: true });
		expect(vi.mocked(deps.obtainDemo).mock.calls.map(([m]) => m.matchId)).toEqual([
			'42',
			'43',
			'43'
		]);
		expect(fetcher.view().message).toBeNull();
	});
});
