import { describe, expect, it } from 'vitest';
import { loadFixture, runFrames } from './testing.ts';
import { MatchTracker } from './match-tracker.ts';
import { parsePayload } from './schema.ts';
import { SIM_ME, SIM_TEAMMATES, simulateMatch, type Frame } from './sim/simulate.ts';
import { matchRecordSchema, type MatchRecord } from '#lib/match-record.ts';
import { roundWinsList } from '#lib/cs2/rounds.ts';
import { fakeSteamId } from '#lib/cs2/steamid.ts';

const me = SIM_ME.steamId;

function only(records: MatchRecord[]): MatchRecord {
	expect(records).toHaveLength(1);
	return records[0];
}

/** What the simulator says happened: final score from round_wins in the last in-match frame. */
function finalRoundWins(frames: Frame[]): Record<string, string> {
	const last = [...frames].reverse().find((f) => (f.p as { map?: unknown }).map);
	return (last!.p as { map: { round_wins: Record<string, string> } }).map.round_wins;
}

describe('full match', () => {
	const frames = loadFixture('synthetic/full-match');
	const { records, events } = runFrames(frames, { steamId: me });
	const r = only(records);

	it('saves exactly one complete match with every round', () => {
		expect(r.status).toBe('complete');
		expect(r.result).not.toBe('incomplete');
		expect(r.joinedMidMatch).toBe(false);
		expect(r.firstRound).toBe(1);
		const wins = roundWinsList(finalRoundWins(frames));
		expect(r.roundsPlayed).toBe(wins.length);
		expect(r.rounds.map((x) => x.number)).toEqual(wins.map((w) => w.round));
		expect(events.filter((e) => e.type === 'match_started')).toHaveLength(1);
	});

	it('produces a record the upload schema accepts', () => {
		expect(matchRecordSchema.safeParse(r).success).toBe(true);
	});

	it('takes winners and reasons from round_wins', () => {
		const wins = finalRoundWins(frames);
		for (const round of r.rounds) {
			expect(round.winReason).toBe(wins[String(round.number)]);
			expect(round.iWon).toBe(round.winnerSide === round.mySide);
		}
		const mine = r.rounds.filter((x) => x.iWon).length;
		expect(r.scoreMine).toBe(mine);
		expect(r.scoreTheirs).toBe(r.rounds.length - mine);
		expect(r.result).toBe(r.scoreMine > r.scoreTheirs ? 'win' : 'loss');
	});

	it('switches sides at halftime and marks both pistol rounds', () => {
		expect(r.mySideStart).toBe('CT');
		expect(r.rounds.slice(0, 12).every((x) => x.mySide === 'CT')).toBe(true);
		expect(r.rounds.slice(12, 24).every((x) => x.mySide === 'T')).toBe(true);
		expect(r.rounds[0].buyType).toBe('pistol');
		expect(r.rounds[12]?.buyType).toBe('pistol');
		expect(r.rounds.filter((x) => x.buyType === 'pistol')).toHaveLength(2);
	});

	it('records buy snapshots at the end of freeze time', () => {
		for (const round of r.rounds) {
			expect(round.moneyFreezeStart).not.toBeNull();
			expect(round.equipValue).not.toBeNull();
			expect(round.weaponsFreezeEnd.length).toBeGreaterThan(0);
			expect(round.partial).toBe(false);
		}
		expect(r.rounds[0].moneyFreezeStart).toBe(800);
	});

	it('sums round kills into the match and keeps the inferred kill events consistent', () => {
		const roundKills = r.rounds.reduce((n, x) => n + x.kills, 0);
		expect(r.kills).toBe(roundKills);
		expect(r.killEvents).toHaveLength(roundKills);
		expect(r.killEvents.filter((k) => k.headshot)).toHaveLength(r.hsKills);
		expect(r.damage).toBe(r.rounds.reduce((n, x) => n + x.damage, 0));
		expect(r.adr).toBeCloseTo(r.damage / r.roundsPlayed, 1);
	});

	it('matches the deaths in match_stats with rounds not survived', () => {
		expect(r.rounds.filter((x) => x.survived === false)).toHaveLength(r.deaths);
	});
});

describe('duplicate gameover', () => {
	it('never closes the same match twice', () => {
		const frames = loadFixture('synthetic/full-match');
		const gameover = frames.filter(
			(f) => (f.p as { map?: { phase?: string } }).map?.phase === 'gameover'
		);
		expect(gameover.length).toBeGreaterThan(1);
		const last = frames.at(-1)!;
		// Replay the gameover payloads again later, as CS2 does on the scoreboard.
		const extra = gameover.map((f, i) => ({ t: last.t + 1000 * (i + 1), p: f.p }));
		const { records } = runFrames([...frames, ...extra], { steamId: me });
		expect(records).toHaveLength(1);
	});
});

