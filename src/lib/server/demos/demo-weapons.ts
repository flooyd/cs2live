// demoparser2's weapon names, translated to the names and types GSI uses (`weapon_ak47`,
// `Rifle`), so a match imported from a demo looks like a recorded one. Pure.
import type { WeaponSnap } from '#lib/match-record.ts';
import type { Side } from '#lib/cs2/rounds.ts';

/** Inventory display name -> [GSI short name, GSI type]. */
const INVENTORY: Record<string, [string, string | null]> = {
	'AK-47': ['ak47', 'Rifle'],
	AUG: ['aug', 'Rifle'],
	FAMAS: ['famas', 'Rifle'],
	'Galil AR': ['galilar', 'Rifle'],
	'M4A1-S': ['m4a1_silencer', 'Rifle'],
	M4A4: ['m4a1', 'Rifle'],
	'SG 553': ['sg556', 'Rifle'],
	AWP: ['awp', 'SniperRifle'],
	'SSG 08': ['ssg08', 'SniperRifle'],
	'SCAR-20': ['scar20', 'SniperRifle'],
	G3SG1: ['g3sg1', 'SniperRifle'],
	'MAC-10': ['mac10', 'Submachine Gun'],
	MP9: ['mp9', 'Submachine Gun'],
	MP7: ['mp7', 'Submachine Gun'],
	'MP5-SD': ['mp5sd', 'Submachine Gun'],
	'UMP-45': ['ump45', 'Submachine Gun'],
	P90: ['p90', 'Submachine Gun'],
	'PP-Bizon': ['bizon', 'Submachine Gun'],
	Nova: ['nova', 'Shotgun'],
	XM1014: ['xm1014', 'Shotgun'],
	'MAG-7': ['mag7', 'Shotgun'],
	'Sawed-Off': ['sawedoff', 'Shotgun'],
	M249: ['m249', 'Machine Gun'],
	Negev: ['negev', 'Machine Gun'],
	'Glock-18': ['glock', 'Pistol'],
	P2000: ['hkp2000', 'Pistol'],
	'USP-S': ['usp_silencer', 'Pistol'],
	P250: ['p250', 'Pistol'],
	'Five-SeveN': ['fiveseven', 'Pistol'],
	'Tec-9': ['tec9', 'Pistol'],
	'CZ75-Auto': ['cz75a', 'Pistol'],
	'Desert Eagle': ['deagle', 'Pistol'],
	'R8 Revolver': ['revolver', 'Pistol'],
	'Dual Berettas': ['elite', 'Pistol'],
	'High Explosive Grenade': ['hegrenade', 'Grenade'],
	Flashbang: ['flashbang', 'Grenade'],
	'Smoke Grenade': ['smokegrenade', 'Grenade'],
	Molotov: ['molotov', 'Grenade'],
	'Incendiary Grenade': ['incgrenade', 'Grenade'],
	'Decoy Grenade': ['decoy', 'Grenade'],
	'C4 Explosive': ['c4', 'C4'],
	// GSI's type for these isn't confirmed; unknown beats a guess.
	'Zeus x27': ['taser', null],
	'Medi-Shot': ['healthshot', null]
};

function inventoryWeapon(display: string): [string, string | null] {
	const known = INVENTORY[display];
	if (known) return known;
	// knife, knife_t and every skin ("Butterfly Knife", "Bayonet").
	if (/knife|bayonet/i.test(display)) return [display === 'knife_t' ? 'knife_t' : 'knife', 'Knife'];
	return [display.toLowerCase().replace(/[^a-z0-9]+/g, '_'), null];
}

/** A demo inventory as GSI weapon snapshots. Grenades of a kind are one entry with a count. */
export function inventoryWeapons(inventory: readonly string[] | null | undefined): WeaponSnap[] {
	const out: WeaponSnap[] = [];
	for (const display of inventory ?? []) {
		const [short, type] = inventoryWeapon(display);
		const name = `weapon_${short}`;
		const grenade = type === 'Grenade';
		const same = grenade ? out.find((w) => w.name === name) : undefined;
		if (same) same.count = (same.count ?? 1) + 1;
		else out.push({ name, type, count: grenade ? 1 : null });
	}
	return out;
}

/** `player_death.weapon` (`ak47`, `inferno`, `knife_butterfly`) as a GSI weapon name. */
export function killWeapon(weapon: string | null | undefined, side: Side | null): string | null {
	if (!weapon) return null;
	if (weapon === 'inferno') return side === 'CT' ? 'weapon_incgrenade' : 'weapon_molotov';
	if (/^knife|bayonet/.test(weapon))
		return weapon === 'knife_t' ? 'weapon_knife_t' : 'weapon_knife';
	return `weapon_${weapon}`;
}
