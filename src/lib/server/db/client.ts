// Framework-free database client factory. Used by the app (through ./index.ts) and by the
// scripts in /scripts, which run under plain Node and cannot import `$app/env/private`.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>['db'];

export interface DbOptions {
	/** Max pool size. Serverless functions should keep this small. */
	max?: number;
}

/**
 * Creates a drizzle client over postgres.js.
 *
 * Neon notes:
 * - Neon only accepts TLS connections. Its connection strings carry `?sslmode=require`, which
 *   postgres.js reads from the URL. We also force `ssl: 'require'` for any `*.neon.tech` host in
 *   case the parameter was dropped when the URL was copied.
 * - Neon's **pooled** endpoint (host contains `-pooler`) runs PgBouncer in transaction mode.
 *   PgBouncer in that mode cannot keep prepared statements across transactions, and postgres.js
 *   prepares statements by default, which fails with errors like
 *   `prepared statement "..." does not exist`. So `prepare: false` is set for pooled hosts.
 *   Migrations should use the direct (unpooled) URL instead; see drizzle.config.ts.
 */
export function createDb(url: string, options: DbOptions = {}) {
	let host = '';
	try {
		host = new URL(url).hostname;
	} catch {
		// Leave host empty; postgres.js reports the bad URL itself on first use.
	}
	const pooled = host.includes('-pooler');
	const neon = host.endsWith('.neon.tech');

	const client = postgres(url, {
		max: options.max ?? 10,
		prepare: !pooled,
		ssl: neon ? 'require' : undefined,
		idle_timeout: 20,
		connect_timeout: 10,
		// Keep the server quiet about "relation already exists" NOTICEs during migrations.
		onnotice: () => {}
	});

	return { db: drizzle(client, { schema }), client };
}