describe('mid-match join', () => {
	const frames = loadFixture('synthetic/mid-match-join');
	const r = only(runFrames(frames, { steamId: me }).records);

	it('starts at the round we joined and flags the match', () => {
		expect(r.joinedMidMatch).toBe(true);
		expect(r.firstRound).toBe(8);
		expect(r.rounds[0].number).toBe(8);
		expect(r.status).toBe('complete');
	});

	it('keeps round_wins for the rounds before the join', () => {
		expect(Object.keys(r.roundWins)).toContain('1');
		expect(r.roundWins['7']).toBeTruthy();
	});
});

describe('quit before gameover', () => {
	const frames = loadFixture('synthetic/quit-before-gameover');
	const { records } = runFrames(frames, { steamId: me });
	const r = only(records);

	it('saves the match as incomplete after the timeout', () => {
		expect(r.status).toBe('incomplete');
		expect(r.result).toBe('incomplete');
		expect(r.roundsPlayed).toBe(9);
	});

	it('does not save before the timeout', () => {
		const t = new MatchTracker({ steamId: me, incompleteTimeoutMs: 120_000 });
		for (const f of frames) t.ingest(parsePayload(f.p)!, f.t);
		expect(t.tick(frames.at(-1)!.t + 30_000)).toHaveLength(0);
		expect(t.tick(frames.at(-1)!.t + 200_000).some((e) => e.type === 'match_ended')).toBe(true);
	});
});

describe('reconnect', () => {
	const frames = loadFixture('synthetic/reconnect');
	const { records, events } = runFrames(frames, { steamId: me });

	it('saves an incomplete match during the gap, then resumes and completes it under the same id', () => {
		expect(records).toHaveLength(2);
		const [first, second] = records;
		expect(first.status).toBe('incomplete');
		expect(first.roundsPlayed).toBe(6);
		expect(second.status).toBe('complete');
		expect(second.id).toBe(first.id);
		expect(second.rounds[0].number).toBe(1);
		expect(events.filter((e) => e.type === 'match_started' && e.resumed)).toHaveLength(1);
	});
});

describe('death and spectating', () => {
	const frames = loadFixture('synthetic/death-spectate');
	const r = only(runFrames(frames, { steamId: me }).records);

	it('never attributes a spectated teammate’s stats to me', () => {
		const roundKills = r.rounds.reduce((n, x) => n + x.kills, 0);
		expect(r.kills).toBe(roundKills);
		expect(r.rounds.every((x) => x.survived === false)).toBe(true);
		expect(r.deaths).toBe(r.roundsPlayed);
	});

	it('records the teammates I spectated as partial sightings', () => {
		const ids = SIM_TEAMMATES.map((m) => m.steamId);
		expect(r.sightings.length).toBeGreaterThan(0);
		for (const s of r.sightings) {
			expect(ids).toContain(s.steamId);
			expect(s.teammate).toBe(true);
			expect(s.kills).not.toBeNull();
		}
		expect(r.sightings.map((s) => s.steamId)).not.toContain(me);
	});
});

describe('overtime', () => {
	const frames = loadFixture('synthetic/overtime');
	const r = only(runFrames(frames, { steamId: me }).records);

	it('tracks every round past regulation', () => {
		expect(r.roundsPlayed).toBeGreaterThan(24);
		expect(r.status).toBe('complete');
		expect(r.rounds.map((x) => x.number)).toEqual(
			Array.from({ length: r.roundsPlayed }, (_, i) => i + 1)
		);
		// Overtime starts with $12,500: never a pistol round.
		expect(r.rounds.slice(24).some((x) => x.buyType === 'pistol')).toBe(false);
	});
});

describe('wingman', () => {
	it('handles 8-round halves', () => {
		const r = only(runFrames(loadFixture('synthetic/wingman'), { steamId: me }).records);
		expect(r.mode).toBe('scrimcomp2v2');
		expect(r.rounds[8]?.buyType).toBe('pistol');
		expect(r.rounds[8]?.mySide).not.toBe(r.rounds[7].mySide);
	});
});

