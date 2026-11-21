import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture, runFrames } from '../gsi/testing.ts';
import { fakeSteamId } from '#lib/cs2/steamid.ts';
import type { MatchRecord } from '#lib/match-record.ts';
import { DemoFetcher, type DemoDeps } from './fetcher.ts';
import type { GcMatch, GcMatchList } from './gc-match-list.ts';
import { accountIdOf } from './match-demo.ts';
import { DemoError } from './steam.ts';

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

function setup(over: Partial<DemoDeps> = {}, opts: { now?: number; enabled?: boolean } = {}) {
	const sent: MatchRecord[] = [];
	const list: GcMatchList = { accountId: accountIdOf(ME), matches: [listed] };
	const deps: DemoDeps = {
		available: () => true,
		isCs2Running: vi.fn(() => Promise.resolve(false)),
		recentMatches: vi.fn(() => Promise.resolve(list)),
		obtainDemo: vi.fn(() => Promise.resolve({ path: 'demo.dem', temporary: false })),
		parseDemo: vi.fn(() => ({ map: real.map, present: true, rounds: 14, damage: fullDamage() })),
		...over
	};
	let now = opts.now ?? ended + 10 * 60_000;
	const fetcher = new DemoFetcher({
		dir,
		deps,
		sink: { enqueue: (r) => sent.push(r) },
		enabled: () => opts.enabled ?? true,
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
		expect(deps.obtainDemo).toHaveBeenCalledWith(listed, dir);
		await vi.waitFor(() => expect(fetcher.view().jobs[0].status).toBe('done'));
		expect(fetcher.view()).toMatchObject({ state: 'idle', jobs: [{ adr: 60 }] });
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

	it('skips matches from another Steam account and deletes downloaded demos', async () => {
		const other = setup({
			recentMatches: vi.fn(() => Promise.resolve({ accountId: 1, matches: [listed] }))
		});
		other.fetcher.remember(real);
		await other.fetcher.run();
		expect(other.fetcher.view().jobs[0].message).toMatch(/different account/);
		expect(other.deps.obtainDemo).not.toHaveBeenCalled();

		rmSync(join(dir, 'jobs'), { recursive: true });
		const file = join(dir, '42.dem');
		writeFileSync(file, 'demo');
		const temp = setup({
			obtainDemo: vi.fn(() => Promise.resolve({ path: file, temporary: true }))
		});
		temp.fetcher.remember(real);
		await temp.fetcher.run();
		expect(temp.sent).toHaveLength(1);
		expect(existsSync(file)).toBe(false);
	});
});
