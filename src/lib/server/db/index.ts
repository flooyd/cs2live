import { DATABASE_URL, VERCEL } from '$app/env/private';
import { createDb, type Db } from './client.ts';

export type { Db };

/** True when this copy of CS2Live talks to the database directly. */
export const hasDb = Boolean(DATABASE_URL);

let instance: Db | null = null;

/**
 * The shared drizzle client, or `null` when DATABASE_URL is not set (a friend's local copy that
 * uploads through the site instead). postgres.js connects lazily, so this never blocks startup.
 */
export function getDb(): Db | null {
	if (!DATABASE_URL) return null;
	// Serverless functions each hold their own pool, so keep it small there.
	instance ??= createDb(DATABASE_URL, { max: VERCEL ? 3 : 10 }).db;
	return instance;
}

/** Like getDb, but throws a clear error for code paths that cannot work without a database. */
export function requireDb(): Db {
	const db = getDb();
	if (!db) throw new Error('DATABASE_URL is not set, so this copy of CS2Live has no database.');
	return db;
}
