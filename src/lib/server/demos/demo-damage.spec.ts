import { describe, expect, it } from 'vitest';
import { damageByRound, type HurtEvent } from './demo-damage.ts';

const ME = '76561202255165828';
const MATE = '76561202255165829';
const [A, B, D, E] = [
	'76561202255165901',
	'76561202255165902',
	'76561202255165903',
	'76561202255165904'
];
const T = 2;
const CT = 3;

const hit = (
	tick: number,
	attacker: string,
	victim: string,
	dmg: number,
	health: number,
	teams: [number, number] = [T, CT]
): HurtEvent => ({
	tick,
	attacker_steamid: attacker,
	user_steamid: victim,
	attacker_team_num: teams[0],
	user_team_num: teams[1],
	dmg_health: dmg,
	health
});

describe('damageByRound', () => {
	const freezeEnds = [
		{ tick: 10, total_rounds_played: 0, is_warmup_period: true },
		{ tick: 100, total_rounds_played: 0, is_warmup_period: false },
		{ tick: 1000, total_rounds_played: 1, is_warmup_period: false },
		{ tick: 2000, total_rounds_played: 2, is_warmup_period: false }
	];

	it('counts enemy damage per round, capped at the health the victim had', () => {
		const hurt: HurtEvent[] = [
			{ ...hit(20, ME, A, 50, 50), is_warmup_period: true },
			hit(150, ME, A, 173, 0), // AWP: counts 100
			hit(200, ME, B, 60, 40),
			hit(210, ME, B, 60, 0), // only 40 left
			hit(300, MATE, D, 70, 30),
			hit(310, ME, D, 50, 0), // a teammate did 70 first
			hit(400, ME, MATE, 20, 80, [T, T]), // team damage
			hit(410, ME, ME, 10, 90, [T, T]), // own grenade
			hit(900, ME, E, 30, 70), // after the round was decided, before the next: round 1
			hit(1100, ME, A, 50, 50) // new round, full health again
		];
		const { damage, rounds } = damageByRound(ME, hurt, freezeEnds);
		expect(rounds).toBe(3);
		expect([...damage]).toEqual([
			[1, 100 + 60 + 40 + 30 + 30],
			[2, 50],
			[3, 0]
		]);
	});

	it('ignores hits before the first round and counts hits without team info', () => {
		const hurt: HurtEvent[] = [
			hit(50, ME, A, 40, 60),
			{ tick: 150, attacker_steamid: ME, user_steamid: A, dmg_health: 25, health: 75 }
		];
		expect(damageByRound(ME, hurt, freezeEnds).damage.get(1)).toBe(25);
	});

	it('handles a demo without rounds', () => {
		expect(damageByRound(ME, [hit(150, ME, A, 30, 70)], [])).toEqual({
			damage: new Map(),
			rounds: 0
		});
	});
});
