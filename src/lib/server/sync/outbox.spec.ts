import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	AuthSyncError,
	Outbox,
	PermanentSyncError,
	uploadTarget,
	type SyncTarget
} from './outbox.ts';
import { loadFixture, runFrames } from '../gsi/testing.ts';
import { SIM_ME } from '../gsi/sim/simulate.ts';
import type { MatchRecord } from '#lib/match-record.ts';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs2live-outbox-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const record = (id: string): MatchRecord => ({
	...runFrames(loadFixture('synthetic/full-match'), { steamId: SIM_ME.steamId }).records[0],
	id
});
const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const files = () => readdirSync(dir).filter((f) => f.endsWith('.json'));

/** A target whose send runs `fn`; a throw becomes a rejected send. */
function target(fn: (r: MatchRecord) => void): SyncTarget {
	return { mode: 'upload', label: 'test', send: (r) => Promise.resolve().then(() => fn(r)) };
}

/** Waits until the outbox has written and flushed. */
async function settle(box: Outbox) {
	await new Promise((r) => setTimeout(r, 20));
	await box.flush();
}

describe('outbox', () => {
	it('keeps matches until a target exists, then sends and deletes them', async () => {
		let t: SyncTarget | null = null;
		const sent: string[] = [];
		const box = new Outbox(dir, () => t);
		box.enqueue(record(ID1));
		await settle(box);
		expect(files()).toEqual([`${ID1}.json`]);
		expect(box.status()).toMatchObject({ mode: 'none', pending: 1 });

		t = target((r) => void sent.push(r.id));
		await box.flush();
		expect(sent).toEqual([ID1]);
		expect(files()).toEqual([]);
		expect(box.status()).toMatchObject({ pending: 0, lastSyncedMatchId: ID1, lastError: null });
	});

	it('re-sending the same match id replaces the queued copy', async () => {
		const box = new Outbox(dir, () => null);
		box.enqueue(record(ID1));
		box.enqueue({ ...record(ID1), kills: 99 });
		await settle(box);
		expect(files()).toHaveLength(1);
		expect(box.status().pending).toBe(1);
	});

	it('stops on a bad key and keeps everything queued', async () => {
		let calls = 0;
		const box = new Outbox(dir, () =>
			target(() => {
				calls++;
				throw new AuthSyncError('bad key');
			})
		);
		box.enqueue(record(ID1));
		box.enqueue(record(ID2));
		await settle(box);
		expect(calls).toBeGreaterThanOrEqual(1);
		expect(files()).toHaveLength(2);
		expect(box.status()).toMatchObject({ pending: 2, rejected: 0, lastError: 'bad key' });
	});

	it('moves a refused match aside and carries on with the rest', async () => {
		const sent: string[] = [];
		const box = new Outbox(dir, () =>
			target((r) => {
				if (r.id === ID1) throw new PermanentSyncError('invalid');
				sent.push(r.id);
			})
		);
		box.enqueue(record(ID1));
		box.enqueue(record(ID2));
		await settle(box);
		await box.flush();
		expect(sent).toEqual([ID2]);
		expect(files()).toEqual([]);
		expect(existsSync(join(dir, 'rejected', `${ID1}.json`))).toBe(true);
		expect(box.status()).toMatchObject({ pending: 0, rejected: 1 });
	});

	it('picks up matches left on disk by a previous run', async () => {
		const first = new Outbox(dir, () => null);
		first.enqueue(record(ID1));
		await settle(first);
		const sent: string[] = [];
		const second = new Outbox(dir, () => target((r) => void sent.push(r.id)));
		await settle(second);
		expect(sent).toEqual([ID1]);
	});
});

describe('uploadTarget', () => {
	const respond = (status: number, body: unknown = {}) =>
		(() =>
			Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

	it('sends the record with the key', async () => {
		let seen: Request | null = null;
		const fetchImpl = ((url: string, init: RequestInit) => {
			seen = new Request(url, init);
			return Promise.resolve(new Response('{}', { status: 200 }));
		}) as unknown as typeof fetch;
		await uploadTarget('https://site.example/', 'cs2l_key', fetchImpl).send(record(ID1));
		expect(seen!.url).toBe('https://site.example/api/upload');
		expect(seen!.headers.get('authorization')).toBe('Bearer cs2l_key');
		expect(((await seen!.json()) as MatchRecord).id).toBe(ID1);
	});

	it('classifies failures', async () => {
		const send = (status: number) =>
			uploadTarget('https://s.example', 'k', respond(status, { message: 'nope' })).send(
				record(ID1)
			);
		await expect(send(401)).rejects.toBeInstanceOf(AuthSyncError);
		await expect(send(403)).rejects.toBeInstanceOf(AuthSyncError);
		await expect(send(404)).rejects.toBeInstanceOf(AuthSyncError);
		await expect(send(400)).rejects.toBeInstanceOf(PermanentSyncError);
		await expect(send(409)).rejects.toBeInstanceOf(PermanentSyncError);
		for (const status of [408, 429, 500, 503]) {
			const err = await send(status).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(Error);
			expect(err).not.toBeInstanceOf(PermanentSyncError);
			expect(err).not.toBeInstanceOf(AuthSyncError);
		}
		await expect(send(400)).rejects.toThrow('Upload rejected (400): nope');
	});
});
