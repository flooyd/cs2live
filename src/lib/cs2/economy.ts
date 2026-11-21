// Economy rules and buy-type classification. Pure, works in the browser too.
//
// Everything here is DERIVED or ESTIMATED from your own money and equipment value only:
// GSI does not tell us what your teammates bought.

export type BuyType = 'pistol' | 'eco' | 'force' | 'full' | 'save';
export const BUY_TYPES: BuyType[] = ['pistol', 'eco', 'force', 'full', 'save'];

/**
 * Buy-type thresholds, applied to your **equipment value when freeze time ends** (after buying)
 * and your **money when freeze time started** (before buying):
 *
 * - `pistol`: the first round of a regulation half, or any round where you started freeze time
 *   with $1000 or less right after a side switch (covers mid-match joins).
 * - `full`:  equipment value >= $3700: a rifle with armour and helmet (AK-47 + armour + helmet +
 *            Glock is $3900); also kept weapons from a saved round. Galil and FAMAS buys stay below.
 * - `force`: equipment value >= $2000.
 * - `save`:  equipment value < $2000 although you could have afforded more (start money >= $3000):
 *   you deliberately did not buy.
 * - `eco`:   equipment value < $2000 and you started freeze time with less than $3000.
 */
export const BUY_THRESHOLDS = {
	pistolMaxMoney: 1000,
	full: 3700,
	force: 2000,
	saveMinMoney: 3000
} as const;

export interface BuyInput {
	equipValue: number | null;
	moneyFreezeStart: number | null;
	/** First round of a regulation half according to the mode, or right after a side switch. */
	halfStart: boolean;
}

export function classifyBuy({ equipValue, moneyFreezeStart, halfStart }: BuyInput): BuyType | null {
	if (
		halfStart &&
		(moneyFreezeStart === null || moneyFreezeStart <= BUY_THRESHOLDS.pistolMaxMoney)
	) {
		return 'pistol';
	}
	if (equipValue === null) return null;
	if (equipValue >= BUY_THRESHOLDS.full) return 'full';
	if (equipValue >= BUY_THRESHOLDS.force) return 'force';
	if (moneyFreezeStart !== null && moneyFreezeStart >= BUY_THRESHOLDS.saveMinMoney) return 'save';
	return 'eco';
}

export function buyLabel(buy: BuyType | null | undefined): string {
	switch (buy) {
		case 'pistol':
			return 'Pistol';
		case 'eco':
			return 'Eco';
		case 'force':
			return 'Force';
		case 'full':
			return 'Full buy';
		case 'save':
			return 'Save';
		default:
			return '—';
	}
}

export interface EconomyRules {
	maxMoney: number;
	lossBonusBase: number;
	lossBonusStep: number;
	lossBonusMaxSteps: number;
	winElimination: number;
	winTime: number;
	winBomb: number;
	winDefuse: number;
	/** Extra for each T when the bomb was planted but the round was lost. */
	plantedLossBonus: number;
}

/** Standard CS2 competitive rewards (estimates; servers can change them). */
export const REWARDS: EconomyRules = {
	maxMoney: 16000,
	lossBonusBase: 1400,
	lossBonusStep: 500,
	lossBonusMaxSteps: 4,
	winElimination: 3250,
	winTime: 3250,
	winBomb: 3500,
	winDefuse: 3500,
	plantedLossBonus: 800
};

/**
 * Wingman (`scrimcomp2v2`). Measured from a real capture (fixtures/real/wingman-inferno):
 * $8000 cap, loss bonus $2000 then +$300 per loss in a row (seen up to $3200), $2750 for an
 * elimination win. The bomb, defuse, time and planted-loss amounts were not seen and are
 * guesses (competitive minus $500, and the competitive planted bonus).
 */
export const WINGMAN_REWARDS: EconomyRules = {
	maxMoney: 8000,
	lossBonusBase: 2000,
	lossBonusStep: 300,
	lossBonusMaxSteps: 4,
	winElimination: 2750,
	winTime: 2750,
	winBomb: 3000,
	winDefuse: 3000,
	plantedLossBonus: 800
};

export function economyRules(mode: string | null | undefined): EconomyRules {
	return mode === 'scrimcomp2v2' ? WINGMAN_REWARDS : REWARDS;
}

/**
 * Loss bonus for the *next* loss, given the team's consecutive_round_losses now.
 * Competitive: 0 losses in a row -> $1400, 1 -> $1900, ... capped at $3400.
 */
export function nextLossBonus(consecutiveLosses: number, rules: EconomyRules = REWARDS): number {
	const steps = Math.max(0, Math.min(consecutiveLosses, rules.lossBonusMaxSteps));
	return rules.lossBonusBase + rules.lossBonusStep * steps;
}

export interface NextRoundEstimate {
	ifWin: number;
	ifLoss: number;
	ifLossPlanted: number | null;
}

/**
 * Money at the start of next round for a win or a loss, not counting kill rewards or what you
 * spend during the rest of this round. Estimate.
 */
export function estimateNextRoundMoney(
	money: number,
	consecutiveLosses: number,
	side: 'CT' | 'T' | null,
	rules: EconomyRules = REWARDS
): NextRoundEstimate {
	const cap = (n: number) => Math.min(rules.maxMoney, n);
	const loss = nextLossBonus(consecutiveLosses, rules);
	return {
		ifWin: cap(money + rules.winElimination),
		ifLoss: cap(money + loss),
		ifLossPlanted: side === 'T' ? cap(money + loss + rules.plantedLossBonus) : null
	};
}
