import { randomUUID } from 'node:crypto';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { getAuth } from '#lib/server/auth.ts';
import { getRuntime } from '#lib/server/live/index.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';

// Live routes never need a session: the GSI endpoint and the stream are hit constantly while
// playing, and the second-monitor pages must never show a login screen or fail because the
// database is unreachable.
const NO_SESSION = ['/api/gsi', '/api/live/', '/live', '/overlay'];

export const init: ServerInit = () => {
	// Start the live runtime (outbox retries, timeout ticker) with the server, not on the
	// first request.
	if (!building) getRuntime();
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const auth = getAuth();
	// A local copy without a database has no accounts; everything it serves is local-only.
	if (!auth) return resolve(event);

	const path = event.url.pathname;
	if (!NO_SESSION.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`))) {
		try {
			const session = await auth.api.getSession({ headers: event.request.headers });
			if (session) {
				event.locals.session = session.session;
				event.locals.user = session.user;
			}
		} catch (err) {
			// Database down or misconfigured: carry on signed out rather than failing the page.
			console.error('[auth] session lookup failed:', (err as Error).message);
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;

// Unexpected errors: log the details with a short reference, show visitors only the reference.
// error(404, ...) and other expected errors keep their own status and message.
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind !== 'unknown') return;
	const ref = randomUUID().slice(0, 8);
	console.error(`[error ${ref}] ${event.request.method} ${event.url.pathname}:`, error);
	return { message: 'Something went wrong on our side.', ref };
};
