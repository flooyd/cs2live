// Fills in damage for finished official matches from their demos, after the game.
//
// CS2 sends no damage over GSI, but Valve keeps a demo of every official match. When a Premier,
// Competitive or Wingman match ends without damage, it is kept here as a job. Once CS2 is closed
// (the Steam helper only works then), we ask Steam for the recent match list, find the match,
// take the demo from CS2's replays folder or download it, read your damage per round and send the
// match again through the outbox with the damage filled in.
//
// Demos are kept for watching in CS2 (demo-file.ts saves them where CS2 keeps its own). Every time
// it asks Steam, it also saves the demo of each listed match you played that isn't on this PC yet.
//
// It can also import matches CS2Live never recorded (importRecent): every official match in
// Steam's recent list that no job covers is built entirely from its demo (demo-record.ts) and
// kept as a finished job, so it isn't imported twice.
//
// Jobs live in CS2LIVE_DATA_DIR/demos/jobs/<match id>.json. Node-only, no framework imports.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { MatchRecord } from '#lib/match-record.ts';
import type { GcMatch, GcMatchList } from './gc-match-list.ts';
import { accountIdOf, findGcMatch, wantsDemoDamage, withDemoDamage } from './match-demo.ts';
import { DemoError } from './steam.ts';
import type { DemoOnDisk, ParsedDemo, SavedDemos } from './demo-file.ts';
import { demoRecordId, matchFromDemo, type DemoMatchData } from './demo-record.ts';

export type DemoJobStatus = 'waiting' | 'done' | 'no-demo' | 'failed';

export interface DemoJob {
	record: MatchRecord;
	status: DemoJobStatus;
	/** Failed tries (download or parse); 'not listed yet' does not count. */
	attempts: number;
	message: string | null;
	updatedAt: number;
	/** The match's demo on this PC, kept for watching. Missing in jobs from before demos were kept. */
	demo?: string | null;
}

/** The outside world, swappable in tests. */
export interface DemoDeps {
	available: () => boolean;
	isCs2Running: () => Promise<boolean | null>;
	recentMatches: (workDir: string) => Promise<GcMatchList>;
	/** Finds or downloads a demo; `ownDir` is where it goes when CS2's replays folder can't be used. */
	obtainDemo: (match: GcMatch, ownDir: string) => Promise<DemoOnDisk>;
	parseDemo: (path: string, steamId: string) => ParsedDemo;
	readDemoMatch: (path: string, steamId: string) => DemoMatchData;
	savedDemos: (ownDir: string) => SavedDemos;
	/** The CS2 console command that plays a demo, or null when CS2 can't reach it. */
	playdemo: (path: string) => string | null;
}

/** A match demo on this PC, and how to watch it. */
export interface SavedDemo {
	file: string;
	playdemo: string | null;
}

export interface DemoView {
	enabled: boolean;
	/** The Steam helper exists for this platform. */
	available: boolean;
	state: 'idle' | 'waiting-for-cs2' | 'working' | 'error';
	message: string | null;
	lastRunAt: number | null;
	/** Demos on this PC. */
	saved: SavedDemos;
	jobs: {
		matchId: string;
		map: string;
		mode: string;
		startedAt: string;
		status: DemoJobStatus;
		message: string | null;
		adr: number | null;
		/** Built from the demo, not recorded live. */
		imported: boolean;
		demo: SavedDemo | null;
	}[];
}

export interface DemoFetcherOptions {
	dir: string;
	deps: DemoDeps;
	/** Where the match goes once it has damage (the outbox). */
	sink: { enqueue(record: MatchRecord): void };
	enabled: () => boolean;
	/** The Steam ID this copy tracks: whose matches get imported. */
	steamId?: () => string | null;
	/** Stamped on imported matches. */
	appVersion?: string;
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
/** Jobs are kept this long, or for as long as their demo is on this PC. */
const KEEP_MS = 30 * 24 * 3600_000;

export class DemoFetcher {
	private dir: string;
	private jobsDir: string;
	/** Where demos go when CS2's replays folder can't be used. */
	private filesDir: string;
	private deps: DemoDeps;
	private sink: DemoFetcherOptions['sink'];
	private enabled: () => boolean;
	private steamId: () => string | null;
	private appVersion: string;
	private onChange: () => void;
	private now: () => number;
	private jobs = new Map<string, DemoJob>();
	private running: Promise<void> | null = null;
	private nextAttemptAt = 0;
	private state: DemoView['state'] = 'idle';
	private message: string | null = null;
	private lastRunAt: number | null = null;

