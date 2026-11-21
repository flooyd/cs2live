import { describe, expect, it } from 'vitest';
import { loadFixture, runFrames } from '../gsi/testing.ts';
import { fakeSteamId } from '#lib/cs2/steamid.ts';
import type { GcMatch } from './gc-match-list.ts';
import { accountIdOf, findGcMatch, wantsDemoDamage, withDemoDamage } from './match-demo.ts';

const ME = fakeSteamId(100);
const real = runFrames(loadFixture('real/wingman-inferno'), { steamId: ME }).records[0];
const start = Date.parse(real.startedAt);
const MIN = 60_000;

const gc = (over: Partial<GcMatch>): GcMatch => ({
	matchId: '1',
	matchTime: start - 5 * MIN,
	accountIds: [accountIdOf(ME), 123],
	teamScores: [9, 5],
	demoUrl: 'http://replay1.valve.net/730/x.dem.bz2',
	durationS: 800,
	...over
});

describe('wantsDemoDamage', () => {
	it('wants official matches without damage', () => {
		expect(real.mode).toBe('scrimcomp2v2');
		expect(wantsDemoDamage(real)).toBe(true);
		expect(wantsDemoDamage({ ...real, mode: 'casual' })).toBe(false);
		expect(wantsDemoDamage({ ...real, damage: 1200 })).toBe(false);
	});
});

describe('findGcMatch', () => {
	it('picks the match you played in, around the start time, preferring the same score', () => {
		const matches = [
			gc({ matchId: 'not-me', accountIds: [1, 2] }),
			gc({ matchId: 'too-early', matchTime: start - 3 * 60 * MIN }),
			gc({ matchId: 'after-end', matchTime: Date.parse(real.endedAt) + MIN }),
			gc({ matchId: 'close-other-score', matchTime: start - MIN, teamScores: [9, 7] }),
			gc({ matchId: 'same-score', matchTime: start - 20 * MIN, teamScores: [9, 5] })
		];
		expect(real.scoreMine).toBe(5);
		expect(findGcMatch(real, matches)?.matchId).toBe('same-score');
	});

	it('falls back to the closest start, and to nothing', () => {
		const matches = [
			gc({ matchId: 'earlier', matchTime: start - 50 * MIN, teamScores: [] }),
			gc({ matchId: 'closer', matchTime: start - 2 * MIN, teamScores: [] })
		];
		expect(findGcMatch(real, matches)?.matchId).toBe('closer');
		expect(findGcMatch(real, [gc({ accountIds: [] })])).toBeNull();
	});
});

describe('withDemoDamage', () => {
	it('fills in rounds, totals and ADR, and marks the source', () => {
		const damage = new Map(real.rounds.slice(0, -1).map((r) => [r.number, 50 + r.number]));
		damage.set(99, 1000); // a round we did not record is ignored
		const out = withDemoDamage(real, damage);
		const total = real.rounds.slice(0, -1).reduce((n, r) => n + 50 + r.number, 0);
		expect(out.rounds.at(-1)?.damage).toBeNull();
		expect(out.rounds[0].damage).toBe(51);
		expect(out.damage).toBe(total);
		expect(out.adr).toBe(Math.round((total / (real.rounds.length - 1)) * 100) / 100);
		expect(out.damageSource).toBe('demo');
		expect(out.kd).toBe(real.kd);
	});

	it('keeps damage unknown when the demo has none of the rounds', () => {
		const out = withDemoDamage(real, new Map([[99, 10]]));
		expect(out).toMatchObject({ damage: null, adr: null, damageSource: null });
	});
});
