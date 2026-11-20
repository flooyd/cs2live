import { describe, expect, it } from 'vitest';
import { buildRoundPips } from './round-pips.ts';
import { compactMoney, niceTicks } from './components/charts/scale.ts';
import type { Side } from './cs2/rounds.ts';

describe('buildRoundPips', () => {
	const wins = (n: number, reason = 'ct_win_elimination') =>
		Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), reason]));

	it('marks the half-time switch from the sides the recorder saw', () => {
		const sides = new Map<number, Side | null>();
		for (let r = 1; r <= 14; r++) sides.set(r, r <= 12 ? 'CT' : 'T');
		const pips = buildRoundPips('competitive', wins(14), sides);
		expect(pips).toHaveLength(14);
		expect(pips[0]).toMatchObject({ round: 1, winner: 'CT', mySide: 'CT', iWon: true });
		expect(pips[12]).toMatchObject({ round: 13, mySide: 'T', iWon: false, switchBefore: true });
		expect(pips.filter((p) => p.switchBefore).map((p) => p.round)).toEqual([13]);
	});

	it('falls back to the mode rule when sides are unknown (joined mid-match)', () => {
		const pips = buildRoundPips('scrimcomp2v2', wins(10), new Map());
		expect(pips.every((p) => p.iWon === null)).toBe(true);
		expect(pips.filter((p) => p.switchBefore).map((p) => p.round)).toEqual([9]);
	});

	it('flags overtime rounds and survives junk input', () => {
		const pips = buildRoundPips(
			'competitive',
			{ ...wins(25), x: 'nope', '0': 't_win_bomb' },
			new Map()
		);
		expect(pips.map((p) => p.round)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
		expect(pips[24]).toMatchObject({ overtime: true, switchBefore: true });
		expect(buildRoundPips(null, null, new Map())).toEqual([]);
	});
});

describe('chart scale helpers', () => {
	it('picks round ticks that cover the max', () => {
		expect(niceTicks(313)).toEqual([0, 100, 200, 300, 400]);
		expect(niceTicks(6550)).toEqual([0, 2000, 4000, 6000, 8000]);
		expect(niceTicks(1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
		expect(niceTicks(0)).toEqual([0, 1]);
		expect(niceTicks(Number.NaN)).toEqual([0, 1]);
	});

	it('formats money compactly', () => {
		expect(compactMoney(0)).toBe('$0');
		expect(compactMoney(800)).toBe('$800');
		expect(compactMoney(5000)).toBe('$5K');
		expect(compactMoney(12500)).toBe('$12.5K');
	});
});
