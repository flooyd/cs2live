// Optional raw payload capture to NDJSON (GSI_CAPTURE=1). Node-only, no framework imports.
//
// File format, one JSON value per line:
//   {"meta":{...}}          first line: capture start time, app version, request headers
//   {"t":<ms>,"p":{...}}    one line per payload: receive time (epoch ms) and the payload
// The auth token is removed before writing. Captures still contain Steam IDs and names, so
// trim and anonymise them before committing (see the gsi-replay skill).
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface CaptureMeta {
	startedAt: string;
	appVersion: string;
	headers: Record<string, string>;
}

/** Copies a payload without its `auth` block. */
export function stripAuth(payload: unknown): unknown {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
	const { auth: _auth, ...rest } = payload as Record<string, unknown>;
	return rest;
}

export class GsiRecorder {
	private file: string | null = null;
	private queue: Promise<void> = Promise.resolve();
	private failed = false;
	private dir: string;
	private appVersion: string;

	constructor(dir: string, appVersion: string) {
		this.dir = dir;
		this.appVersion = appVersion;
	}

	get path() {
		return this.file;
	}

	/** Queues a payload for writing. Never throws; a failing disk just stops the capture. */
	record(at: number, payload: unknown, headers: Record<string, string> = {}) {
		if (this.failed) return;
		const line = JSON.stringify({ t: at, p: stripAuth(payload) }) + '\n';
		this.queue = this.queue
			.then(async () => {
				if (!this.file) {
					await mkdir(this.dir, { recursive: true });
					const stamp = new Date(at).toISOString().replace(/[:.]/g, '-').slice(0, 19);
					this.file = join(this.dir, `gsi-${stamp}.ndjson`);
					const meta: CaptureMeta = {
						startedAt: new Date(at).toISOString(),
						appVersion: this.appVersion,
						headers
					};
					await appendFile(this.file, JSON.stringify({ meta }) + '\n');
					console.log(`[gsi] capturing payloads to ${this.file}`);
				}
				await appendFile(this.file, line);
			})
			.catch((err: unknown) => {
				this.failed = true;
				console.error('[gsi] capture failed, capture disabled:', err);
			});
	}

	/** Resolves once everything queued so far is on disk. */
	flush() {
		return this.queue;
	}
}
