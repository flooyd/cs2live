// GSI ingest: capture, validate, update live state, run the match state machine.
// Never throws: a malformed payload must not break /api/gsi.
import { timingSafeEqual } from 'node:crypto';
import { parsePayload } from './schema.ts';
import type { LiveRuntime } from '../live/runtime.ts';

export type IngestResult = { ok: true } | { ok: false; reason: string };

/** Constant-time token comparison. */
export function tokenMatches(expected: string | null, got: unknown): boolean {
	if (!expected || typeof got !== 'string') return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(got);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function authToken(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object') return undefined;
	const auth = (raw as { auth?: unknown }).auth;
	return auth && typeof auth === 'object' ? (auth as { token?: unknown }).token : undefined;
}

export function ingest(
	rt: LiveRuntime,
	raw: unknown,
	at: number,
	headers: Record<string, string> = {}
): IngestResult {
	try {
		rt.recorder?.record(at, raw, headers);
		const p = parsePayload(raw);
		if (!p) return { ok: false, reason: 'payload is not a JSON object' };
		rt.applyPayload(p, at);
		const events = rt.tracker.ingest(p, at);
		rt.handleEvents(events, at);
		rt.broadcast();
		return { ok: true };
	} catch (err) {
		console.error('[gsi] ingest failed:', err);
		return { ok: false, reason: 'internal error' };
	}
}