// A real CS2 capture (anonymised): Wingman on Inferno, lost 5:9 starting as T. The recorder
// died early in most rounds, often inside the buy window, and the match ended on a round that
// never reached round.phase "over": gameover arrived with round.phase "freezetime".
describe('real capture: wingman', () => {
	const frames = loadFixture('real/wingman-inferno');
	const recorder = fakeSteamId(100);
	const r = only(runFrames(frames, { steamId: recorder }).records);
	const round = (n: number) => r.rounds.find((x) => x.number === n)!;

	it('saves the match with exactly the 14 rounds that were played', () => {
		expect(r.status).toBe('complete');
		expect(r.mode).toBe('scrimcomp2v2');
		expect([r.scoreMine, r.scoreTheirs, r.result]).toEqual([5, 9, 'loss']);
		expect(r.mySideStart).toBe('T');
		expect(r.rounds.map((x) => x.number)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
		expect(r.roundsPlayed).toBe(14);
		expect(r.rounds.every((x) => x.winReason !== null)).toBe(true);
	});

	it('keeps the last round, which went straight to gameover', () => {
		expect(round(14)).toMatchObject({
			mySide: 'CT',
			winnerSide: 'T',
			iWon: false,
			survived: false
		});
		expect(round(14).equipValue).not.toBeNull();
	});

	it('keeps the loadout when you die inside the buy window', () => {
		for (const x of r.rounds)
			expect(x.weaponsFreezeEnd.length, `round ${x.number}`).toBeGreaterThan(0);
		expect(round(3).primaryWeapon).toBe('weapon_ak47');
		expect(round(3).equipValue).toBe(4100);
	});

	it('leaves kill rewards out of the after-buy money', () => {
		// Pistol round: $800, no purchase, a kill 10 s into the round paid $300.
		expect(round(9).moneyFreezeEnd).toBe(800);
	});

	it('matches match_stats', () => {
		expect([r.kills, r.assists, r.deaths]).toEqual([8, 1, 11]);
		expect(r.rounds.reduce((n, x) => n + x.kills, 0)).toBe(8);
		expect(r.rounds.filter((x) => x.survived === false)).toHaveLength(11);
	});
});

describe('accounts and observers', () => {
	const frames = simulateMatch({ seed: 2, quitAfterRound: 3 });

	it('ignores everything until a Steam ID is set', () => {
		const { records, events } = runFrames(frames, { steamId: '' });
		expect(records).toHaveLength(0);
		expect(events.some((e) => e.type === 'ignored' && e.reason === 'no_steam_id')).toBe(true);
	});

	it('ignores payloads from another Steam account', () => {
		const { records, events } = runFrames(frames, { steamId: '76561198000000001' });
		expect(records).toHaveLength(0);
		expect(events.every((e) => e.type === 'ignored' && e.reason === 'other_account')).toBe(true);
	});

	it('ignores observer payloads (allplayers present)', () => {
		const observed = frames.map((f) => ({
			t: f.t,
			p: {
				...(f.p as object),
				allplayers: { [SIM_TEAMMATES[0].steamId]: { name: 'x', team: 'CT' } }
			}
		}));
		const { records } = runFrames(observed, { steamId: me });
		expect(records).toHaveLength(0);
	});

	it('discards a match that ends before any round finished', () => {
		const t = new MatchTracker({ steamId: me, incompleteTimeoutMs: 120_000 });
		const live = frames.find((f) => (f.p as { map?: { phase?: string } }).map?.phase === 'live')!;
		t.ingest(parsePayload(live.p)!, live.t);
		const events = t.tick(live.t + 500_000);
		expect(events.map((e) => e.type)).toEqual(['match_discarded']);
	});
});

describe('malformed payloads', () => {
	it('never throws, whatever arrives', () => {
		const t = new MatchTracker({ steamId: me, incompleteTimeoutMs: 120_000 });
		const junk: unknown[] = [
			{},
			{ provider: { steamid: me } },
			{ provider: { steamid: me }, map: { name: 'de_x', phase: 'live', team_ct: 'nope' } },
			{ provider: { steamid: me }, map: { name: 'de_x', phase: 'live' }, round: { phase: 42 } },
			{
				provider: { steamid: me },
				map: { name: 'de_x', phase: 'live' },
				player: { steamid: me, state: { health: 'lots' } }
			},
			{
				provider: { steamid: me },
				map: { name: 'de_x', phase: 'gameover', round_wins: { a: 1, 2: null } }
			}
		];
		for (const [i, j] of junk.entries()) {
			const p = parsePayload(j);
			expect(p).not.toBeNull();
			expect(() => t.ingest(p!, 1000 * i)).not.toThrow();
		}
		expect(() => t.tick(1e9)).not.toThrow();
	});
});
