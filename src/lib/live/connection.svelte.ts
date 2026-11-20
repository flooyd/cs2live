// Browser side of the live stream: an EventSource on /api/live/stream with reconnects, plus a
// clock that ticks a few times a second so timers and "last update" ages stay fresh.
import type { LiveView } from './types.ts';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

export class LiveConnection {
	view = $state<LiveView | null>(null);
	status = $state<StreamStatus>('connecting');
	/** Client time, ticking every 250 ms. */
	now = $state(Date.now());
	/** serverTime - clientTime when the last update arrived. */
	private offset = 0;
	private source: EventSource | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private url: string;

	constructor(url: string, initial: LiveView | null) {
		this.url = url;
		this.view = initial;
		if (initial) this.offset = initial.serverTime - Date.now();
	}

	/** Server time as of now, for comparing with timestamps in the view. */
	get serverNow() {
		return this.now + this.offset;
	}

	start() {
		this.timer = setInterval(() => (this.now = Date.now()), 250);
		this.connect();
		return () => this.stop();
	}

	private connect() {
		this.source?.close();
		const source = new EventSource(this.url);
		this.source = source;
		source.addEventListener('open', () => (this.status = 'open'));
		source.addEventListener('state', (event) => {
			try {
				const view = JSON.parse((event as MessageEvent<string>).data) as LiveView;
				this.offset = view.serverTime - Date.now();
				this.view = view;
				this.status = 'open';
			} catch {
				// Ignore a garbled message; the next one replaces it.
			}
		});
		source.addEventListener('error', () => {
			this.status = 'reconnecting';
			// EventSource retries by itself unless the server answered with an error status, in
			// which case it gives up (CLOSED). Then we retry ourselves.
			if (source.readyState === EventSource.CLOSED) {
				this.retry = setTimeout(() => this.connect(), 3000);
			}
		});
	}

	stop() {
		this.source?.close();
		this.source = null;
		if (this.timer) clearInterval(this.timer);
		if (this.retry) clearTimeout(this.retry);
	}
}

/** Seconds left until `endsAt` (server ms), never negative. */
export function secondsLeft(endsAt: number, serverNow: number): number {
	return Math.max(0, (endsAt - serverNow) / 1000);
}

export function formatClock(seconds: number): string {
	const s = Math.ceil(seconds);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
