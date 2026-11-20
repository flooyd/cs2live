// Lenient zod schemas for CS2 GSI payloads.
//
// Every field is optional and a field that fails validation becomes `undefined` instead of
// failing the whole payload: a malformed or unexpected field must never stop ingest. Unknown
// keys are kept (`looseObject`) so captures and raw storage keep everything CS2 sent.
//
// Field list: see .claude/skills/cs2-gsi-reference/SKILL.md. It started from Valve's CS:GO docs
// and must be checked against real CS2 captures (fixtures/README.md). Real data wins.
import { z } from 'zod';

/** A number, or a numeric string (phase_countdowns sends seconds as strings). */
const num = z
	.preprocess(
		(v) => (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v),
		z.number()
	)
	.optional()
	.catch(undefined);

/** A string; numbers are converted (Steam IDs must stay strings: they exceed 2^53). */
const str = z
	.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string())
	.optional()
	.catch(undefined);

/** A boolean, also accepting 0/1 and "true"/"false". */
const bool = z
	.preprocess((v) => {
		if (v === 1 || v === '1' || v === 'true') return true;
		if (v === 0 || v === '0' || v === 'false') return false;
		return v;
	}, z.boolean())
	.optional()
	.catch(undefined);

/** A record whose bad entries are dropped instead of failing the record. */
function lenientRecord<T extends z.ZodType>(value: T) {
	return z
		.preprocess((v) => {
			if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
			const out: Record<string, unknown> = {};
			for (const [k, item] of Object.entries(v)) {
				const parsed = value.safeParse(item);
				if (parsed.success) out[k] = parsed.data;
			}
			return out;
		}, z.record(z.string(), value).optional())
		.catch(undefined);
}

function section<T extends z.ZodRawShape>(shape: T) {
	return z.looseObject(shape).optional().catch(undefined);
}

export const providerSchema = section({
	name: str,
	appid: num,
	version: num,
	steamid: str,
	/** Unix seconds. */
	timestamp: num
});

export const teamSchema = section({
	score: num,
	name: str,
	flag: str,
	consecutive_round_losses: num,
	timeouts_remaining: num,
	matches_won_this_series: num
});

export const mapSchema = section({
	mode: str,
	name: str,
	/** warmup | live | intermission | gameover */
	phase: str,
	/** Rounds completed so far (0 during the first round). Unverified for CS2. */
	round: num,
	team_ct: teamSchema,
	team_t: teamSchema,
	num_matches_to_win_series: num,
	current_spectators: num,
	souvenirs_total: num,
	/** Round number ("1", "2", ...) to reason, e.g. "ct_win_elimination". */
	round_wins: lenientRecord(z.string())
});

export const roundSchema = section({
	/** freezetime | live | over */
	phase: str,
	/** CT | T, only once the round is over. */
	win_team: str,
	/** planted | exploded | defused */
	bomb: str
});

export const matchStatsSchema = section({
	kills: num,
	assists: num,
	deaths: num,
	mvps: num,
	score: num
});

export const playerStateSchema = section({
	health: num,
	armor: num,
	helmet: bool,
	defusekit: bool,
	/** 0-255 */
	flashed: num,
	/** 0-255 */
	smoked: num,
	/** 0-255 */
	burning: num,
	money: num,
	round_kills: num,
	round_killhs: num,
	round_totaldmg: num,
	equip_value: num
});

export const weaponSchema = z.looseObject({
	name: str,
	paintkit: str,
	/** Knife | Pistol | Rifle | SniperRifle | Submachine Gun | Shotgun | Machine Gun | Grenade | C4 | ... */
	type: str,
	/** active | holstered | reloading */
	state: str,
	ammo_clip: num,
	ammo_clip_max: num,
	ammo_reserve: num
});

const playerShape = {
	steamid: str,
	name: str,
	clan: str,
	observer_slot: num,
	/** CT | T */
	team: str,
	/** playing | menu | textinput */
	activity: str,
	match_stats: matchStatsSchema,
	state: playerStateSchema,
	weapons: lenientRecord(weaponSchema),
	/** "x, y, z" */
	position: str,
	forward: str
};

export const playerSchema = section(playerShape);

export const phaseCountdownsSchema = section({
	/** freezetime | live | bomb | defuse | over | warmup | timeout_ct | timeout_t | paused | ... */
	phase: str,
	/** Seconds left in the phase. Sent as a string. */
	phase_ends_in: num
});

export const bombSchema = section({
	/** carried | dropped | planting | planted | defusing | defused | exploded */
	state: str,
	position: str,
	player: str,
	countdown: num
});

export const gsiPayloadSchema = z.looseObject({
	provider: providerSchema,
	map: mapSchema,
	round: roundSchema,
	player: playerSchema,
	phase_countdowns: phaseCountdownsSchema,
	bomb: bombSchema,
	allplayers: lenientRecord(z.looseObject(playerShape)),
	grenades: z.unknown().optional(),
	previously: z.unknown().optional(),
	added: z.unknown().optional(),
	auth: section({ token: str })
});

export type GsiPayload = z.infer<typeof gsiPayloadSchema>;
export type GsiMap = NonNullable<GsiPayload['map']>;
export type GsiTeam = NonNullable<GsiMap['team_ct']>;
export type GsiPlayer = NonNullable<GsiPayload['player']>;
export type GsiPlayerState = NonNullable<GsiPlayer['state']>;
export type GsiMatchStats = NonNullable<GsiPlayer['match_stats']>;
export type GsiWeapon = z.infer<typeof weaponSchema>;

/** Parses anything into a payload. Returns null only when the input is not an object at all. */
export function parsePayload(input: unknown): GsiPayload | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const result = gsiPayloadSchema.safeParse(input);
	return result.success ? result.data : null;
}
