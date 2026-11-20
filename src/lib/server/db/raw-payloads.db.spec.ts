import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, TEST_DATABASE_URL, type TestDb } from './testing.ts';
import { deleteRawPayloadsBefore, RawPayloadBuffer, rawPayloadStats } from './raw-payloads.ts';
import { rawPayloads } from './schema.ts';

describe.skipIf(!TEST_DATABASE_URL)('raw payloads', () => {
	let t: TestDb;
	beforeAll(async () => {
		t = await openTestDb();
	});
	afterAll(() => t?.close());
	beforeEach(() => t.reset());

	const MATCH = '00000000-0000-4000-8000-0000000000aa';

	it('stores in-match payloads without the token', async () => {
		const buf = new RawPayloadBuffer(t.db);
		buf.add(1_000, { provider: {}, player: { activity: 'menu' }, auth: { token: 'secret' } });
		for (let i = 0; i < 1200; i++) {
			buf.add(2_000 + i, { map: { round: i }, auth: { token: 'secret' } });
		}
		await buf.save(MATCH);

		const rows = await t.db.select().from(rawPayloads);
		expect(rows).toHaveLength(1200);
		expect(rows.every((r) => r.matchId === MATCH)).toBe(true);
		expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain('secret');

		// The buffer is empty after saving.
		await buf.save(MATCH);
		expect((await rawPayloadStats(t.db)).rows).toBe(1200);
	});

	it('discards a dropped match and prunes old rows', async () => {
		const buf = new RawPayloadBuffer(t.db);
		buf.add(1, { map: {} });
		buf.clear();
		await buf.save(MATCH);
		expect((await rawPayloadStats(t.db)).rows).toBe(0);

		const day = 86_400_000;
		const now = Date.now();
		buf.add(now - 40 * day, { map: {} });
		buf.add(now - 10 * day, { map: {} });
		buf.add(now, { map: {} });
		await buf.save(MATCH);
		expect(await deleteRawPayloadsBefore(t.db, new Date(now - 30 * day))).toBe(1);
		expect((await rawPayloadStats(t.db)).rows).toBe(2);
	});
});
