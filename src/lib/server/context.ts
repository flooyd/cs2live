// "Who is looking at this page": the local copy's Steam ID (live tracking), the signed-in
// account's claimed Steam ID (site), and which features this deployment has.
import { eq } from 'drizzle-orm';
import { liveEnabled } from './config.ts';
import { getDb, hasDb } from './db/index.ts';
import { steamLinks } from './db/schema.ts';
import { getRuntime } from './live/index.ts';

export interface AppContext {
	liveEnabled: boolean;
	hasDb: boolean;
	user: { id: string; name: string; email: string } | null;
	/** Steam ID set on this local copy's /setup page. */
	localSteamId: string | null;
	/** Steam ID claimed by the signed-in account. */
	accountSteamId: string | null;
	/** Whichever of the two we know: "my" matches and stats. */
	mySteamId: string | null;
	/** Public site this local copy uploads to (for links when there is no database here). */
	siteUrl: string | null;
}

export async function appContext(locals: App.Locals): Promise<AppContext> {
	const settings = getRuntime()?.settings.get() ?? null;
	let accountSteamId: string | null = null;
	const db = getDb();
	if (db && locals.user) {
		try {
			const [link] = await db
				.select({ steamId: steamLinks.steamId })
				.from(steamLinks)
				.where(eq(steamLinks.userId, locals.user.id));
			accountSteamId = link?.steamId ?? null;
		} catch (err) {
			console.error('[context] could not read the Steam link:', err);
		}
	}
	const localSteamId = settings?.steamId ?? null;
	return {
		liveEnabled,
		hasDb,
		user: locals.user
			? { id: locals.user.id, name: locals.user.name, email: locals.user.email }
			: null,
		localSteamId,
		accountSteamId,
		mySteamId: localSteamId ?? accountSteamId,
		siteUrl: settings?.siteUrl ?? null
	};
}
