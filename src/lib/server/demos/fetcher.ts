// Fills in damage for finished official matches from their demos, after the game.
//
// CS2 sends no damage over GSI, but Valve keeps a demo of every official match. When a Premier,
// Competitive or Wingman match ends without damage, it is kept here as a job. Once CS2 is closed
// (the Steam helper only works then), we ask Steam for the recent match list, find the match,
// take the demo from CS2's replays folder or download it, read your damage per round and send the
// match again through the outbox with the damage filled in. Downloaded demos are deleted after.
//
// Jobs live in CS2LIVE_DATA_DIR/demos/jobs/<match id>.json. Node-only, no framework imports.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { MatchRecord } from '#lib/match-record.ts';
import type { GcMatch, GcMatchList } from './gc-match-list.ts';
import { accountIdOf, findGcMatch, wantsDemoDamage, withDemoDamage } from './match-demo.ts';
import { DemoError } from './steam.ts';
import type { DemoOnDisk, ParsedDemo } from './demo-file.ts';

export type DemoJobStatus = 'waiting' | 'done' | 'no-demo' | 'failed';

export interface DemoJob {
	record: MatchRecord;
	status: DemoJobStatus;
	/** Failed tries (download or parse); 'not listed yet' does not count. */
	attempts: number;
	message: string | null;
	updatedAt: number;
}

/** The outside world, swappable in tests. */
export interface DemoDeps {
	available: () => boolean;
	isCs2Running: () => Promise<boolean | null>;
	recentMatches: (workDir: string) => Promise<GcMatchList>;
	obtainDemo: (match: GcMatch, workDir: string) => Promise<DemoOnDisk>;
	parseDemo: (path: string, steamId: string) => ParsedDemo;
}

export interface DemoView {
	enabled: boolean;
	/** The Steam helper exists for this platform. */
	available: boolean;
	state: 'idle' | 'waiting-for-cs2' | 'working' | 'error';
	message: string | null;
	lastRunAt: number | null;
	jobs: {
		matchId: string;
		map: string;
		mode: string;
		startedAt: string;
		status: DemoJobStatus;
		message: string | null;
		adr: number | null;
	}[];
}

export interface DemoFetcherOptions {
	dir: string;
	deps: DemoDeps;
	/** Where the match goes once it has damage (the outbox). */
	sink: { enqueue(record: MatchRecord): void };
	enabled: () => boolean;
	onChange?: () => void;
	now?: () => number;
}

/** A GSI payload this recent means CS2 is open. */
const GSI_QUIET_MS = 2 * 60_000;
/** Between process checks while waiting for CS2 to close. */
const CHECK_MS = 60_000;
/** Between runs while matches are still waiting. */
const RETRY_MS = 10 * 60_000;
/** Steam lists your last few matches. One it hasn't listed by now never will be. */
const NOT_LISTED_MS = 3 * 3600_000;
/** Valve has the demo a few minutes after the match; after a day, it isn't coming. */
const NO_DEMO_MS = 24 * 3600_000;
const MAX_ATTEMPTS = 3;
/** Jobs (and demos, at Valve) are kept about this long. */
const KEEP_MS = 30 * 24 * 3600_000;

export class DemoFetcher {
	private dir: string;
	private jobsDir: string;
	private deps: DemoDeps;
	private sink: DemoFetcherOptions['sink'];
	private enabled: () => boolean;
	private onChange: () => void;
	private now: () => number;
	private jobs = new Map<string, DemoJob>();
	private running: Promise<void> | null = null;
	private nextAttemptAt = 0;
	private state: DemoView['state'] = 'idle';
	private message: string | null = null;
	private lastRunAt: number | null = null;

	constructor(opts: DemoFetcherOptions) {
		this.dir = opts.dir;
		this.jobsDir = join(opts.dir, 'jobs');
		this.deps = opts.deps;
		this.sink = opts.sink;
		this.enabled = opts.enabled;
		this.onChange = opts.onChange ?? (() => {});
		this.now = opts.now ?? Date.now;
		this.load();
	}

	private load() {
		let names: string[];
		try {
			names = readdirSync(this.jobsDir).filter((n) => n.endsWith('.json'));
		} catch {
			return; // No jobs yet.
		}
		for (const name of names) {
			const file = join(this.jobsDir, name);
			try {
				const job = JSON.parse(readFileSync(file, 'utf8')) as DemoJob;
				if (this.now() - Date.parse(job.record.endedAt) > KEEP_MS) rmSync(file, { force: true });
				else this.jobs.set(job.record.id, job);
			} catch (err) {
				console.error(`[demos] could not read ${file}:`, err);
			}
		}
	}

	private save(job: DemoJob) {
		job.updatedAt = this.now();
		try {
			mkdirSync(this.jobsDir, { recursive: true });
			const file = join(this.jobsDir, `${job.record.id}.json`);
			writeFileSync(file + '.tmp', JSON.stringify(job));
			renameSync(file + '.tmp', file);
		} catch (err) {
			console.error('[demos] could not save a job:', err);
		}
	}

	private waiting(): DemoJob[] {
		return [...this.jobs.values()].filter((j) => j.status === 'waiting');
	}

	/** A match just ended: keep it if it should get damage from its demo. */
	remember(record: MatchRecord) {
		if (!wantsDemoDamage(record)) return;
		const job: DemoJob = {
			record,
			status: 'waiting',
			attempts: 0,
			message: null,
			updatedAt: 0
		};
		this.jobs.set(record.id, job);
		this.save(job);
		this.nextAttemptAt = 0;
		this.onChange();
	}

