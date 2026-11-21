import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LiveRuntime, NULL_SINK } from './runtime.ts';
import { SettingsFile } from './settings.ts';
import { ingest } from '../gsi/ingest.ts';
import { loadFixture } from '../gsi/testing.ts';
import { SIM_ME } from '../gsi/sim/simulate.ts';
import type { LiveView } from '#lib/live/types.ts';
import type { MatchRecord } from '#lib/match-record.ts';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'cs2live-rt-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeRuntime(steamId: string | null = SIM_ME.steamId) {
	const settings = new SettingsFile(dir, { steamId: null, siteUrl: null, uploadKey: null });
	if (steamId) settings.save({ steamId });
	const saved: MatchRecord[] = [];
	const rt = new LiveRuntime({
		settings,
		gsiToken: 'test',
		capture: false,
		captureDir: join(dir, 'captures'),
		incompleteTimeoutMs: 120_000,
		appVersion: 'test',
		sink: { ...NULL_SINK, enqueue: (r) => saved.push(r) }
	});
	return { rt, saved };
}

/** Feeds a fixture through ingest() and collects a view after every payload. */
function play(rt: LiveRuntime, fixture: string) {
	const views: LiveView[] = [];
	for (const f of loadFixture(fixture)) {
		expect(ingest(rt, f.p, f.t)).toEqual({ ok: true });
		views.push(rt.view(f.t));
	}
	return views;
}

describe('live runtime', () => {
	it('builds a view for every payload of a full match and saves it once', () => {
		const { rt, saved } = makeRuntime();
		const views = play(rt, 'synthetic/full-match');

		expect(saved).toHaveLength(1);
		expect(saved[0].status).toBe('complete');

		const live = views.filter((v) => v.inGame && v.map?.phase === 'live');
		expect(live.length).toBeGreaterThan(50);
		for (const v of live) {
			const played = v.map!.ct.score + v.map!.t.score;
			// During "round over" the score already counts the round `map.round` names.
			expect([v.map!.round - 1, v.map!.round]).toContain(played);
			expect(v.history.length).toBe(played);
			expect(v.setup.accountMismatch).toBe(false);
		}

		expect(views.some((v) => v.map?.phase === 'gameover')).toBe(true);
		// The fixture ends back in the main menu.
		const last = views.at(-1)!;
		expect(last.inGame).toBe(false);
		expect(last.map).toBeNull();
		expect(last.tracking.lastSavedMatchId).toBe(saved[0].id);
		expect(last.recentRounds[0].number).toBe(saved[0].roundsPlayed);
		expect(last.recentRounds.length).toBe(Math.min(12, saved[0].roundsPlayed));
	});

	it('tracks net worth per round, with the round in progress last', () => {
		const { rt, saved } = makeRuntime();
		const views = play(rt, 'synthetic/full-match');

		for (const v of views) {
			const rounds = v.netWorth.map((p) => p.round);
			expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
			expect(new Set(rounds).size).toBe(rounds.length);
			expect(v.netWorth.filter((p) => p.current).length).toBeLessThanOrEqual(1);
			expect(v.netWorth.slice(0, -1).every((p) => !p.current)).toBe(true);
			for (const p of v.netWorth) expect(p.total).toBe(p.money + p.equipValue);
		}

		// Once you've bought in a round, the chart has a point for it.
		const buying = views.filter((v) => v.map?.phase === 'live' && v.round?.phase === 'live');
		expect(buying.length).toBeGreaterThan(0);
		for (const v of buying) expect(v.netWorth.at(-1)!.round).toBe(v.map!.round);

		// After the match: every round, none still in progress, results filled in.
		const last = views.at(-1)!;
		expect(last.netWorth).toHaveLength(saved[0].roundsPlayed);
		expect(last.netWorth.some((p) => p.current)).toBe(false);
		expect(last.netWorth.every((p) => p.iWon !== null)).toBe(true);
		const r1 = saved[0].rounds.find((r) => r.number === 1)!;
		expect(last.netWorth[0].total).toBe(r1.moneyFreezeEnd! + r1.equipValue!);
	});

	it('only estimates the round timer after seeing a phase change', () => {
		const { rt } = makeRuntime();
		const views = play(rt, 'synthetic/full-match');
		const withTimer = views.filter((v) => v.timer);
		expect(withTimer.length).toBeGreaterThan(0);
		// The fixture has no phase_countdowns, so every timer is an estimate.
		expect(withTimer.every((v) => v.timer!.estimated)).toBe(true);
		// The very first payload's phase was not seen starting, so no timer for it.
		expect(views[0].timer).toBeNull();
	});

	it('keeps your last known state while spectating a teammate', () => {
		const { rt } = makeRuntime();
		const views = play(rt, 'synthetic/death-spectate');
		const spectating = views.filter((v) => v.spectating);
		expect(spectating.length).toBeGreaterThan(0);
		for (const v of spectating) {
			expect(v.spectating!.steamId).not.toBe(SIM_ME.steamId);
			expect(v.me?.steamId).toBe(SIM_ME.steamId);
			expect(v.me?.stale).toBe(true);
		}
	});

	it('shows but does not record another account', () => {
		const { rt, saved } = makeRuntime('76561197960265728');
		const views = play(rt, 'synthetic/full-match');
		expect(saved).toHaveLength(0);
		const live = views.filter((v) => v.inGame);
		expect(live.length).toBeGreaterThan(0);
		expect(live.every((v) => v.setup.accountMismatch && !v.tracking.recording)).toBe(true);
	});

	it('waits for a Steam ID before recording', () => {
		const { rt, saved } = makeRuntime(null);
		const views = play(rt, 'synthetic/full-match');
		expect(saved).toHaveLength(0);
		expect(views.at(-1)!.setup.steamId).toBeNull();
		expect(views.at(-1)!.connection.providerSteamId).toBe(SIM_ME.steamId);
	});

	it('survives junk payloads', () => {
		const { rt } = makeRuntime();
		const junk: unknown[] = [
			{},
			{ map: 'nope' },
			{ map: { team_ct: { score: 'x' }, round: -4, round_wins: [1, 2] } },
			{ player: { state: { health: '100' }, weapons: 5 }, provider: { steamid: 12 } },
			{ round: { phase: 'live', bomb: 'planted' } },
			{ allplayers: { a: null, b: { match_stats: 'x' } } }
		];
		for (const [i, raw] of junk.entries()) {
			expect(ingest(rt, raw, 1000 + i).ok).toBe(true);
			expect(() => rt.view(1000 + i)).not.toThrow();
		}
		expect(ingest(rt, 'text', 2000)).toEqual({ ok: false, reason: 'payload is not a JSON object' });
	});
});
