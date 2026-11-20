// A synthetic CS2 GSI feed, built from our *hypothesis* of what CS2 sends while you play
// (see .claude/skills/cs2-gsi-reference). Used for hand-made fixtures, tests and seed data.
// When real captures disagree with it, fix this file too. Pure and deterministic per seed.
import type { GsiPayload } from '../schema.ts';
import { fakeSteamId } from '#lib/cs2/steamid.ts';
import { modeInfo, ROUND_OVER_S } from '#lib/cs2/modes.ts';
import { nextLossBonus, REWARDS } from '#lib/cs2/economy.ts';
import { otherSide, type Side } from '#lib/cs2/rounds.ts';

export interface Frame {
	/** Milliseconds since the epoch at which the payload was received. */
	t: number;
	p: GsiPayload;
}

export interface SimPlayer {
	steamId: string;
	name: string;
}

export interface SimOptions {
	seed?: number;
	map?: string;
	mode?: string;
	me?: SimPlayer;
	teammates?: SimPlayer[];
	startAt?: number;
	mySideStart?: Side;
	/** Chance that my team wins a round. */
	winChance?: number;
	/** Steer regulation to a tie so the match goes to overtime. */
	forceOvertime?: boolean;
	/** Start sending at this round's freeze time, as if we just joined (scores already set). */
	joinAtRound?: number;
	/** Stop sending after this round ends, with no gameover (quit / crash). */
	quitAfterRound?: number;
	/** Disconnect after this round ends, come back `reconnectAfterMs` later (data resumes). */
	disconnectAfterRound?: number;
	reconnectAfterMs?: number;
	/** Send a warmup phase first. */
	warmup?: boolean;
	/** Never die (no spectating frames). */
	immortal?: boolean;
	/** Always die mid-round and spectate a teammate. */
	alwaysDie?: boolean;
	heartbeatMs?: number;
	gsiVersion?: number;
	auth?: string;
}

export const SIM_ME: SimPlayer = { steamId: fakeSteamId(1), name: 'SimPlayer' };
export const SIM_TEAMMATES: SimPlayer[] = [
	{ steamId: fakeSteamId(2), name: 'Mate One' },
	{ steamId: fakeSteamId(3), name: 'Mate Two' },
	{ steamId: fakeSteamId(4), name: 'Mate Three' },
	{ steamId: fakeSteamId(5), name: 'Mate Four' }
];

/** mulberry32: tiny seeded PRNG. */
export function rng(seed: number) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		chance: (p: number) => next() < p,
		int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
		pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]
	};
}

interface Weapon {
	name: string;
	type: string;
	clip?: number;
	reserve?: number;
	count?: number;
}

const KNIFE: Weapon = { name: 'weapon_knife', type: 'Knife' };
const PISTOL: Record<Side, Weapon> = {
	CT: { name: 'weapon_usp_silencer', type: 'Pistol', clip: 12, reserve: 24 },
	T: { name: 'weapon_glock', type: 'Pistol', clip: 20, reserve: 120 }
};
const RIFLES: Record<Side, Weapon[]> = {
	CT: [
		{ name: 'weapon_m4a1_silencer', type: 'Rifle', clip: 20, reserve: 80 },
		{ name: 'weapon_m4a1', type: 'Rifle', clip: 30, reserve: 90 },
		{ name: 'weapon_awp', type: 'SniperRifle', clip: 5, reserve: 30 }
	],
	T: [
		{ name: 'weapon_ak47', type: 'Rifle', clip: 30, reserve: 90 },
		{ name: 'weapon_ak47', type: 'Rifle', clip: 30, reserve: 90 },
		{ name: 'weapon_awp', type: 'SniperRifle', clip: 5, reserve: 30 }
	]
};
const FORCE: Record<Side, Weapon[]> = {
	CT: [
		{ name: 'weapon_famas', type: 'Rifle', clip: 25, reserve: 90 },
		{ name: 'weapon_mp9', type: 'Submachine Gun', clip: 30, reserve: 120 }
	],
	T: [
		{ name: 'weapon_galilar', type: 'Rifle', clip: 35, reserve: 90 },
		{ name: 'weapon_mac10', type: 'Submachine Gun', clip: 30, reserve: 100 }
	]
};
const PRICE: Record<string, number> = {
	weapon_m4a1_silencer: 2900,
	weapon_m4a1: 2900,
	weapon_ak47: 2700,
	weapon_awp: 4750,
	weapon_famas: 2050,
	weapon_galilar: 1800,
	weapon_mp9: 1250,
	weapon_mac10: 1050,
	weapon_p250: 300,
	weapon_deagle: 700,
	weapon_usp_silencer: 200,
	weapon_glock: 200
};