	constructor(opts: DemoFetcherOptions) {
		// CS2LIVE_DATA_DIR is relative by default; tools we start run in other folders.
		this.dir = resolve(opts.dir);
		this.jobsDir = join(opts.dir, 'jobs');
		this.filesDir = join(this.dir, 'files');
		this.deps = opts.deps;
		this.sink = opts.sink;
		this.enabled = opts.enabled;
		this.steamId = opts.steamId ?? (() => null);
		this.appVersion = opts.appVersion ?? 'unknown';
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
				const old = this.now() - Date.parse(job.record.endedAt) > KEEP_MS;
				// A job whose demo is still here stays: it is how the match finds its demo.
				if (old && !this.demoOf(job)) rmSync(file, { force: true });
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

	/** The job's demo, if it is still on this PC. */
	private demoOf(job: DemoJob): string | null {
		return job.demo && existsSync(job.demo) ? job.demo : null;
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
		return this.running ?? this.exclusive(() => this.pass(retry));
	}

	/** Imports Steam's recent official matches that CS2Live didn't record. Queued after a run. */
	importRecent(): Promise<void> {
		return this.exclusive(() => this.importPass());
	}

	/** One Steam conversation at a time: the helper can't run twice. */
	private exclusive(task: () => Promise<void>): Promise<void> {
		const p: Promise<void> = (this.running ?? Promise.resolve())
			.catch(() => {})
			.then(task)
			.finally(() => {
				if (this.running === p) this.running = null;
			});
		this.running = p;
		return p;
	}

	private setState(state: DemoView['state'], message: string | null) {
		if (state === this.state && message === this.message) return;
		this.state = state;
		this.message = message;
		this.onChange();
	}

	/** Steam's match list, or null after setting the state to why not. */
	private async askSteam(): Promise<GcMatchList | null> {
		if (!this.deps.available()) {
			this.setState('error', `The Steam helper has no build for ${process.platform}.`);
			return null;
		}
		// Steam answers the helper only while CS2 is closed; never poke it during a game.
		if ((await this.deps.isCs2Running()) === true) {
			this.setState('waiting-for-cs2', 'Waiting for CS2 to close.');
			return null;
		}
		this.setState('working', 'Asking Steam for your recent matches…');
		try {
			const list = await this.deps.recentMatches(this.dir);
			this.lastRunAt = this.now();
			return list;
		} catch (err) {
			const e = err instanceof DemoError ? err : new DemoError('failed', String(err));
			console.log(`[demos] ${e.message}`);
			this.nextAttemptAt = this.now() + RETRY_MS;
			this.setState(e.kind === 'cs2-open' ? 'waiting-for-cs2' : 'error', e.message);
			return null;
		}
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
		// Asked for (retry), it goes to Steam even with nothing waiting, to save missing demos.
		if (!waiting.length && !retry) {
			this.setState('idle', null);
			return;
		}
		const list = await this.askSteam();
		if (!list) return;

		let done = 0;
		const tried = new Set<string>();
		for (const job of waiting) {
			await this.process(job, list, tried);
			if (job.status === 'done') done++;
			this.save(job);
			this.onChange();
		}
		const kept = await this.keepDemos(list, tried);

		const left = this.waiting().length;
		this.nextAttemptAt = left ? this.now() + RETRY_MS : 0;
		const parts = [
			done ? `Added damage to ${done} match${done === 1 ? '' : 'es'}.` : null,
			...kept,
			left ? `${left} still waiting; trying again in ${RETRY_MS / 60_000} minutes.` : null
		].filter(Boolean);
		this.setState('idle', parts.join(' ') || null);
	}

	/** The job for a listed match: its import, or the recording it matches. */
	private jobFor(match: GcMatch, list: GcMatch[]): DemoJob | undefined {
		for (const job of this.jobs.values()) {
			const r = job.record;
			const found =
				r.origin === 'demo'
					? r.id === demoRecordId(match.matchId, r.recorderSteamId)
					: findGcMatch(r, list)?.matchId === match.matchId;
			if (found) return job;
		}
		return undefined;
	}

	/**
	 * Saves the demos of listed matches you played that aren't on this PC yet (`tried` were just
	 * handled) and notes them on their jobs. Returns what to tell you.
	 */
	private async keepDemos(list: GcMatchList, tried: Set<string>): Promise<string[]> {
		const steamId = this.steamId();
		if (!steamId) return [];
		const me = accountIdOf(steamId);
		if (list.accountId !== null && list.accountId !== me) return [];
		const todo = list.matches
			.filter((m) => m.accountIds.includes(me) && !tried.has(m.matchId))
			.map((match) => ({ match, job: this.jobFor(match, list.matches) }))
			.filter(({ job }) => !job || !this.demoOf(job));

		let saved = 0;
		const problems: string[] = [];
		for (const [i, { match, job }] of todo.entries()) {
			this.setState('working', `Saving match demos (${i + 1} of ${todo.length})…`);
			try {
				const demo = await this.deps.obtainDemo(match, this.filesDir);
				if (demo.downloaded) saved++;
				if (job) {
					job.demo = demo.path;
					this.save(job);
				}
			} catch (err) {
				const e = err instanceof DemoError ? err : new DemoError('failed', String(err));
				console.log(`[demos] saving the demo of ${match.matchId}: ${e.message}`);
				// Valve deletes demos after a while; nothing to tell you about those.
				if (e.kind !== 'no-demo') problems.push(e.message);
			}
		}
		if (todo.length) this.onChange();
		const n = problems.length;
		return [
			saved ? `Saved ${saved} demo${saved === 1 ? '' : 's'}.` : null,
			n
				? `${n} demo${n === 1 ? '' : 's'} could not be saved: ${[...new Set(problems)].join(' ')}`
				: null
		].filter((p): p is string => p !== null);
	}

	private async process(job: DemoJob, list: GcMatchList, tried: Set<string>) {
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

		tried.add(match.matchId);
		try {
			const demo = await this.deps.obtainDemo(match, this.filesDir);
			job.demo = demo.path;
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
		}
	}

	private async importPass() {
		const steamId = this.steamId();
		if (!steamId) {
			this.setState('error', 'Save your Steam ID above before importing matches.');
			return;
		}
		const list = await this.askSteam();
		if (!list) return;
		const me = accountIdOf(steamId);
		if (list.accountId !== null && list.accountId !== me) {
			this.setState(
				'error',
				'Steam is logged in to a different account than the Steam ID CS2Live tracks.'
			);
			return;
		}

		// Matches we already have: imported ones by id, recorded ones by the entry they match.
		const records = [...this.jobs.values()].map((j) => j.record);
		const known = new Set(records.map((r) => r.id));
		const claimed = new Set(
			records.filter((r) => r.origin !== 'demo').map((r) => findGcMatch(r, list.matches)?.matchId)
		);
		const fresh = list.matches
			.filter((m) => m.accountIds.includes(me))
			.filter((m) => !claimed.has(m.matchId) && !known.has(demoRecordId(m.matchId, steamId)))
			.sort((a, b) => a.matchTime - b.matchTime);

		let imported = 0;
		const problems: string[] = [];
		const tried = new Set<string>();
		for (const [i, match] of fresh.entries()) {
			this.setState('working', `Importing match ${i + 1} of ${fresh.length} from its demo…`);
			tried.add(match.matchId);
			try {
				const demo = await this.deps.obtainDemo(match, this.filesDir);
				const data = this.deps.readDemoMatch(demo.path, steamId);
				const record = matchFromDemo(data, {
					steamId,
					gcMatchId: match.matchId,
					matchTime: match.matchTime,
					appVersion: this.appVersion
				});
				if (!record) throw new DemoError('failed', 'You are not in this match’s demo.');
				this.sink.enqueue(record);
				const job: DemoJob = {
					record,
					status: 'done',
					attempts: 0,
					message: 'Imported from the match demo.',
					updatedAt: 0,
					demo: demo.path
				};
				this.jobs.set(record.id, job);
				this.save(job);
				imported++;
				console.log(`[demos] imported ${record.map} ${record.scoreMine}-${record.scoreTheirs}`);
			} catch (err) {
				const e = err instanceof DemoError ? err : new DemoError('failed', String(err));
				console.log(`[demos] import of ${match.matchId}: ${e.message}`);
				problems.push(e.message);
			}
			this.onChange();
		}
		const kept = await this.keepDemos(list, tried);

		const parts: string[] = [];
		if (imported) parts.push(`Imported ${imported} match${imported === 1 ? '' : 'es'}.`);
		else if (!problems.length) {
			parts.push(
				`Nothing new: CS2Live already has all ${list.matches.length} matches Steam lists.`
			);
		}
		if (problems.length) {
			parts.push(`${problems.length} could not be imported: ${[...new Set(problems)].join(' ')}`);
		}
		parts.push(...kept);
		this.setState(problems.length && !imported ? 'error' : 'idle', parts.join(' '));
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
				adr: j.record.adr,
				imported: j.record.origin === 'demo',
				demo: this.saved(j)
			}));
		return {
			enabled: this.enabled(),
			available: this.deps.available(),
			state: this.state,
			message: this.message,
			lastRunAt: this.lastRunAt,
			saved: this.deps.savedDemos(this.filesDir),
			jobs
		};
	}

	private saved(job: DemoJob): SavedDemo | null {
		const file = this.demoOf(job);
		return file ? { file, playdemo: this.deps.playdemo(file) } : null;
	}

	/** The demo of a match CS2Live has (by its id), if it is on this PC. */
	demoFor(matchId: string): SavedDemo | null {
		const job = this.jobs.get(matchId);
		return job ? this.saved(job) : null;
	}
}
