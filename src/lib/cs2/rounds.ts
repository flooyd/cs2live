// Round outcome helpers. Pure, works in the browser too.

export type Side = 'CT' | 'T';

export function asSide(value: string | undefined | null): Side | null {
	if (!value) return null;
	const v = value.toUpperCase();
	return v === 'CT' ? 'CT' : v === 'T' ? 'T' : null;
}

export function otherSide(side: Side): Side {
	return side === 'CT' ? 'T' : 'CT';
}

export type WinKind = 'elimination' | 'bomb' | 'defuse' | 'time' | 'rescue' | 'surrender' | 'other';

/** `ct_win_defuse` -> { side: 'CT', kind: 'defuse' }. Unknown reasons keep their side if we can tell. */
export function parseWinReason(reason: string | undefined | null): {
	side: Side | null;
	kind: WinKind;
} {
	if (!reason) return { side: null, kind: 'other' };
	const r = reason.toLowerCase();
	const side: Side | null = r.startsWith('ct_') ? 'CT' : r.startsWith('t_') ? 'T' : null;
	const kind: WinKind = r.includes('elimination')
		? 'elimination'
		: r.includes('bomb')
			? 'bomb'
			: r.includes('defuse')
				? 'defuse'
				: r.includes('time')
					? 'time'
					: r.includes('rescue') || r.includes('hostage')
						? 'rescue'
						: r.includes('surrender')
							? 'surrender'
							: 'other';
	return { side, kind };
}

export function winKindLabel(kind: WinKind): string {
	switch (kind) {
		case 'elimination':
			return 'Elimination';
		case 'bomb':
			return 'Bomb exploded';
		case 'defuse':
			return 'Bomb defused';
		case 'time':
			return 'Time ran out';
		case 'rescue':
			return 'Hostages rescued';
		case 'surrender':
			return 'Surrender';
		default:
			return 'Other';
	}
}

/** One glyph per win kind for the round strip. */
export function winKindGlyph(kind: WinKind): string {
	switch (kind) {
		case 'elimination':
			return '☠';
		case 'bomb':
			return '✹';
		case 'defuse':
			return '✂';
		case 'time':
			return '⏱';
		case 'rescue':
			return '⛑';
		case 'surrender':
			return '⚑';
		default:
			return '·';
	}
}

/** `{ "1": "ct_win_elimination", ... }` -> sorted list. Bad keys are dropped. */
export function roundWinsList(
	roundWins: Record<string, string> | undefined | null
): { round: number; reason: string; side: Side | null; kind: WinKind }[] {
	if (!roundWins) return [];
	return Object.entries(roundWins)
		.map(([k, reason]) => ({ round: Number(k), reason, ...parseWinReason(reason) }))
		.filter((r) => Number.isInteger(r.round) && r.round > 0)
		.sort((a, b) => a.round - b.round);
}
