import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { searchPlayers, type PlayerHit } from '#lib/server/db/stats/players.ts';
import { recentGames, type MatchListRow } from '#lib/server/db/stats/matches.ts';
import { parseSteamId } from '#lib/cs2/steamid.ts';

export const load: PageServerLoad = async ({ url, parent }) => {
	const { ctx } = await parent();
	const db = getDb();
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	let hits: PlayerHit[] = [];
	let message: string | null = null;

	if (q) {
		const parsed = parseSteamId(q);
		if (parsed.ok) {
			if (db) redirect(303, `/players/${parsed.steamId}`);
			if (ctx.siteUrl) redirect(303, `${ctx.siteUrl}/players/${parsed.steamId}`);
			message = 'Match history lives on the CS2Live site. Add its URL on the Setup page.';
		} else if (db) {
			// Not a Steam ID: search names. A custom profile URL often matches the in-game name.
			const name = parsed.reason === 'vanity' ? (parsed.vanity ?? q) : q;
			hits = await searchPlayers(db, name);
			if (parsed.reason === 'vanity') {
				message = `"${parsed.vanity}" is a custom profile URL, which can't be looked up without a Steam API key. Showing players named like it instead; your SteamID64 always works.`;
			} else if (!hits.length) {
				message = `No player named like "${q}" yet. Names come from recorded matches, so try a Steam ID or profile link.`;
			}
		} else {
			message = 'Enter a Steam ID or a steamcommunity.com/profiles/… link.';
		}
	}

	let recent: MatchListRow[] = [];
	if (db) {
		try {
			recent = await recentGames(db, 8);
		} catch (err) {
			console.error('[home] recent games failed:', err);
		}
	}
	return { q, hits, message, recent };
};
