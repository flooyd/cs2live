import { ORIGIN, BETTER_AUTH_SECRET, SIGNUP_ALLOWLIST } from '$app/env/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { APIError } from 'better-auth/api';
import { getRequestEvent } from '$app/server';
import { count } from 'drizzle-orm';
import { getDb, type Db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { signupAllowed } from './signup.ts';

function build(db: Db) {
	return betterAuth({
		baseURL: ORIGIN,
		secret: BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'pg' }),
		emailAndPassword: { enabled: true },
		databaseHooks: {
			user: {
				create: {
					// Accounts exist so people can claim a Steam ID and get an upload key.
					// Sign-up is limited by SIGNUP_ALLOWLIST (or to the first account when it is empty).
					before: async (candidate) => {
						const [{ n }] = await db.select({ n: count() }).from(user);
						if (!signupAllowed(candidate.email, SIGNUP_ALLOWLIST, n)) {
							throw new APIError('FORBIDDEN', {
								message: 'Sign-up is closed. Ask the site owner to add your email.'
							});
						}
					}
				}
			}
		},
		plugins: [
			sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
		]
	});
}

export type Auth = ReturnType<typeof build>;

let instance: Auth | null = null;

/** better-auth, or `null` on a local copy without a database (accounts live on the site). */
export function getAuth(): Auth | null {
	const db = getDb();
	if (!db) return null;
	instance ??= build(db);
	return instance;
}
