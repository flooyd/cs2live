import type { PageServerLoad } from './$types';
import { getRuntime } from '#lib/server/live/index.ts';

export const load: PageServerLoad = () => {
	const rt = getRuntime();
	return {
		liveEnabled: !!rt,
		initial: rt?.view() ?? null,
		steamIdLocked: rt?.settings.locked().steamId ?? false
	};
};
