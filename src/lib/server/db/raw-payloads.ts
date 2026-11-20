// Optional raw payload storage (STORE_RAW_PAYLOADS=1, only on a copy with DATABASE_URL):
// in-match payloads are buffered in memory and written to raw_payloads when the match is
// saved, so matches can be reprocessed when the parsers improve. A match is a few MB of JSON,
// so prune with `yarn db:cleanup`. No framework imports.
import { lt, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { rawPayloads } from './schema.ts';
import { stripAuth } from '../gsi/recorder.ts';

/** Where raw payloads go; the live runtime calls these. */
export interface RawPayloadSink {
	add(at: number, raw: unknown): void;
	save(matchId: string): Promise<void>;
	clear(): void;
}

/** Roughly 2.5 hours of payloads at CS2's busiest rate; older ones are dropped first. */
const MAX_BUFFERED = 40_000;
const CHUNK = 500;

export class RawPayloadBuffer implements RawPayloadSink {
	private db: Db;
	private rows: { at: number; payload: unknown }[] = [];

	constructor(db: Db) {
		this.db = db;
	}

	add(at: number, raw: unknown) {
		// Menus and loading screens are not worth keeping.
		if (!raw || typeof raw !== 'object' || !('map' in raw)) return;
		if (this.rows.length >= MAX_BUFFERED) this.rows.splice(0, MAX_BUFFERED / 10);
		this.rows.push({ at, payload: stripAuth(raw) });
	}

	async save(matchId: string) {
		const rows = this.rows;
		this.rows = [];
		try {
			for (let i = 0; i < rows.length; i += CHUNK) {
				await this.db.insert(rawPayloads).values(
					rows.slice(i, i + CHUNK).map((r) => ({
						matchId,
						receivedAt: new Date(r.at),
						payload: r.payload
					}))
				);
			}
		} catch (err) {
			console.error('[raw] could not store raw payloads:', (err as Error).message);
		}
	}

	clear() {
		this.rows = [];
	}
}

export async function rawPayloadStats(db: Db) {
	const [row] = await db
		.select({
			rows: sql<number>`count(*)::int`,
			matches: sql<number>`count(distinct ${rawPayloads.matchId})::int`,
			oldest: sql<string | null>`min(${rawPayloads.receivedAt})::text`,
			bytes: sql<number>`pg_total_relation_size('raw_payloads')::bigint`
		})
		.from(rawPayloads);
	return { ...row, bytes: Number(row.bytes) };
}

/** Deletes raw payloads received before `before`. Returns how many rows went. */
export async function deleteRawPayloadsBefore(db: Db, before: Date): Promise<number> {
	const result = await db.delete(rawPayloads).where(lt(rawPayloads.receivedAt, before));
	return result.count;
}