interface Me {
	money: number;
	health: number;
	armor: number;
	helmet: boolean;
	kit: boolean;
	primary: Weapon | null;
	pistol: Weapon;
	nades: Weapon[];
	kills: number;
	assists: number;
	deaths: number;
	mvps: number;
	score: number;
	roundKills: number;
	roundHs: number;
	roundDmg: number;
	flashed: number;
	burning: number;
	smoked: number;
	active: 'primary' | 'pistol' | 'knife';
}

type TeamKey = 'us' | 'them';

interface Mate extends SimPlayer {
	kills: number;
	assists: number;
	deaths: number;
	mvps: number;
	score: number;
}

export function simulateMatch(options: SimOptions = {}): Frame[] {
	const r = rng(options.seed ?? 1);
	const mapName = options.map ?? 'de_mirage';
	const modeName = options.mode ?? 'competitive';
	const mode = modeInfo(modeName);
	const meP = options.me ?? SIM_ME;
	const mates: Mate[] = (options.teammates ?? SIM_TEAMMATES)
		.slice(0, modeName === 'scrimcomp2v2' ? 1 : 4)
		.map((m) => ({ ...m, kills: 0, assists: 0, deaths: 0, mvps: 0, score: 0 }));
	const heartbeat = options.heartbeatMs ?? 10_000;
	const halfLength = mode.halfLength ?? 12;
	const regulation = mode.regulationRounds ?? 24;
	const otHalf = mode.overtimeHalf ?? 3;
	const winTarget = regulation / 2 + 1;
	const winChance = options.winChance ?? 0.5;
	const freezeMs = mode.freezeTimeS * 1000;
	const joinAt = options.joinAtRound ?? 1;

	const frames: Frame[] = [];
	let t = options.startAt ?? Date.UTC(2026, 10, 1, 18, 0, 0);
	let sending = joinAt <= 1;
	let lastEmit = 0;

	let mySide: Side = options.mySideStart ?? 'CT';
	// Scores and loss streaks belong to teams, not sides: they swap sides with the team at halftime.
	const score: Record<TeamKey, number> = { us: 0, them: 0 };
	const lossStreak: Record<TeamKey, number> = { us: 0, them: 0 };
	const teamOf = (side: Side): TeamKey => (side === mySide ? 'us' : 'them');
	const roundWins: Record<string, string> = {};
	let completed = 0;

	const me: Me = {
		money: 800,
		health: 100,
		armor: 0,
		helmet: false,
		kit: false,
		primary: null,
		pistol: PISTOL[mySide],
		nades: [],
		kills: 0,
		assists: 0,
		deaths: 0,
		mvps: 0,
		score: 0,
		roundKills: 0,
		roundHs: 0,
		roundDmg: 0,
		flashed: 0,
		burning: 0,
		smoked: 0,
		active: 'pistol'
	};

	const provider = () => ({
		name: 'Counter-Strike: Global Offensive',
		appid: 730,
		version: options.gsiVersion ?? 14100,
		steamid: meP.steamId,
		timestamp: Math.floor(t / 1000)
	});

	const team = (side: Side) => ({
		score: score[teamOf(side)],
		consecutive_round_losses: lossStreak[teamOf(side)],
		timeouts_remaining: 1,
		matches_won_this_series: 0
	});

	const mapBlock = (phase: string) => ({
		mode: modeName,
		name: mapName,
		phase,
		round: completed,
		team_ct: team('CT'),
		team_t: team('T'),
		num_matches_to_win_series: 0,
		...(Object.keys(roundWins).length ? { round_wins: { ...roundWins } } : {})
	});

	const weaponsBlock = () => {
		const list: Weapon[] = [KNIFE, me.pistol, ...(me.primary ? [me.primary] : []), ...me.nades];
		const out: Record<string, unknown> = {};
		list.forEach((w, i) => {
			const isActive =
				(me.active === 'knife' && w === KNIFE) ||
				(me.active === 'pistol' && w === me.pistol) ||
				(me.active === 'primary' && w === me.primary);
			out[`weapon_${i}`] = {
				name: w.name,
				paintkit: 'default',
				type: w.type,
				...(w.clip !== undefined
					? { ammo_clip: w.clip, ammo_clip_max: w.clip, ammo_reserve: w.reserve }
					: {}),
				...(w.count !== undefined ? { ammo_reserve: w.count } : {}),
				state: isActive ? 'active' : 'holstered'
			};
		});
		return out;
	};

	const equipValue = () =>
		(me.primary ? (PRICE[me.primary.name] ?? 2000) : 0) +
		(PRICE[me.pistol.name] ?? 200) +
		(me.armor > 0 ? (me.helmet ? 1000 : 650) : 0) +
		(me.kit ? 400 : 0) +
		me.nades.reduce((n, g) => n + 300 * (g.count ?? 1), 0);

	const selfPlayer = () => ({
		steamid: meP.steamId,
		name: meP.name,
		observer_slot: 1,
		team: mySide,
		activity: 'playing',
		match_stats: {
			kills: me.kills,
			assists: me.assists,
			deaths: me.deaths,
			mvps: me.mvps,
			score: me.score
		},
		state: {
			health: me.health,
			armor: me.armor,
			helmet: me.helmet,
			...(mySide === 'CT' ? { defusekit: me.kit } : {}),
			flashed: me.flashed,
			smoked: me.smoked,
			burning: me.burning,
			money: me.money,
			round_kills: me.roundKills,
			round_killhs: me.roundHs,
			round_totaldmg: me.roundDmg,
			equip_value: equipValue()
		},
		weapons: weaponsBlock(),
		position: '-1056.00, 512.00, -167.97',
		forward: '0.71, 0.70, 0.00'
	});

	const matePlayer = (m: Mate) => ({
		steamid: m.steamId,
		name: m.name,
		observer_slot: 2,
		team: mySide,
		activity: 'playing',
		match_stats: {
			kills: m.kills,
			assists: m.assists,
			deaths: m.deaths,
			mvps: m.mvps,
			score: m.score
		},
		state: {
			health: r.int(20, 100),
			armor: 100,
			helmet: true,
			flashed: 0,
			smoked: 0,
			burning: 0,
			money: r.int(500, 5000),
			round_kills: r.int(0, 2),
			round_killhs: 0,
			round_totaldmg: r.int(0, 180),
			equip_value: 4700
		},
		weapons: {
			weapon_0: { name: 'weapon_knife', type: 'Knife', state: 'holstered' },
			weapon_1: {
				name: 'weapon_ak47',
				type: 'Rifle',
				ammo_clip: 21,
				ammo_clip_max: 30,
				ammo_reserve: 90,
				state: 'active'
			}
		},
		position: '120.00, -800.00, -40.00',
		forward: '0.00, 1.00, 0.00'
	});

	const emit = (p: GsiPayload) => {
		if (!sending) return;
		frames.push({ t, p: { ...p, ...(options.auth ? { auth: { token: options.auth } } : {}) } });
		lastEmit = t;
	};
	const ingame = (mapPhase: string, roundPhase: Record<string, unknown>, player: unknown) =>
		emit({
			provider: provider(),
			map: mapBlock(mapPhase),
			round: roundPhase,
			player
		} as GsiPayload);

	/** Advance time, sending heartbeats (repeat of the last payload) through long quiet gaps. */
	const wait = (ms: number) => {
		const target = t + ms;
		while (sending && frames.length && target - lastEmit > heartbeat) {
			t = lastEmit + heartbeat;
			const last = frames[frames.length - 1].p;
			frames.push({ t, p: { ...last, provider: provider() } });
			lastEmit = t;
		}
		t = target;
	};

	const menu = () =>
		emit({
			provider: provider(),
			player: { steamid: meP.steamId, name: meP.name, activity: 'menu' }
		});

	// Warmup
	if (options.warmup !== false && sending) {
		me.money = 10000;
		for (let i = 0; i < 4; i++) {
			ingame('warmup', { phase: 'live' }, selfPlayer());
			wait(15_000);
		}
		me.money = 800;
	}

	let round = 0;
	while (true) {
		round++;
		if (round === joinAt && !sending) {
			sending = true;
			lastEmit = t;
		}

		// ---- Freeze time and buy
		me.roundKills = 0;
		me.roundHs = 0;
		me.roundDmg = 0;
		me.flashed = 0;
		me.burning = 0;
		me.smoked = 0;
		if (me.health === 0) {
			me.primary = null;
			me.pistol = PISTOL[mySide];
			me.armor = 0;
			me.helmet = false;
			me.kit = false;
			me.nades = [];
		}
		me.health = 100;
		const isOT = round > regulation;
		ingame('live', { phase: 'freezetime' }, selfPlayer());
		wait(3000);
		buy(r, me, mySide, isOT);
		me.active = me.primary ? 'primary' : 'pistol';
		ingame('live', { phase: 'freezetime' }, selfPlayer());
		wait(freezeMs - 3000);

		// ---- Live
		const iWin = decideWinner();
		const roundLen = r.int(35_000, Math.min(mode.roundTimeS * 1000, 105_000));
		const plant = (mySide === 'T' ? iWin : !iWin) ? r.chance(0.55) : r.chance(0.25);
		const iDie = options.immortal ? false : options.alwaysDie ? true : r.chance(iWin ? 0.35 : 0.7);
		const deathAt = iDie ? r.int(8_000, roundLen - 3_000) : Infinity;
		const nKills = pickKills(r, iWin);
		const killTimes = Array.from({ length: nKills }, () =>
			r.int(4_000, Math.min(deathAt, roundLen) - 1_000)
		)
			.filter((k) => k > 0)
			.sort((a, b) => a - b);
		const plantAt = plant ? r.int(25_000, Math.max(26_000, roundLen - 5_000)) : Infinity;

		ingame('live', { phase: 'live' }, selfPlayer());
		let elapsed = 0;
		const step = (to: number) => {
			wait(to - elapsed);
			elapsed = to;
		};
		const events: { at: number; kind: 'kill' | 'death' | 'plant' | 'hurt' | 'flash' }[] = [
			...killTimes.map((at) => ({ at, kind: 'kill' as const })),
			...(iDie ? [{ at: deathAt, kind: 'death' as const }] : []),
			...(plant ? [{ at: plantAt, kind: 'plant' as const }] : []),
			{ at: r.int(5_000, 30_000), kind: 'hurt' as const },
			...(r.chance(0.3) ? [{ at: r.int(5_000, 30_000), kind: 'flash' as const }] : [])
		].sort((a, b) => a.at - b.at);

		let dead = false;
		let bomb: string | undefined;
		let spectating: Mate | null = null;
		for (const ev of events) {
			if (ev.at >= roundLen) continue;
			step(ev.at);
			if (ev.kind === 'plant') {
				bomb = 'planted';
			} else if (dead) {
				// Can't do anything while dead; the spectated teammate might frag.
				if (spectating && r.chance(0.5)) {
					spectating.kills++;
					spectating.score += 2;
				}
			} else if (ev.kind === 'kill') {
				me.roundKills++;
				me.kills++;
				me.score += 2;
				const hs = r.chance(0.45);
				if (hs) me.roundHs++;
				me.roundDmg += 100;
				me.money = Math.min(
					16000,
					me.money +
						(me.primary?.type === 'Submachine Gun'
							? 600
							: me.primary?.name === 'weapon_awp'
								? 100
								: 300)
				);
				if (me.primary?.clip) me.primary.clip = Math.max(0, me.primary.clip - r.int(3, 9));
			} else if (ev.kind === 'hurt') {
				me.health = Math.max(1, me.health - r.int(8, 60));
				me.armor = Math.max(0, me.armor - r.int(5, 30));
				me.roundDmg += r.chance(0.5) ? r.int(10, 70) : 0;
			} else if (ev.kind === 'flash') {
				me.flashed = 255;
				ingame('live', { phase: 'live', ...(bomb ? { bomb } : {}) }, selfPlayer());
				wait(1500);
				elapsed += 1500;
				me.flashed = 0;
			} else if (ev.kind === 'death') {
				me.health = 0;
				me.deaths++;
				dead = true;
				me.flashed = 0;
				ingame('live', { phase: 'live', ...(bomb ? { bomb } : {}) }, selfPlayer());
				wait(2000);
				elapsed += 2000;
				spectating = mates.length ? r.pick(mates) : null;
			}
			ingame(
				'live',
				{ phase: 'live', ...(bomb ? { bomb } : {}) },
				dead && spectating ? matePlayer(spectating) : selfPlayer()
			);
		}
		step(roundLen);

		// ---- Round over
		const winner: Side = iWin ? mySide : otherSide(mySide);
		let reason: string;
		if (bomb === 'planted') {
			if (winner === 'T') {
				reason = 't_win_bomb';
				bomb = 'exploded';
			} else {
				reason = 'ct_win_defuse';
				bomb = 'defused';
			}
		} else {
			reason =
				winner === 'CT' && r.chance(0.15)
					? 'ct_win_time'
					: `${winner.toLowerCase()}_win_elimination`;
		}
		score[teamOf(winner)]++;
		completed++;
		roundWins[String(round)] = reason;
		const loser = otherSide(winner);
		// Rewards: winner gets the win reward; the loser gets the loss bonus for this loss.
		const lossBonus = nextLossBonus(lossStreak[teamOf(loser)]);
		lossStreak[teamOf(loser)] = Math.min(lossStreak[teamOf(loser)] + 1, 4);
		lossStreak[teamOf(winner)] = Math.max(0, lossStreak[teamOf(winner)] - 1);
		const winReward =
			reason.includes('bomb') || reason.includes('defuse')
				? REWARDS.winBomb
				: REWARDS.winElimination;
		if (winner === mySide) me.money = Math.min(16000, me.money + winReward);
		else
			me.money = Math.min(
				16000,
				me.money + lossBonus + (mySide === 'T' && bomb ? REWARDS.plantedLossBonus : 0)
			);
		if (winner === mySide && me.roundKills >= 2 && r.chance(0.6)) {
			me.mvps++;
			me.score += 2;
		}
		if (r.chance(0.25)) {
			me.assists++;
			me.score += 1;
		}
		for (const m of mates) {
			if (r.chance(0.35)) {
				m.kills += 1;
				m.score += 2;
			}
			if (r.chance(0.4)) m.deaths++;
		}

		const total = score.us + score.them;
		const leader = Math.max(score.us, score.them);
		const finished =
			total < regulation
				? leader >= winTarget
				: total === regulation
					? leader >= winTarget || mode.overtimeHalf === null
					: isOvertimeDone(score, regulation, otHalf);

		const overRound = { phase: 'over', win_team: winner, ...(bomb ? { bomb } : {}) };
		ingame(
			finished ? 'gameover' : 'live',
			overRound,
			dead && spectating ? matePlayer(spectating) : selfPlayer()
		);

		if (finished) {
			wait(5000);
			ingame('gameover', overRound, selfPlayer());
			wait(10_000);
			ingame('gameover', overRound, selfPlayer());
			wait(5000);
			menu();
			break;
		}

		if (options.quitAfterRound === round) {
			wait(2000);
			menu();
			wait(3000);
			menu();
			break;
		}

		if (options.disconnectAfterRound === round) {
			wait(2000);
			menu();
			const gap = options.reconnectAfterMs ?? 60_000;
			const prevSending = sending;
			sending = false;
			wait(gap);
			sending = prevSending;
			lastEmit = t;
		} else {
			wait(ROUND_OVER_S * 1000);
		}

		// ---- Halftime / overtime side switches
		const switchSides =
			round === halfLength || (round > regulation && (round - regulation) % otHalf === 0);
		if (switchSides) {
			if (round === halfLength) {
				ingame('intermission', { phase: 'over', win_team: winner }, selfPlayer());
				wait(15_000);
			}
			mySide = otherSide(mySide);
			me.primary = null;
			me.nades = [];
			me.armor = 0;
			me.helmet = false;
			me.kit = false;
			me.pistol = PISTOL[mySide];
			me.health = 0; // forces a fresh loadout
			if (round === halfLength) me.money = 800;
			lossStreak.us = 0;
			lossStreak.them = 0;
		}
		if (round === regulation || (round > regulation && (round - regulation) % (otHalf * 2) === 0)) {
			me.money = 12500; // overtime start money
			lossStreak.us = 0;
			lossStreak.them = 0;
		}
	}

	return frames;

	function decideWinner(): boolean {
		if (options.forceOvertime && round <= regulation) {
			// Alternate so regulation ends level.
			const mine = score.us;
			const theirs = score.them;
			if (mine >= regulation / 2) return false;
			if (theirs >= regulation / 2) return true;
			return mine <= theirs;
		}
		return r.chance(winChance);
	}
}

