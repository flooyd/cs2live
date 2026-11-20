import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { listGames } from '#lib/server/db/stats/matches.ts';
import { filterOptions } from '#lib/server/db/stats/players.ts';
import { parseMatchFilters } from '#lib/match-filters.ts';

export const load: PageServerLoad = async ({ url, parent }) => {
	const { ctx } = await parent();
	const db = getDb();
	if (!db) return { remote: true as const, siteUrl: ctx.siteUrl };
	const filters = parseMatchFilters(url.searchParams);
	const [list, options] = await Promise.all([listGames(db, filters), filterOptions(db)]);
	return { remote: false as const, list, options, filters };
};
