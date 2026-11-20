import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { playerMatches } from '#lib/server/db/stats/matches.ts';
import { filterOptions, playerProfile } from '#lib/server/db/stats/players.ts';
import { isSteamId64 } from '#lib/cs2/steamid.ts';
import { parseMatchFilters } from '#lib/match-filters.ts';

export const load: PageServerLoad = async ({ params, url, parent }) => {
	if (!isSteamId64(params.steamid)) error(404, 'That is not a SteamID64.');
	const { ctx } = await parent();
	const db = getDb();
	if (!db) return { remote: true as const, steamId: params.steamid, siteUrl: ctx.siteUrl };

	const filters = parseMatchFilters(url.searchParams);
	const [profile, list, options] = await Promise.all([
		playerProfile(db, params.steamid),
		playerMatches(db, params.steamid, filters),
		filterOptions(db, params.steamid)
	]);
	return {
		remote: false as const,
		steamId: params.steamid,
		profile,
		list,
		options,
		filters,
		isMe: ctx.mySteamId === params.steamid
	};
};
