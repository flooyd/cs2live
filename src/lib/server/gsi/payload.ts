// Small helpers for reading GSI payloads. Pure.
import type { GsiPayload, GsiPlayer, GsiWeapon } from './schema.ts';
import type { WeaponSnap } from '#lib/match-record.ts';
import { asSide, type Side } from '#lib/cs2/rounds.ts';
import { isGrenadeType, isPrimaryType } from '#lib/cs2/weapons.ts';

/** The `player` block describes the person running the game (not a spectated teammate). */
export function isSelf(p: GsiPayload): boolean {
	const id = p.player?.steamid;
	return !!id && id === p.provider?.steamid;
}

/** The `player` block describes someone else: we are dead and spectating them (or observing). */
export function spectatedPlayer(p: GsiPayload): GsiPlayer | null {
	const player = p.player;
	if (!player?.steamid || player.steamid === p.provider?.steamid) return null;
	return player;
}

/** `allplayers` is only sent to spectators, observers and GOTV, never while you play. */
export function isObserverPayload(p: GsiPayload): boolean {
	return !!p.allplayers && Object.keys(p.allplayers).length > 0;
}

export function scoreSum(p: GsiPayload): number {
	return (p.map?.team_ct?.score ?? 0) + (p.map?.team_t?.score ?? 0);
}

/**
 * 1-based number of the round in progress. Only meaningful during freezetime/live; during
 * `over` the scores may or may not include the round that just ended yet.
 * Prefers map.round (rounds completed) and falls back to the score sum.
 */
export function currentRoundNumber(p: GsiPayload): number {
	const completed = p.map?.round;
	return (typeof completed === 'number' && completed >= 0 ? completed : scoreSum(p)) + 1;
}

export function playerSide(player: GsiPlayer | undefined | null): Side | null {
	return asSide(player?.team);
}

/** Weapons in slot order (weapon_0, weapon_1, ...). */
export function weaponList(player: GsiPlayer | undefined | null): GsiWeapon[] {
	const weapons = player?.weapons;
	if (!weapons) return [];
	return Object.entries(weapons)
		.sort(([a], [b]) => slot(a) - slot(b))
		.map(([, w]) => w);
}

function slot(key: string): number {
	const n = Number(key.replace(/^\D+/, ''));
	return Number.isFinite(n) ? n : 99;
}

export function activeWeapon(player: GsiPlayer | undefined | null): GsiWeapon | null {
	return weaponList(player).find((w) => w.state === 'active') ?? null;
}

export function grenades(player: GsiPlayer | undefined | null): { name: string; count: number }[] {
	return weaponList(player)
		.filter((w) => isGrenadeType(w.type) && w.name)
		.map((w) => ({ name: w.name!, count: Math.max(1, w.ammo_reserve ?? 1) }));
}

export function weaponSnaps(player: GsiPlayer | undefined | null): WeaponSnap[] {
	return weaponList(player)
		.filter((w) => w.name)
		.map((w) => ({
			name: w.name!,
			type: w.type ?? null,
			count: isGrenadeType(w.type) ? Math.max(1, w.ammo_reserve ?? 1) : null
		}));
}

export function primaryWeapon(player: GsiPlayer | undefined | null): string | null {
	return weaponList(player).find((w) => isPrimaryType(w.type))?.name ?? null;
}