	/** Called every few seconds. Starts a run once CS2 has closed and something is waiting. */
	tick(now: number, lastPayloadAt: number | null) {
		if (this.running || !this.enabled() || now < this.nextAttemptAt) return;
		if (!this.deps.available() || this.waiting().length === 0) return;
		if (lastPayloadAt !== null && now - lastPayloadAt < GSI_QUIET_MS) {
			this.setState('waiting-for-cs2', 'Waiting for CS2 to close.');
			return;
		}
		this.nextAttemptAt = now + CHECK_MS;
		void this.run();
	}

	/** One pass over the waiting matches. `retry` also retries ones that gave up. */
	run({ retry = false } = {}): Promise<void> {
		this.running ??= this.pass(retry).finally(() => {
			this.running = null;
		});
		return this.running;
	}

	private setState(state: DemoView['state'], message: string | null) {
		if (state === this.state && message === this.message) return;
		this.state = state;
		this.message = message;
		this.onChange();
	}

	private async pass(retry: boolean) {
		if (retry) {
			for (const job of this.jobs.values()) {
				if (job.status === 'failed' || job.status === 'no-demo') {
					Object.assign(job, { status: 'waiting', attempts: 0, message: null });
					this.save(job);
				}
			}
		}
		const waiting = this.waiting();
		if (!waiting.length) {
			this.setState('idle', null);
			return;
		}
		if (!this.deps.available()) {
			this.setState('error', `The Steam helper has no build for ${process.platform}.`);
			return;
		}
		// Steam answers the helper only while CS2 is closed; never poke it during a game.
		if ((await this.deps.isCs2Running()) === true) {
			this.setState('waiting-for-cs2', 'Waiting for CS2 to close.');
			return;
		}
		this.setState('working', 'Asking Steam for your recent matches…');

		let list: GcMatchList;
		try {
			list = await this.deps.recentMatches(this.dir);
		} catch (err) {
			const e = err instanceof DemoError ? err : new DemoError('failed', String(err));
			console.log(`[demos] ${e.message}`);
			this.nextAttemptAt = this.now() + RETRY_MS;
			this.setState(e.kind === 'cs2-open' ? 'waiting-for-cs2' : 'error', e.message);
			return;
		}
		this.lastRunAt = this.now();

		let done = 0;
		for (const job of waiting) {
			await this.process(job, list);
			if (job.status === 'done') done++;
			this.save(job);
			this.onChange();
		}

		const left = this.waiting().length;
		this.nextAttemptAt = left ? this.now() + RETRY_MS : 0;
		const parts = [
			done ? `Added damage to ${done} match${done === 1 ? '' : 'es'}.` : null,
			left ? `${left} still waiting; trying again in ${RETRY_MS / 60_000} minutes.` : null
		].filter(Boolean);
		this.setState('idle', parts.join(' ') || null);
	}

	private async process(job: DemoJob, list: GcMatchList) {
		const record = job.record;
		const age = this.now() - Date.parse(record.endedAt);
		if (list.accountId !== null && list.accountId !== accountIdOf(record.recorderSteamId)) {
			job.message = 'Steam is logged in to a different account than the one that played this.';
			return;
		}
		const match = findGcMatch(record, list.matches);
		if (!match) {
			if (age > NOT_LISTED_MS) {
				this.finish(
					job,
					'no-demo',
					"Steam doesn't list this match (not official, or too long ago)."
				);
			} else job.message = "Steam doesn't list this match yet.";
			return;
		}

		let demo: DemoOnDisk | null = null;
		try {
			demo = await this.deps.obtainDemo(match, this.dir);
			const parsed = this.deps.parseDemo(demo.path, record.recorderSteamId);
			if (!parsed.present) throw new DemoError('failed', "You aren't in this match's demo.");
			if (parsed.map && parsed.map !== record.map) {
				throw new DemoError('failed', `The demo is on ${parsed.map}, not ${record.map}.`);
			}
			const updated = withDemoDamage(record, parsed.damage);
			if (updated.damage === null) {
				throw new DemoError('failed', 'The demo has none of the recorded rounds.');
			}
			this.sink.enqueue(updated);
			job.record = updated;
			this.finish(job, 'done', null);
			console.log(`[demos] added damage to ${record.id}: ADR ${updated.adr}`);
		} catch (err) {
			const e = err instanceof DemoError ? err : new DemoError('failed', String(err));
			console.log(`[demos] ${record.id}: ${e.message}`);
			if (e.kind === 'no-demo') {
				if (age > NO_DEMO_MS) this.finish(job, 'no-demo', e.message);
				else job.message = e.message;
			} else if (++job.attempts >= MAX_ATTEMPTS) this.finish(job, 'failed', e.message);
			else job.message = e.message;
		} finally {
			if (demo?.temporary) await rm(demo.path, { force: true }).catch(() => {});
		}
	}

	private finish(job: DemoJob, status: DemoJobStatus, message: string | null) {
		job.status = status;
		job.message = message;
	}

	view(): DemoView {
		const jobs = [...this.jobs.values()]
			.sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt))
			.slice(0, 10)
			.map((j) => ({
				matchId: j.record.id,
				map: j.record.map,
				mode: j.record.mode,
				startedAt: j.record.startedAt,
				status: j.status,
				message: j.message,
				adr: j.record.adr
			}));
		return {
			enabled: this.enabled(),
			available: this.deps.available(),
			state: this.state,
			message: this.message,
			lastRunAt: this.lastRunAt,
			jobs
		};
	}
}
