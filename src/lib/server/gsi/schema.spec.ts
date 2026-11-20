import { describe, expect, it } from 'vitest';
import { parsePayload } from './schema.ts';
import { stripAuth } from './recorder.ts';
import { authToken, tokenMatches } from './ingest.ts';

describe('parsePayload', () => {
	it('keeps good fields and drops bad ones instead of failing', () => {
		const p = parsePayload({
			provider: { steamid: 12345, version: '14100' },
			map: {
				name: 'de_mirage',
				phase: 'live',
				round: 'x',
				team_ct: { score: 5 },
				round_wins: { '1': 'ct_win_elimination', '2': 7 }
			},
			player: {
				state: { health: '100', helmet: 1, flashed: null },
				weapons: { weapon_0: 'bad', weapon_1: { name: 'weapon_ak47' } }
			},
			phase_countdowns: { phase: 'live', phase_ends_in: '84.3' },
			somethingNew: { kept: true }
		});
		expect(p).not.toBeNull();
		expect(p!.map?.round).toBeUndefined();
		expect(p!.map?.team_ct?.score).toBe(5);
		expect(p!.map?.round_wins).toEqual({ '1': 'ct_win_elimination' });
		expect(p!.player?.state?.health).toBe(100);
		expect(p!.player?.state?.helmet).toBe(true);
		expect(p!.player?.state?.flashed).toBeUndefined();
		expect(Object.keys(p!.player?.weapons ?? {})).toEqual(['weapon_1']);
		expect(p!.phase_countdowns?.phase_ends_in).toBeCloseTo(84.3);
		expect((p as Record<string, unknown>).somethingNew).toEqual({ kept: true });
	});

	it('keeps Steam IDs as strings', () => {
		expect(parsePayload({ provider: { steamid: '76561198012345678' } })!.provider?.steamid).toBe(
			'76561198012345678'
		);
	});

	it('returns null only for non-objects', () => {
		expect(parsePayload(null)).toBeNull();
		expect(parsePayload([1])).toBeNull();
		expect(parsePayload('x')).toBeNull();
		expect(parsePayload({ map: 'nope' })).toEqual({ map: undefined });
	});
});

describe('auth', () => {
	it('compares tokens exactly and strips them from captures', () => {
		const raw = { auth: { token: 'abc' }, provider: {} };
		expect(tokenMatches('abc', authToken(raw))).toBe(true);
		expect(tokenMatches('abd', authToken(raw))).toBe(false);
		expect(tokenMatches(null, authToken(raw))).toBe(false);
		expect(tokenMatches('abc', authToken({}))).toBe(false);
		expect(stripAuth(raw)).toEqual({ provider: {} });
	});
});
