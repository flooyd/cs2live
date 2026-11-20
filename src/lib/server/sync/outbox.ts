// The upload outbox: every finished match is written to disk first, then sent to its target
// (the site's upload API, or the database directly). Files are named by match id, so a
// re-sent match (resumed after a reconnect, duplicate gameover) replaces its earlier copy, and
// the target upserts by id. Node-only, no framework imports.
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MatchRecord } from '#lib/match-record.ts';
import type { SyncView } from '#lib/live/types.ts';
import type { MatchSink } from '../live/runtime.ts';

export interface SyncTarget {
	mode: 'direct' | 'upload';
	/** Human-readable destination for the UI. */
	label: string;
	send(record: MatchRecord): Promise<void>;
}

/** A send failure that retrying will not fix (bad key, rejected record). */
export class PermanentSyncError extends Error {}

const RETRY_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

export class Outbox implements MatchSink {
	private dir: string;
	private resolveTarget: () => SyncTarget | null;
	private onChange: () => void;
	private pending = new Set<string>();
	private flushing: Promise<void> | null = null;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private attempt = 0;
	private lastError: string | null = null;
	private lastSyncedAt: number | null = null;
	private lastSyncedMatchId: string | null = null;
	private ready: Promise<void>;

	constructor(
		dir: string,
		resolveTarget: () => SyncTarget | null,
		onChange: () => void = () => {}
	) {
		this.dir = dir;
		this.resolveTarget = resolveTarget;
		this.onChange = onChange;
		this.ready = this.load();
	}

	private async load() {
		try {
			await mkdir(this.dir, { recursive: true });
			for (const f of await readdir(this.dir)) {
				if (f.endsWith('.json')) this.pending.add(f.slice(0, -5));
			}
			if (this.pending.size) {
				console.log(`[sync] ${this.pending.size} match(es) waiting in ${this.dir}`);
				void this.flush();
			}
		} catch (err) {
			console.error('[sync] could not read the outbox:', err);
		}
	}

	enqueue(record: MatchRecord) {
		void this.write(record).then(() => this.flush());
	}

	private async write(record: MatchRecord) {
		await this.ready;
		try {
			await mkdir(this.dir, { recursive: true });
			const file = join(this.dir, `${record.id}.json`);
			await writeFile(file + '.tmp', JSON.stringify(record));
			await rename(file + '.tmp', file);
			this.pending.add(record.id);
			this.onChange();
		} catch (err) {
			this.lastError = `Could not write the outbox: ${(err as Error).message}`;
			console.error('[sync]', this.lastError);
		}
	}

	/** Sends everything pending. Concurrent calls share one run. */
	flush(): Promise<void> {
		this.flushing ??= this.run().finally(() => {
			this.flushing = null;
		});
		return this.flushing;
	}

	private async run() {
		await this.ready;
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		const target = this.resolveTarget();
		if (!target) {
			if (this.pending.size) this.lastError = 'No upload target set up yet (see /setup).';
			this.onChange();
			return;
		}
		let failed = false;
		for (const id of [...this.pending]) {
			const file = join(this.dir, `${id}.json`);
			try {
				const record = JSON.parse(await readFile(file, 'utf8')) as MatchRecord;
				await target.send(record);
				await unlink(file).catch(() => {});
				this.pending.delete(id);
				this.lastSyncedAt = Date.now();
				this.lastSyncedMatchId = id;
				this.lastError = null;
				console.log(`[sync] saved match ${id} (${target.label})`);
			} catch (err) {
				failed = true;
				this.lastError = (err as Error).message;
				console.error(`[sync] could not save match ${id}:`, this.lastError);
				if (err instanceof PermanentSyncError) continue;
				break;
			}
		}
		if (failed) {
			const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
			this.attempt++;
			this.retryTimer = setTimeout(() => void this.flush(), delay);
			this.retryTimer.unref?.();
		} else {
			this.attempt = 0;
		}
		this.onChange();
	}

	status(): SyncView {
		const target = this.resolveTarget();
		return {
			mode: target?.mode ?? 'none',
			target: target?.label ?? null,
			pending: this.pending.size,
			lastError: this.lastError,
			lastSyncedAt: this.lastSyncedAt,
			lastSyncedMatchId: this.lastSyncedMatchId
		};
	}
}

/** Sends matches to the CS2Live site's upload API. */
export function uploadTarget(
	siteUrl: string,
	uploadKey: string,
	fetchImpl: typeof fetch = fetch
): SyncTarget {
	const url = `${siteUrl.replace(/\/+$/, '')}/api/upload`;
	return {
		mode: 'upload',
		label: new URL(url).host,
		async send(record) {
			let res: Response;
			try {
				res = await fetchImpl(url, {
					method: 'POST',
					headers: { 'content-type': 'application/json', authorization: `Bearer ${uploadKey}` },
					body: JSON.stringify(record),
					signal: AbortSignal.timeout(20_000)
				});
			} catch (err) {
				throw new Error(`Could not reach ${new URL(url).host}: ${(err as Error).message}`, {
					cause: err
				});
			}
			if (res.ok) return;
			const body = await res.text().catch(() => '');
			let message = body.slice(0, 300);
			try {
				message = (JSON.parse(body) as { message?: string }).message ?? message;
			} catch {
				// Not JSON; keep the text.
			}
			const text = `Upload rejected (${res.status}): ${message || res.statusText}`;
			// 4xx other than 408/429 means the request itself is wrong; retrying won't help.
			if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
				throw new PermanentSyncError(text);
			}
			throw new Error(text);
		}
	};
}
