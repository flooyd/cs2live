// Game mode knowledge. Pure, works in the browser too.
//
// Timings are standard Valve defaults as we understand them for CS2; they drive *estimates*
// only (round timer, bomb timer) and are labelled as such in the UI. Servers can change them.
// Verify against real captures: the timestamps of phase changes give the real values.

export interface ModeInfo {
	label: string;
	/** Rounds in regulation (null: no fixed length or unknown). */
	regulationRounds: number | null;
	/** Rounds per half in regulation (side switch after this many). */
	halfLength: number | null;
	/** Rounds per overtime half (null: no overtime). */
	overtimeHalf: number | null;
	freezeTimeS: number;
	roundTimeS: number;
	/** Whether this mode is round-based with an economy (excludes deathmatch, arms race). */
	roundBased: boolean;
}

const MODES: Record<string, ModeInfo> = {
	competitive: {
		label: 'Competitive',
		regulationRounds: 24,
		halfLength: 12,
		overtimeHalf: 3,
		freezeTimeS: 20,
		roundTimeS: 115,
		roundBased: true
	},
	premier: {
		label: 'Premier',
		regulationRounds: 24,
		halfLength: 12,
		overtimeHalf: 3,
		freezeTimeS: 20,
		roundTimeS: 115,
		roundBased: true
	},
	scrimcomp2v2: {
		label: 'Wingman',
		regulationRounds: 16,
		halfLength: 8,
		overtimeHalf: 3,
		freezeTimeS: 15,
		roundTimeS: 90,
		roundBased: true
	},
	casual: {
		label: 'Casual',
		regulationRounds: null,
		halfLength: null,
		overtimeHalf: null,
		freezeTimeS: 15,
		roundTimeS: 135,
		roundBased: true
	},
	deathmatch: {
		label: 'Deathmatch',
		regulationRounds: null,
		halfLength: null,
		overtimeHalf: null,
		freezeTimeS: 0,
		roundTimeS: 600,
		roundBased: false
	},
	gungameprogressive: {
		label: 'Arms Race',
		regulationRounds: null,
		halfLength: null,
		overtimeHalf: null,
		freezeTimeS: 0,
		roundTimeS: 600,
		roundBased: false
	}
};

const UNKNOWN: ModeInfo = {
	label: 'Unknown',
	regulationRounds: null,
	halfLength: null,
	overtimeHalf: null,
	freezeTimeS: 15,
	roundTimeS: 115,
	roundBased: true
};

export function modeInfo(mode: string | undefined | null): ModeInfo {
	if (!mode) return UNKNOWN;
	return MODES[mode] ?? { ...UNKNOWN, label: mode };
}

export function modeLabel(mode: string | undefined | null): string {
	return modeInfo(mode).label;
}

/** Bomb fuse after plant (mp_c4timer default). Estimate. */
export const BOMB_TIMER_S = 40;
/** Time between round end and the next freeze time (mp_round_restart_delay default). */
export const ROUND_OVER_S = 7;

/** `de_mirage` -> `Mirage`; workshop paths keep only the last segment. */
export function mapLabel(map: string | undefined | null): string {
	if (!map) return '—';
	const last = map.split('/').pop() ?? map;
	const base = last.replace(/^(de|cs|ar|dz|gd|aim|fy)_/, '');
	return base
		.split('_')
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
		.join(' ');
}

/** Whether `round` (1-based) is in overtime for this mode. */
export function isOvertimeRound(mode: string | undefined | null, round: number): boolean {
	const reg = modeInfo(mode).regulationRounds;
	return reg !== null && round > reg;
}
