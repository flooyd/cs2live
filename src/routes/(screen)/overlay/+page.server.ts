import type { PageServerLoad } from './$types';
import { getRuntime } from '#lib/server/live/index.ts';

export const load: PageServerLoad = ({ url }) => {
	const rt = getRuntime();
	const scale = Number(url.searchParams.get('scale') ?? 1);
	return {
		liveEnabled: !!rt,
		initial: rt?.view() ?? null,
		scale: Number.isFinite(scale) && scale > 0.25 && scale < 6 ? scale : 1
	};
};
