import type { LayoutServerLoad } from './$types';
import { appContext } from '#lib/server/context.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
	return { ctx: await appContext(locals) };
};
