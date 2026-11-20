import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// "My stats": the stats page of whichever Steam ID we know is yours.
export const load: PageServerLoad = async ({ parent }) => {
	const { ctx } = await parent();
	if (ctx.mySteamId && ctx.hasDb) redirect(303, `/players/${ctx.mySteamId}/stats`);
	if (ctx.mySteamId && ctx.siteUrl) redirect(303, `${ctx.siteUrl}/players/${ctx.mySteamId}/stats`);
	return {};
};
