import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, TEST_DATABASE_URL, type TestDb } from '../db/testing.ts';
import { checkUploadKey, receiveUpload } from './receive.ts';
import { claimSteamId, getSteamLink, revokeUploadKey, rotateUploadKey } from '../db/accounts.ts';
import { matches, steamLinks, user } from '../db/schema.ts';
import { loadFixture, runFrames } from '../gsi/testing.ts';
import { SIM_ME, SIM_TEAMMATES } from '../gsi/sim/simulate.ts';
import type { MatchRecord } from '#lib/match-record.ts';

const fullMatch = (): MatchRecord => ({
	...runFrames(loadFixture('synthetic/full-match'), { steamId: SIM_ME.steamId }).records[0],
	id: randomUUID()
});

describe.skipIf(!TEST_DATABASE_URL)('accounts and uploads', () => {
	let t: TestDb;
	beforeAll(async () => {
		t = await openTestDb();
	});
	afterAll(() => t?.close());
	beforeEach(() => t.reset());

	async function makeUser(id: string) {
		await t.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
		return id;
	}
	const bearer = (key: string) => `Bearer ${key}`;

	it('first claim of a Steam ID wins', async () => {
		const a = await makeUser('alice');
		const b = await makeUser('bob');
		expect(await claimSteamId(t.db, a, SIM_ME.steamId)).toEqual({ ok: true });
		expect(await claimSteamId(t.db, b, SIM_ME.steamId)).toEqual({ ok: false, reason: 'taken' });
		// Re-claiming your own, or switching to a free one, is fine.
		expect(await claimSteamId(t.db, a, SIM_ME.steamId)).toEqual({ ok: true });
		expect(await claimSteamId(t.db, a, SIM_TEAMMATES[0].steamId)).toEqual({ ok: true });
		expect((await getSteamLink(t.db, a))?.steamId).toBe(SIM_TEAMMATES[0].steamId);
		expect(await claimSteamId(t.db, b, SIM_ME.steamId)).toEqual({ ok: true });
	});

	it('stores only a hash of the key and checks it', async () => {
		const a = await makeUser('alice');
		expect(await rotateUploadKey(t.db, a)).toBeNull(); // no Steam ID claimed yet
		await claimSteamId(t.db, a, SIM_ME.steamId);
		const key = (await rotateUploadKey(t.db, a))!;
		expect(key).toMatch(/^cs2l_[\w-]{32}$/);

		const [link] = await t.db.select().from(steamLinks);
		expect(link.uploadKeyHash).not.toContain(key);
		expect(key.startsWith(link.uploadKeyPrefix!)).toBe(true);

		expect(await checkUploadKey(t.db, bearer(key))).toMatchObject({
			status: 200,
			body: { steamId: SIM_ME.steamId }
		});
		expect((await checkUploadKey(t.db, bearer('cs2l_wrong'))).status).toBe(401);
		expect((await checkUploadKey(t.db, null)).status).toBe(401);

		// Rotating invalidates the old key; revoking invalidates all.
		const key2 = (await rotateUploadKey(t.db, a))!;
		expect((await checkUploadKey(t.db, bearer(key))).status).toBe(401);
		expect((await checkUploadKey(t.db, bearer(key2))).status).toBe(200);
		await revokeUploadKey(t.db, a);
		expect((await checkUploadKey(t.db, bearer(key2))).status).toBe(401);
	});

	it('saves an upload once, however often it is sent', async () => {
		const a = await makeUser('alice');
		await claimSteamId(t.db, a, SIM_ME.steamId);
		const key = (await rotateUploadKey(t.db, a))!;
		const rec = fullMatch();
		const body = JSON.stringify(rec);

		expect(await receiveUpload(t.db, bearer(key), body)).toMatchObject({
			status: 200,
			body: { id: rec.id }
		});
		expect((await receiveUpload(t.db, bearer(key), body)).status).toBe(200);
		const rows = await t.db.select().from(matches);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: rec.id, source: 'upload', roundsPlayed: 24 });
		expect((await getSteamLink(t.db, a))?.lastUploadAt).toBeInstanceOf(Date);
	});

	it('refuses bad uploads', async () => {
		const a = await makeUser('alice');
		await claimSteamId(t.db, a, SIM_TEAMMATES[0].steamId);
		const key = (await rotateUploadKey(t.db, a))!;
		const rec = fullMatch();

		// Someone else's match.
		const other = await receiveUpload(t.db, bearer(key), JSON.stringify(rec));
		expect(other.status).toBe(403);
		expect(other.body.message).toContain(SIM_TEAMMATES[0].steamId);

		// Malformed.
		expect((await receiveUpload(t.db, bearer(key), '{nope')).status).toBe(400);
		const invalid = await receiveUpload(
			t.db,
			bearer(key),
			JSON.stringify({ ...rec, recorderSteamId: SIM_TEAMMATES[0].steamId, rounds: 'x' })
		);
		expect(invalid.status).toBe(400);
		expect(invalid.body.message).toContain('rounds');

		// No key.
		expect((await receiveUpload(t.db, null, JSON.stringify(rec))).status).toBe(401);
		expect(await t.db.select().from(matches).where(eq(matches.id, rec.id))).toHaveLength(0);
	});

	it('refuses to overwrite a match id another player owns', async () => {
		const a = await makeUser('alice');
		const b = await makeUser('bob');
		await claimSteamId(t.db, a, SIM_ME.steamId);
		await claimSteamId(t.db, b, SIM_TEAMMATES[0].steamId);
		const keyA = (await rotateUploadKey(t.db, a))!;
		const keyB = (await rotateUploadKey(t.db, b))!;
		const rec = fullMatch();
		expect((await receiveUpload(t.db, bearer(keyA), JSON.stringify(rec))).status).toBe(200);
		const stolen = { ...rec, recorderSteamId: SIM_TEAMMATES[0].steamId };
		expect((await receiveUpload(t.db, bearer(keyB), JSON.stringify(stolen))).status).toBe(409);
	});
});
