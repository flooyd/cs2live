import { describe, expect, it } from 'vitest';
import { fakeSteamId, isFakeSteamId, isSteamId64, parseSteamId } from './steamid.ts';
import {
	classifyBuy,
	economyRules,
	estimateNextRoundMoney,
	nextLossBonus,
	REWARDS
} from './economy.ts';
import { mapLabel, isOvertimeRound } from './modes.ts';
import { parseWinReason, roundWinsList } from './rounds.ts';
import { weaponLabel } from './weapons.ts';

describe('parseSteamId', () => {
	const id = '76561198012345678';

	it.each([
		[id, id],
		[` ${id} `, id],
		[`https://steamcommunity.com/profiles/${id}/`, id],
		['steamcommunity.com/profiles/76561198012345678?l=english', id],
		['[U:1:52079950]', '76561198012345678'],
		['U:1:52079950', '76561198012345678'],
		['STEAM_0:0:26039975', '76561198012345678'],
		['STEAM_1:0:26039975', '76561198012345678'],
		['52079950', '76561198012345678']
	])('%s', (input, expected) => {
		expect(parseSteamId(input)).toEqual({ ok: true, steamId: expected });
	});

	it('explains vanity URLs and rejects junk', () => {
		expect(parseSteamId('https://steamcommunity.com/id/gaben')).toEqual({
			ok: false,
			reason: 'vanity',
			vanity: 'gaben'
		});
		expect(parseSteamId('')).toMatchObject({ ok: false, reason: 'empty' });
		expect(parseSteamId('hello')).toMatchObject({ ok: false, reason: 'invalid' });
		expect(parseSteamId('76561190000000000')).toMatchObject({ ok: false });
	});

	it('keeps fake IDs valid and recognisable', () => {
		expect(isSteamId64(fakeSteamId(1))).toBe(true);
		expect(isFakeSteamId(fakeSteamId(1))).toBe(true);
		expect(isFakeSteamId(id)).toBe(false);
	});
});

describe('economy', () => {
	it('classifies buys with the documented thresholds', () => {
		expect(classifyBuy({ equipValue: 850, moneyFreezeStart: 800, halfStart: true })).toBe('pistol');
		// An overtime half start has plenty of money: not a pistol round.
		expect(classifyBuy({ equipValue: 5200, moneyFreezeStart: 12500, halfStart: true })).toBe(
			'full'
		);
		expect(classifyBuy({ equipValue: 4000, moneyFreezeStart: 5000, halfStart: false })).toBe(
			'full'
		);
		expect(classifyBuy({ equipValue: 2700, moneyFreezeStart: 3000, halfStart: false })).toBe(
			'force'
		);
		expect(classifyBuy({ equipValue: 500, moneyFreezeStart: 1900, halfStart: false })).toBe('eco');
		expect(classifyBuy({ equipValue: 500, moneyFreezeStart: 3500, halfStart: false })).toBe('save');
		expect(classifyBuy({ equipValue: null, moneyFreezeStart: null, halfStart: false })).toBeNull();
	});

	it('steps the loss bonus and caps it', () => {
		expect([0, 1, 2, 3, 4, 5].map((n) => nextLossBonus(n))).toEqual([
			1400, 1900, 2400, 2900, 3400, 3400
		]);
	});

	it('estimates next-round money', () => {
		expect(estimateNextRoundMoney(2000, 1, 'T')).toEqual({
			ifWin: 5250,
			ifLoss: 3900,
			ifLossPlanted: 4700
		});
		expect(estimateNextRoundMoney(15000, 0, 'CT')).toEqual({
			ifWin: 16000,
			ifLoss: 16000,
			ifLossPlanted: null
		});
	});

	it('uses Wingman money as seen in a real match', () => {
		const wingman = economyRules('scrimcomp2v2');
		expect(economyRules('competitive')).toBe(REWARDS);
		// Five losses in a row paid +2000, +2300, +2600, +2900, +3200.
		expect([0, 1, 2, 3, 4].map((n) => nextLossBonus(n, wingman))).toEqual([
			2000, 2300, 2600, 2900, 3200
		]);
		// $1100 + an elimination win was $3850; $5950 + a win hit the $8000 cap.
		expect(estimateNextRoundMoney(1100, 1, 'CT', wingman).ifWin).toBe(3850);
		expect(estimateNextRoundMoney(5950, 0, 'T', wingman).ifWin).toBe(8000);
	});
});

describe('labels', () => {
	it('names maps and weapons', () => {
		expect(mapLabel('de_mirage')).toBe('Mirage');
		expect(mapLabel('workshop/123/de_cache_b')).toBe('Cache B');
		expect(weaponLabel('weapon_m4a1_silencer')).toBe('M4A1-S');
		expect(weaponLabel('weapon_knife_karambit')).toBe('Knife');
		expect(weaponLabel(undefined)).toBe('—');
	});

	it('parses round win reasons', () => {
		expect(parseWinReason('ct_win_defuse')).toEqual({ side: 'CT', kind: 'defuse' });
		expect(parseWinReason('t_win_bomb')).toEqual({ side: 'T', kind: 'bomb' });
		expect(parseWinReason('ct_win_time')).toEqual({ side: 'CT', kind: 'time' });
		expect(parseWinReason('weird')).toEqual({ side: null, kind: 'other' });
		expect(
			roundWinsList({ '10': 'ct_win_time', '2': 't_win_elimination', x: 'y' }).map((r) => r.round)
		).toEqual([2, 10]);
	});

	it('knows overtime', () => {
		expect(isOvertimeRound('competitive', 24)).toBe(false);
		expect(isOvertimeRound('competitive', 25)).toBe(true);
		expect(isOvertimeRound('casual', 40)).toBe(false);
	});
});
