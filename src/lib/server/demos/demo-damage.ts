// Your damage per round from a CS2 demo's events. Pure: takes the rows demoparser2 returns.
//
// - Only damage to enemies counts (no team damage, no self damage), like the in-game ADR.
// - `player_hurt.dmg_health` is not capped: an AWP body shot on a 100 HP player reports more than
//   100. Each hit counts at most the victim's health before it, which we follow per round from
//   100 using the event's `health` (health left after the hit).
// - A hit belongs to the round whose freeze time ended last before it, so damage after the round
//   is decided (before the next round starts) still counts for that round. Round numbers come from
//   `total_rounds_played` at freeze end, so they match GSI's numbering (round 1 = the first).
// - Warmup is left out.

export interface HurtEvent {
	tick: number;
	attacker_steamid?: string | number | null;
	user_steamid?: string | number | null;
	attacker_team_num?: number | null;
	user_team_num?: number | null;
	dmg_health?: number | null;
	/** Victim health after the hit. */
	health?: number | null;
	is_warmup_period?: boolean | null;
}

export interface FreezeEndEvent {
	tick: number;
	total_rounds_played?: number | null;
	is_warmup_period?: boolean | null;
}

export interface DemoDamage {
	/** Damage per round number, for every round in the demo (0 when you dealt none). */
	damage: Map<number, number>;
	/** The highest round number in the demo. */
	rounds: number;
}

const START_HEALTH = 100;

export function damageByRound(
	steamId: string,
	hurt: HurtEvent[],
	freezeEnds: FreezeEndEvent[]
): DemoDamage {
	const starts = freezeEnds
		.filter((e) => !e.is_warmup_period && typeof e.total_rounds_played === 'number')
		.map((e) => ({ tick: e.tick, round: e.total_rounds_played! + 1 }))
		.sort((a, b) => a.tick - b.tick);

	const damage = new Map<number, number>();
	for (const s of starts) damage.set(s.round, 0);
	const rounds = Math.max(0, ...starts.map((s) => s.round));

	const roundAt = (tick: number): number | null => {
		let found: number | null = null;
		for (const s of starts) {
			if (s.tick > tick) break;
			found = s.round;
		}
		return found;
	};

	// Victim health, followed through every hit (anyone's) in the round.
	const health = new Map<string, number>();
	let healthRound: number | null = null;
	const events = hurt.filter((e) => !e.is_warmup_period).sort((a, b) => a.tick - b.tick);
	for (const e of events) {
		const round = roundAt(e.tick);
		if (round === null) continue;
		if (round !== healthRound) {
			health.clear();
			healthRound = round;
		}
		const victim = e.user_steamid == null ? null : String(e.user_steamid);
		const before = victim === null ? START_HEALTH : (health.get(victim) ?? START_HEALTH);
		const dealt = Math.max(0, Math.min(e.dmg_health ?? 0, before));
		if (victim !== null) {
			health.set(victim, typeof e.health === 'number' ? e.health : before - dealt);
		}

		const attacker = e.attacker_steamid == null ? null : String(e.attacker_steamid);
		if (attacker !== steamId || victim === steamId) continue;
		const teams = typeof e.attacker_team_num === 'number' && typeof e.user_team_num === 'number';
		if (teams && e.attacker_team_num === e.user_team_num) continue;
		damage.set(round, (damage.get(round) ?? 0) + dealt);
	}
	return { damage, rounds };
}
