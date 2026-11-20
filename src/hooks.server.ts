import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { getAuth } from '#lib/server/auth.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';

// The GSI endpoint and the live stream never need a session, and they are hit up to ten times
// a second while playing, so skip the auth lookup (a database round trip) for them.
const NO_SESSION = ['/api/gsi', '/api/live/'];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const auth = getAuth();
	// A local copy without a database has no accounts; everything it serves is local-only.
	if (!auth) return resolve(event);

	const path = event.url.pathname;
	if (!NO_SESSION.some((p) => path.startsWith(p))) {
		const session = await auth.api.getSession({ headers: event.request.headers });
		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
