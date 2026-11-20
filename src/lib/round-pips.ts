// Round history pips (the coloured strip of round results), shared by the live view and the
// match page. Pure; no framework imports.
import { modeInfo } from '#lib/cs2/modes.ts';
import { roundWinsList, type Side } from '#lib/cs2/rounds.ts';
import type { RoundPip } from '#lib/live/types.ts';

/**
 * @param roundWins map.round_wins from GSI (round number -> reason), the full history.
 * @param sides your side in the rounds the recorder saw, by round number.
 */
export function buildRoundPips(
	mode: string | null | undefined,
	roundWins: Record<string, string> | null | undefined,
	sides: ReadonlyMap<number, Side | null>
): RoundPip[] {
	const info = modeInfo(mode);
	const list = roundWinsList(roundWins);
	return list.map((w, i) => {
		const mySide = sides.get(w.round) ?? null;
		const prevSide = i > 0 ? (sides.get(list[i - 1].round) ?? null) : null;
		const ruleSwitch =
			info.halfLength !== null && info.regulationRounds !== null && w.round === info.halfLength + 1;
		const otStart = info.regulationRounds !== null && w.round === info.regulationRounds + 1;
		return {
			round: w.round,
			winner: w.side,
			kind: w.kind,
			reason: w.reason,
			mySide,
			iWon: mySide && w.side ? mySide === w.side : null,
			switchBefore: (mySide && prevSide ? mySide !== prevSide : ruleSwitch) || otStart,
			overtime: info.regulationRounds !== null && w.round > info.regulationRounds
		};
	});
}
