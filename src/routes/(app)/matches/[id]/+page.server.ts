import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { matchDetail } from '#lib/server/db/stats/matches.ts';
import { buildRoundPips } from '#lib/round-pips.ts';
import { asSide, type Side } from '#lib/cs2/rounds.ts';
import { modeInfo } from '#lib/cs2/modes.ts';

export const load: PageServerLoad = async ({ params, parent }) => {
	if (!z.uuid().safeParse(params.id).success) error(404, 'No such match.');
	const { ctx } = await parent();
	const db = getDb();
	if (!db) return { remote: true as const, id: params.id, siteUrl: ctx.siteUrl };

	const detail = await matchDetail(db, params.id);
	if (!detail) error(404, 'No such match.');

	const sides = new Map<number, Side | null>(
		detail.rounds.map((r) => [r.number, asSide(r.mySide)])
	);
	const info = modeInfo(detail.match.mode);
	return {
		remote: false as const,
		...detail,
		pips: buildRoundPips(detail.match.mode, detail.match.roundWins, sides),
		regulationRounds: info.regulationRounds,
		halfLength: info.halfLength
	};
};
