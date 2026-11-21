import { describe, expect, it } from 'vitest';
import { matchRecordSchema } from '#lib/match-record.ts';
import { demoMode, demoRecordId, gsiWinReason, matchFromDemo, TICK_RATE } from './demo-record.ts';
import { inventoryWeapons, killWeapon } from './demo-weapons.ts';
import { DEMO_MATE, DEMO_ME, syntheticDemo } from './testing.ts';

const MATCH_TIME = Date.UTC(2026, 10, 16, 22, 0, 0);
const opts = {
	steamId: DEMO_ME,
	gcMatchId: '3854495737400262779',
	matchTime: MATCH_TIME,
	appVersion: 't'
};

describe('matchFromDemo', () => {
	const record = matchFromDemo(syntheticDemo(), opts)!;

	it('builds a valid, complete match marked as imported from the demo', () => {
		expect(matchRecordSchema.parse(record)).toEqual(record);
		expect(record).toMatchObject({
			id: demoRecordId(opts.gcMatchId, DEMO_ME),
			recorderSteamId: DEMO_ME,
			recorderName: 'Me',
			map: 'de_inferno',
			mode: 'scrimcomp2v2',
			status: 'complete',
			result: 'win',
			scoreMine: 2,
			scoreTheirs: 0,
			mySideStart: 'T',
			firstRound: 1,
			joinedMidMatch: false,
			roundsPlayed: 2,
			origin: 'demo',
			gsiVersion: null,
			// The scoreboard's totals, like GSI's match_stats.
			kills: 1,
			assists: 1,
			deaths: 1,
			mvps: 1,
			score: 7,
			hsKills: 1,
			// 150 damage on a 100 HP player counts 100.
			damage: 100,
			damageSource: 'demo',
			adr: 50,
			hsPct: 100,
			roundWins: { '1': 't_win_elimination', '2': 'ct_win_defuse' }
		});
		// Tick 0 is Steam's match time; round 1 starts at the match start (tick 100).
		expect(record.startedAt).toBe(new Date(MATCH_TIME + (100 * 1000) / TICK_RATE).toISOString());
		expect(record.endedAt).toBe(new Date(MATCH_TIME + (3800 * 1000) / TICK_RATE).toISOString());
	});

	it('reads each round like the live tracker does', () => {
		const pick = (k: keyof (typeof record.rounds)[number]) => record.rounds.map((r) => r[k]);
		expect(pick('number')).toEqual([1, 2]);
		expect(pick('mySide')).toEqual(['T', 'CT']);
		expect(pick('iWon')).toEqual([true, true]);
		// The plant after round 1 was decided doesn't count.
		expect(pick('bomb')).toEqual([null, 'defused']);
		// Warmup kill and team kill left out.
		expect(pick('kills')).toEqual([1, 0]);
		expect(pick('hsKills')).toEqual([1, 0]);
		expect(pick('assists')).toEqual([1, 0]);
		expect(pick('damage')).toEqual([100, 0]);
		expect(pick('survived')).toEqual([true, false]);
		expect(pick('healthEnd')).toEqual([64, 0]);
		expect(pick('moneyFreezeStart')).toEqual([800, 800]);
		// Buy read just before your first kill (round 1) or death (round 2).
		expect(pick('moneyFreezeEnd')).toEqual([150, 50]);
		expect(pick('equipValue')).toEqual([850, 950]);
		// Money at your death, or when the round closed if you survived.
		expect(pick('moneyEnd')).toEqual([150, 50]);
		// Round 1 and the side switch with $800 are pistol rounds.
		expect(pick('buyType')).toEqual(['pistol', 'pistol']);
		expect(pick('mvp')).toEqual([true, false]);
		// Rounded to 0.1 s, like the tracker.
		expect(pick('durationS')).toEqual([12.5, 13.1]);
		expect(record.rounds[0].weaponsFreezeEnd).toEqual([
			{ name: 'weapon_knife_t', type: 'Knife', count: null },
			{ name: 'weapon_glock', type: 'Pistol', count: null },
			{ name: 'weapon_flashbang', type: 'Grenade', count: 2 },
			{ name: 'weapon_hegrenade', type: 'Grenade', count: 1 }
		]);
		expect(record.killEvents).toEqual([
			{
				round: 1,
				at: new Date(MATCH_TIME + (1100 * 1000) / TICK_RATE).toISOString(),
				weapon: 'weapon_ak47',
				headshot: true
			}
		]);
	});

	it('keeps teammates (not opponents or bots) with their final scoreboard', () => {
		expect(record.sightings).toEqual([
			{
				steamId: DEMO_MATE,
				name: 'Mate',
				side: 'CT',
				teammate: true,
				kills: 1,
				assists: 0,
				deaths: 1,
				mvps: 0,
				score: 3,
				firstRound: 1,
				lastRound: 2,
				lastSeenAt: record.endedAt
			}
		]);
	});

	it('is incomplete without the end of the match, and null without you', () => {
		const cut = { ...syntheticDemo(), matchEnds: [] };
		expect(matchFromDemo(cut, opts)).toMatchObject({ status: 'incomplete', result: 'incomplete' });
		expect(matchFromDemo(syntheticDemo(), { ...opts, steamId: '76561197960265999' })).toBeNull();
	});

	it('gives the same match the same id, and different players different ids', () => {
		expect(demoRecordId('1', DEMO_ME)).toBe(demoRecordId('1', DEMO_ME));
		expect(demoRecordId('1', DEMO_ME)).not.toBe(demoRecordId('1', DEMO_MATE));
		expect(demoRecordId('1', DEMO_ME)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab]/);
	});
});

describe('demo names', () => {
	it('maps round end reasons, modes and weapons to what GSI uses', () => {
		expect(gsiWinReason('t_killed', 'CT')).toBe('ct_win_elimination');
		expect(gsiWinReason('bomb_exploded', 'T')).toBe('t_win_bomb');
		expect(gsiWinReason(12, 'CT')).toBe('ct_win_time');
		expect(gsiWinReason('something_new', 'T')).toBe('t_win_something_new');
		expect(demoMode({ rankTypeIds: [11], cvars: {} }, 10)).toBe('premier');
		expect(demoMode({ rankTypeIds: [12], cvars: {} }, 10)).toBe('competitive');
		expect(demoMode({ rankTypeIds: [], cvars: {} }, 4)).toBe('scrimcomp2v2');
		expect(killWeapon('inferno', 'CT')).toBe('weapon_incgrenade');
		expect(killWeapon('knife_butterfly', 'T')).toBe('weapon_knife');
		expect(inventoryWeapons(['Butterfly Knife', 'M4A4', 'Zeus x27'])).toEqual([
			{ name: 'weapon_knife', type: 'Knife', count: null },
			{ name: 'weapon_m4a1', type: 'Rifle', count: null },
			{ name: 'weapon_taser', type: null, count: null }
		]);
	});
});
