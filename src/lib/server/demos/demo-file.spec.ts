import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { obtainDemo, playdemoCommand, savedDemos } from './demo-file.ts';
import type { GcMatch } from './gc-match-list.ts';
import { DemoError } from './steam.ts';

const NAME = 'match730_003800000000000000001_0123456789_404';
// A MatchInfo with only its id (field 1 = 9), like the start of a real `.dem.info`.
const INFO = new Uint8Array([0x08, 0x09]);
const match: GcMatch = {
	matchId: '9',
	matchTime: 0,
	accountIds: [1],
	teamScores: [9, 7],
	demoUrl: 'http://replay404.valve.net/730/003800000000000000001_0123456789.dem',
	durationS: 800,
	info: INFO
};

let tmp: string;
let replays: string;
let own: string;
const fetchMock = vi.fn(() => Promise.resolve(new Response('DEMO')));
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), 'cs2live-demo-file-'));
	replays = join(tmp, 'game', 'csgo', 'replays');
	own = join(tmp, 'cs2live', 'demos', 'files');
	fetchMock.mockClear();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(tmp, { recursive: true, force: true });
});

describe('obtainDemo', () => {
	it('keeps the demo in CS2’s replays folder, named and described the way CS2 does', async () => {
		const demo = await obtainDemo(match, own, replays);
		const file = join(replays, `${NAME}.dem`);
		expect(demo).toEqual({ path: file, downloaded: true });
		expect(readFileSync(file, 'utf8')).toBe('DEMO');
		expect(new Uint8Array(readFileSync(`${file}.info`))).toEqual(INFO);
		expect(readdirSync(replays).sort()).toEqual([`${NAME}.dem`, `${NAME}.dem.info`]);

		// Found the next time, without downloading it again.
		expect(await obtainDemo(match, own, replays)).toEqual({ path: file, downloaded: false });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(savedDemos(own, replays)).toEqual({ dir: replays, count: 1, bytes: 4 });
		expect(playdemoCommand(file, replays)).toBe(`playdemo replays/${NAME}`);
		expect(playdemoCommand(join(own, 'x.dem'), replays)).toBeNull();
	});

	it('finds a demo CS2 downloaded itself by the match in its .dem.info', async () => {
		mkdirSync(replays, { recursive: true });
		writeFileSync(join(replays, 'match730_1_2_3.dem'), 'CS2');
		writeFileSync(join(replays, 'match730_1_2_3.dem.info'), INFO);
		const demo = await obtainDemo({ ...match, demoUrl: null }, own, replays);
		expect(demo).toEqual({ path: join(replays, 'match730_1_2_3.dem'), downloaded: false });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('uses CS2Live’s own folder when CS2’s is missing or can’t be written', async () => {
		expect((await obtainDemo(match, own, null)).path).toBe(join(own, `${NAME}.dem`));
		rmSync(own, { recursive: true });
		// A file where the game folder should be: the replays folder can't be made.
		writeFileSync(join(tmp, 'game'), '');
		expect((await obtainDemo(match, own, replays)).path).toBe(join(own, `${NAME}.dem`));
		expect(savedDemos(own, null)).toEqual({ dir: own, count: 1, bytes: 4 });
	});

	it('leaves nothing behind when the download fails', async () => {
		fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }));
		await expect(obtainDemo(match, own, replays)).rejects.toMatchObject({ kind: 'no-demo' });
		const cut = new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode('DE'));
				c.error(new Error('connection reset'));
			}
		});
		fetchMock.mockResolvedValueOnce(new Response(cut));
		await expect(obtainDemo(match, own, replays)).rejects.toBeInstanceOf(DemoError);
		expect(existsSync(replays) ? readdirSync(replays) : []).toEqual([]);
		await expect(
			obtainDemo({ ...match, demoUrl: 'http://example.com/x.dem' }, own, replays)
		).rejects.toThrow(/Unexpected demo address/);
	});
});
