// The in-memory live runtime: latest payload, match tracker, capture, and SSE listeners.
// One instance per server process (see ./index.ts). No framework imports, so tests can build
// their own.
import type { GsiPayload } from '../gsi/schema.ts';
import { MatchTracker, type TrackerEvent } from '../gsi/match-tracker.ts';
import { GsiRecorder } from '../gsi/recorder.ts';
import { isSelf } from '../gsi/payload.ts';
import { buildLiveView, type PhaseClock } from './view.ts';
import type { SettingsFile } from './settings.ts';
import type { LiveView, SyncView } from '#lib/live/types.ts';
import type { MatchRecord } from '#lib/match-record.ts';

/** Where finished matches go (the outbox, which uploads or writes to the database). */
export interface MatchSink {
	enqueue(record: MatchRecord): void;
	/** Try sending whatever is waiting now (after settings change). */
	flush(): Promise<void>;
	status(): SyncView;
}

export const NULL_SINK: MatchSink = {
	enqueue: () => {},
	flush: () => Promise.resolve(),
	status: () => ({
		mode: 'none',
		target: null,
		pending: 0,
		lastError: null,
		lastSyncedAt: null,
		lastSyncedMatchId: null
	})
};

export interface RuntimeOptions {
	settings: SettingsFile;
	gsiToken: string | null;
	capture: boolean;
	captureDir: string;
	incompleteTimeoutMs: number;
	appVersion: string;
	sink?: MatchSink;
	/** Minimum gap between SSE broadcasts. */
	broadcastMs?: number;
}

export class LiveRuntime {
	readonly settings: SettingsFile;
	readonly tracker: MatchTracker;
	readonly recorder: GsiRecorder | null;
	readonly gsiToken: string | null;
	sink: MatchSink;

	latest: GsiPayload | null = null;
	latestAt: number | null = null;
	lastSelf: GsiPayload | null = null;
	payloadCount = 0;
	ignoredReason: string | null = null;
	lastSaved: { matchId: string; at: number } | null = null;
	clock: PhaseClock = {
		roundPhase: null,
		roundPhaseAt: null,
		roundPhaseObserved: false,
		bombPlantedAt: null,
		bombPlantObserved: false
	};

	private listeners = new Set<(view: LiveView) => void>();
	private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
	private lastBroadcast = 0;
	private broadcastMs: number;

	constructor(opts: RuntimeOptions) {
		this.settings = opts.settings;
		this.gsiToken = opts.gsiToken;
		this.sink = opts.sink ?? NULL_SINK;
		this.broadcastMs = opts.broadcastMs ?? 100;
		this.recorder = opts.capture ? new GsiRecorder(opts.captureDir, opts.appVersion) : null;
		this.tracker = new MatchTracker({
			steamId: opts.settings.get().steamId,
			incompleteTimeoutMs: opts.incompleteTimeoutMs,
			appVersion: opts.appVersion
		});
	}

	/** Updates "latest" state and the phase clock. Called before the tracker sees the payload. */
	applyPayload(p: GsiPayload, at: number) {
		const prev = this.latest;
		const phase = p.round?.phase ?? null;
		if (phase !== this.clock.roundPhase) {
			// A transition we saw happen gives a real start time; the first phase we see does not.
			this.clock.roundPhaseObserved = this.clock.roundPhase !== null;
			this.clock.roundPhase = phase;
			this.clock.roundPhaseAt = at;
		}
		if (p.round?.bomb === 'planted') {
			if (this.clock.bombPlantedAt === null) {
				this.clock.bombPlantedAt = at;
				this.clock.bombPlantObserved =
					!!prev && prev.round?.phase === 'live' && prev.round?.bomb !== 'planted';
			}
		} else {
			this.clock.bombPlantedAt = null;
			this.clock.bombPlantObserved = false;
		}

		this.latest = p;
		this.latestAt = at;
		this.payloadCount++;
		if (isSelf(p)) this.lastSelf = p;
	}

	handleEvents(events: TrackerEvent[], at: number) {
		this.ignoredReason = null;
		for (const e of events) {
			switch (e.type) {
				case 'ignored':
					this.ignoredReason = e.reason;
					break;
				case 'match_started':
					console.log(`[live] match ${e.resumed ? 'resumed' : 'started'}: ${e.matchId}`);
					break;
				case 'match_ended':
					console.log(
						`[live] match ${e.record.status}: ${e.record.map} ${e.record.scoreMine}-${e.record.scoreTheirs}, ${e.record.roundsPlayed} rounds (${e.record.id})`
					);
					this.lastSaved = { matchId: e.record.id, at };
					this.sink.enqueue(e.record);
					break;
				case 'match_discarded':
					console.log(`[live] match discarded (${e.reason}): ${e.matchId}`);
					break;
			}
		}
	}

	tick(now: number) {
		const events = this.tracker.tick(now);
		if (events.length) {
			this.handleEvents(events, now);
			this.broadcast();
		}
	}

	setSteamId(steamId: string | null) {
		this.settings.save({ steamId });
		this.tracker.setSteamId(steamId);
		this.broadcast();
	}

	view(now = Date.now()): LiveView {
		return buildLiveView({
			now,
			latest: this.latest,
			latestAt: this.latestAt,
			lastSelf: this.lastSelf,
			payloadCount: this.payloadCount,
			clock: this.clock,
			steamId: this.tracker.steamId,
			tokenConfigured: !!this.gsiToken,
			capturing: !!this.recorder,
			trackerState: this.tracker.state,
			match: this.tracker.match ?? this.tracker.lastClosed,
			ignoredReason: this.ignoredReason,
			lastSaved: this.lastSaved,
			sync: this.sink.status()
		});
	}

	subscribe(fn: (view: LiveView) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/** Pushes the current view to every listener, at most once per broadcastMs. */
	broadcast() {
		if (this.listeners.size === 0 || this.broadcastTimer) return;
		const wait = Math.max(0, this.lastBroadcast + this.broadcastMs - Date.now());
		this.broadcastTimer = setTimeout(() => {
			this.broadcastTimer = null;
			this.lastBroadcast = Date.now();
			const view = this.view();
			for (const fn of this.listeners) {
				try {
					fn(view);
				} catch (err) {
					console.error('[live] listener failed:', err);
				}
			}
		}, wait);
	}
}
