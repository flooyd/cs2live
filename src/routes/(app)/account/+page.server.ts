import { fail, redirect } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getAuth } from '#lib/server/auth.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	claimSteamId,
	getSteamLink,
	revokeUploadKey,
	rotateUploadKey
} from '#lib/server/db/accounts.ts';
import { matches } from '#lib/server/db/schema.ts';
import { parseSteamId } from '#lib/cs2/steamid.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	const db = getDb();
	if (!db || !getAuth()) return { enabled: false as const };
	if (!locals.user) redirect(303, '/account/login');

	const link = await getSteamLink(db, locals.user.id);
	let uploaded = 0;
	if (link) {
		const [row] = await db
			.select({ n: count() })
			.from(matches)
			.where(eq(matches.recorderSteamId, link.steamId));
		uploaded = row.n;
	}
	return {
		enabled: true as const,
		user: { name: locals.user.name, email: locals.user.email },
		link: link && {
			steamId: link.steamId,
			keyPrefix: link.uploadKeyPrefix,
			keyCreatedAt: link.keyCreatedAt?.getTime() ?? null,
			lastUploadAt: link.lastUploadAt?.getTime() ?? null
		},
		uploaded,
		siteUrl: url.origin
	};
};

function requireUser(locals: App.Locals) {
	const db = getDb();
	if (!db || !locals.user) return null;
	return { db, userId: locals.user.id };
}

export const actions: Actions = {
	claim: async ({ request, locals }) => {
		const ctx = requireUser(locals);
		if (!ctx) return fail(401, { steamIdError: 'Sign in first.' });
		const raw = (await request.formData()).get('steamId');
		const parsed = parseSteamId(typeof raw === 'string' ? raw : '');
		if (!parsed.ok) {
			return fail(400, {
				steamIdError:
					parsed.reason === 'vanity'
						? `"${parsed.vanity}" is a custom profile name. Use your SteamID64 or /profiles/ link instead.`
						: "That doesn't look like a Steam ID."
			});
		}
		const result = await claimSteamId(ctx.db, ctx.userId, parsed.steamId);
		if (!result.ok) {
			return fail(409, {
				steamIdError:
					'Another account already claimed that Steam ID. If it is yours, ask the site owner to sort it out.'
			});
		}
		return { claimed: parsed.steamId };
	},

	createKey: async ({ locals }) => {
		const ctx = requireUser(locals);
		if (!ctx) return fail(401, { keyError: 'Sign in first.' });
		const key = await rotateUploadKey(ctx.db, ctx.userId);
		if (!key) return fail(400, { keyError: 'Claim your Steam ID first.' });
		// Shown once; only its hash is stored.
		return { newKey: key };
	},

	revokeKey: async ({ locals }) => {
		const ctx = requireUser(locals);
		if (!ctx) return fail(401, { keyError: 'Sign in first.' });
		await revokeUploadKey(ctx.db, ctx.userId);
		return { revoked: true };
	},

	signOut: async ({ request }) => {
		const auth = getAuth();
		if (auth) await auth.api.signOut({ headers: request.headers }).catch(() => {});
		redirect(303, '/');
	}
};
