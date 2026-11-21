// A tiny synthetic demo for tests: two Wingman rounds, shaped like demoparser2's output.
//
// Round 1 (you T): you kill E1 with an AK headshot (150 damage, 100 counts), assist your mate's
// kill on E2, team-kill your mate after the round is decided, and the bomb is planted after the
// round is over. T win by elimination, you are MVP.
// Round 2 (you CT, side switch, $800): E1 kills you; the bomb is planted and defused; CT win.
// Warmup has a kill that must not count, and a bot plays on your side in round 2.
import { fakeSteamId } from '#lib/cs2/steamid.ts';
import {
	sampleTicks,
	type DemoEvents,
	type DemoMatchData,
	type PlayerTick
} from './demo-record.ts';

export const DEMO_ME = fakeSteamId(100);
export const DEMO_MATE = fakeSteamId(101);
const E1 = fakeSteamId(102);
const E2 = fakeSteamId(103);
const BOT = '0';

const T = 2;
const CT = 3;

export function syntheticDemoEvents(): DemoEvents {
	const kill = (
		tick: number,
		attacker: string,
		victim: string,
		teams: [number, number],
		extra: { weapon?: string; headshot?: boolean; assister?: string } = {}
	) => ({
		tick,
		attacker_steamid: attacker,
		user_steamid: victim,
		assister_steamid: extra.assister ?? null,
		attacker_team_num: teams[0],
		user_team_num: teams[1],
		weapon: extra.weapon ?? 'glock',
		headshot: extra.headshot ?? false,
		is_warmup_period: false
	});
	return {
		map: 'de_inferno',
		rankTypeIds: [7, 7, 7, 7],
		cvars: { game_mode: '2' },
		matchStarts: [{ tick: 100 }],
		roundStarts: [{ tick: 20 }, { tick: 99 }, { tick: 2000 }],
		freezeEnds: [
			{ tick: 50, total_rounds_played: 0, is_warmup_period: true },
			{ tick: 1000, total_rounds_played: 0 },
			{ tick: 2960, total_rounds_played: 1 }
		],
		roundEnds: [
			{ tick: 1800, winner: 'T', reason: 'ct_killed', total_rounds_played: 1 },
			{ tick: 3800, winner: 'CT', reason: 'bomb_defused', total_rounds_played: 2 }
		],
		matchEnds: [{ tick: 3900 }],
		deaths: [
			{ ...kill(60, DEMO_ME, E1, [T, CT]), is_warmup_period: true },
			kill(1100, DEMO_ME, E1, [T, CT], { weapon: 'ak47', headshot: true }),
			kill(1200, DEMO_MATE, E2, [T, CT], { assister: DEMO_ME }),
			kill(1850, DEMO_ME, DEMO_MATE, [T, T]),
			kill(3000, E1, DEMO_ME, [T, CT], { weapon: 'usp_silencer' })
		],
		hurt: [
			{
				tick: 1090,
				attacker_steamid: DEMO_ME,
				user_steamid: E1,
				attacker_team_num: T,
				user_team_num: CT,
				dmg_health: 150,
				health: 0
			}
		],
		bombs: [
			{ tick: 1850, kind: 'planted' },
			{ tick: 3500, kind: 'planted' },
			{ tick: 3790, kind: 'defused' }
		]
	};
}

/** Player state at a tick, by round: round 1 runs to tick 1999, round 2 from 2000. */
function stateAt(tick: number, id: string): Omit<PlayerTick, 'tick'> | null {
	const r2 = tick >= 2000;
	const scoreboard = (o: Partial<PlayerTick>) => ({
		kills_total: 0,
		deaths_total: 0,
		assists_total: 0,
		mvps: 0,
		score: 0,
		...o
	});
	if (id === DEMO_ME) {
		const alive = !r2 || tick < 3000;
		return {
			name: 'Me',
			team_num: r2 ? CT : T,
			balance: r2 ? (tick < 2100 ? 800 : tick < 3850 ? 50 : 1450) : tick < 1050 ? 800 : 150,
			current_equip_value: r2 ? 950 : 850,
			health: alive ? (tick >= 1800 ? 64 : 100) : 0,
			is_alive: alive,
			inventory: !alive
				? []
				: r2
					? ['knife', 'USP-S']
					: ['knife_t', 'Glock-18', 'Flashbang', 'Flashbang', 'High Explosive Grenade'],
			...scoreboard({
				kills_total: tick >= 1100 ? 1 : 0,
				assists_total: tick >= 1200 ? 1 : 0,
				deaths_total: tick >= 3000 ? 1 : 0,
				mvps: tick >= 1800 ? 1 : 0,
				score: r2 ? 7 : 5
			})
		};
	}
	if (id === DEMO_MATE) {
		return {
			name: 'Mate',
			team_num: r2 ? CT : T,
			balance: 1000,
			current_equip_value: 1000,
			health: 100,
			is_alive: true,
			inventory: ['knife'],
			...scoreboard({ kills_total: 1, deaths_total: tick >= 1850 ? 1 : 0, score: 3 })
		};
	}
	if (id === BOT) {
		return r2 ? { name: 'BOT Kurt', team_num: CT, ...scoreboard({}) } : null;
	}
	return {
		name: id === E1 ? 'Enemy 1' : 'Enemy 2',
		team_num: r2 ? T : CT,
		...scoreboard({ kills_total: id === E1 && tick >= 3000 ? 1 : 0 })
	};
}

/** The synthetic demo with player state at the ticks the importer asks for. */
export function syntheticDemo(steamId = DEMO_ME): DemoMatchData {
	const events = syntheticDemoEvents();
	const ticks: PlayerTick[] = [];
	for (const tick of sampleTicks(events, steamId)) {
		for (const id of [DEMO_ME, DEMO_MATE, E1, E2, BOT]) {
			const s = stateAt(tick, id);
			if (s) ticks.push({ tick, steamid: id, ...s });
		}
	}
	return { ...events, ticks };
}
