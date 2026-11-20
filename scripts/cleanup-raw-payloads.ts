// yarn db:cleanup [--days 30] [--dry-run]
//
// Deletes raw GSI payloads (raw_payloads, filled when STORE_RAW_PAYLOADS=1) older than N days.
// Neon's free tier is small and a match is a few MB of payloads. Matches, rounds and stats are
// never touched.
import { createDb } from '../src/lib/server/db/client.ts';
import { deleteRawPayloadsBefore, rawPayloadStats } from '../src/lib/server/db/raw-payloads.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const days = Number(value('--days') ?? 30);
if (!Number.isFinite(days) || days < 0) {
	console.error('--days must be a number >= 0');
	process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set (put it in .env).');
	process.exit(1);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const { db, client } = createDb(url, { max: 1 });
try {
	const before = await rawPayloadStats(db);
	console.log(
		`raw_payloads: ${before.rows} rows for ${before.matches} matches, ${mb(before.bytes)}, oldest ${before.oldest ?? '-'}`
	);
	const cutoff = new Date(Date.now() - days * 86_400_000);
	if (flag('--dry-run')) {
		console.log(`Dry run: would delete payloads received before ${cutoff.toISOString()}.`);
	} else {
		const n = await deleteRawPayloadsBefore(db, cutoff);
		console.log(`Deleted ${n} payloads received before ${cutoff.toISOString()}.`);
		if (n > 0) {
			// Hand the space back to Postgres for reuse (a plain VACUUM, no table lock).
			await client`vacuum raw_payloads`;
			const after = await rawPayloadStats(db);
			console.log(`Now ${after.rows} rows, ${mb(after.bytes)}.`);
		}
	}
} finally {
	await client.end();
}