function isOvertimeDone(
	score: Record<TeamKey, number>,
	regulation: number,
	otHalf: number
): boolean {
	const ot = score.us + score.them - regulation;
	if (ot <= 0) return false;
	const block = otHalf * 2;
	const base = regulation / 2 + Math.floor((ot - 1) / block) * otHalf;
	return (
		score.us > base + otHalf ||
		score.them > base + otHalf ||
		(ot % block === 0 && score.us !== score.them)
	);
}

function pickKills(r: ReturnType<typeof rng>, iWin: boolean): number {
	const x = r.next();
	if (iWin) return x < 0.25 ? 0 : x < 0.55 ? 1 : x < 0.8 ? 2 : x < 0.93 ? 3 : x < 0.985 ? 4 : 5;
	return x < 0.45 ? 0 : x < 0.8 ? 1 : x < 0.95 ? 2 : 3;
}

function buy(r: ReturnType<typeof rng>, me: Me, side: Side, isOT: boolean) {
	const spend = (n: number) => (me.money -= n);
	const armour = () => {
		if (me.armor > 0 && me.helmet) return;
		if (me.money >= 1000) {
			spend(1000);
			me.armor = 100;
			me.helmet = true;
		} else if (me.money >= 650) {
			spend(650);
			me.armor = 100;
		}
	};
	if (me.money <= 1000 && !me.primary) {
		// Pistol round or deep eco: armour on pistol rounds, maybe a P250 otherwise.
		if (me.money >= 650 && r.chance(0.6)) {
			spend(650);
			me.armor = 100;
		} else if (me.money >= 300 && r.chance(0.5)) {
			spend(300);
			me.pistol = { name: 'weapon_p250', type: 'Pistol', clip: 13, reserve: 26 };
		}
		return;
	}
	const fullCost = side === 'CT' ? 4400 : 4100;
	if (me.primary && me.primary.type !== 'Submachine Gun') {
		armour();
	} else if (me.money >= fullCost || isOT) {
		me.primary = { ...r.pick(RIFLES[side]) };
		spend(PRICE[me.primary.name] ?? 2800);
		armour();
	} else if (me.money >= 2300 && r.chance(0.6)) {
		me.primary = { ...r.pick(FORCE[side]) };
		spend(PRICE[me.primary.name] ?? 1500);
		if (me.money >= 650) {
			spend(650);
			me.armor = 100;
		}
		return;
	} else {
		return; // eco / save
	}
	if (side === 'CT' && !me.kit && me.money >= 400) {
		spend(400);
		me.kit = true;
	}
	const nades = [
		{ name: 'weapon_smokegrenade', type: 'Grenade', count: 1 },
		{ name: 'weapon_flashbang', type: 'Grenade', count: 2 },
		{ name: side === 'CT' ? 'weapon_incgrenade' : 'weapon_molotov', type: 'Grenade', count: 1 },
		{ name: 'weapon_hegrenade', type: 'Grenade', count: 1 }
	];
	me.nades = [];
	for (const n of nades) {
		const cost = 300 * n.count;
		if (me.money >= cost + 200) {
			spend(cost);
			me.nades.push(n);
		}
	}
}
