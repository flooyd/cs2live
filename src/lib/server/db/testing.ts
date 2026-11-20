// Test helpers for *.db.spec.ts files. They run against TEST_DATABASE_URL (any Postgres; the
// database name must contain "test" so a real database is never truncated) and are skipped
// when it is not set. The "db" Vitest project runs these files one at a time.
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type Db } from './client.ts';

try {
	// Vitest does not load .env into process.env; real environment variables still win.
	process.loadEnvFile('.env');
} catch {
	// No .env file.
}

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || null;

export interface TestDb {
	db: Db;
	reset(): Promise<void>;
	close(): Promise<void>;
}

export async function openTestDb(): Promise<TestDb> {
	const url = TEST_DATABASE_URL;
	if (!url) throw new Error('TEST_DATABASE_URL is not set');
	const name = new URL(url).pathname.replace(/^\//, '');
	if (!/test/i.test(name)) {
		throw new Error(`Refusing to run tests against "${name}": the name must contain "test".`);
	}
	const { db, client } = createDb(url, { max: 2 });
	await client`set client_min_messages = warning`;
	await migrate(db, { migrationsFolder: 'drizzle' });
	return {
		db,
		async reset() {
			await db.execute(
				sql`truncate players, matches, rounds, kill_events, sightings, raw_payloads, steam_links, "user", session, account, verification restart identity cascade`
			);
		},
		close: () => client.end()
	};
}
