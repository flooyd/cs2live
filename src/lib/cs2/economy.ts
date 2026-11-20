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
 * - `full`:  equipment value >= $4000 (a rifle plus armour; also kept weapons from a saved round).
 * - `force`: equipment value >= $2000.
 * - `save`:  equipment value < $2000 although you could have afforded more (start money >= $3000):
 *   you deliberately did not buy.
 * - `eco`:   equipment value < $2000 and you started freeze time with less than $3000.
 */
export const BUY_THRESHOLDS = {
	pistolMaxMoney: 1000,
	full: 4000,
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

/** Standard CS2 competitive rewards (estimates; servers can change them). */
export const REWARDS = {
	maxMoney: 16000,
	lossBonusBase: 1400,
	lossBonusStep: 500,
	lossBonusMaxSteps: 4,
	winElimination: 3250,
	winTime: 3250,
	winBomb: 3500,
	winDefuse: 3500,
	/** Extra for each T when the bomb was planted but the round was lost. */
	plantedLossBonus: 800
} as const;

/**
 * Loss bonus for the *next* loss, given the team's consecutive_round_losses now.
 * 0 losses in a row -> $1400, 1 -> $1900, ... capped at $3400.
 */
export function nextLossBonus(consecutiveLosses: number): number {
	const steps = Math.max(0, Math.min(consecutiveLosses, REWARDS.lossBonusMaxSteps));
	return REWARDS.lossBonusBase + REWARDS.lossBonusStep * steps;
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
	side: 'CT' | 'T' | null
): NextRoundEstimate {
	const cap = (n: number) => Math.min(REWARDS.maxMoney, n);
	const loss = nextLossBonus(consecutiveLosses);
	return {
		ifWin: cap(money + REWARDS.winElimination),
		ifLoss: cap(money + loss),
		ifLossPlanted: side === 'T' ? cap(money + loss + REWARDS.plantedLossBonus) : null
	};
}
