// Weapon names and categories. Pure, works in the browser too.

const DISPLAY: Record<string, string> = {
	ak47: 'AK-47',
	m4a1: 'M4A4',
	m4a1_silencer: 'M4A1-S',
	awp: 'AWP',
	ssg08: 'SSG 08',
	aug: 'AUG',
	sg556: 'SG 553',
	famas: 'FAMAS',
	galilar: 'Galil AR',
	scar20: 'SCAR-20',
	g3sg1: 'G3SG1',
	mp9: 'MP9',
	mac10: 'MAC-10',
	mp7: 'MP7',
	mp5sd: 'MP5-SD',
	ump45: 'UMP-45',
	p90: 'P90',
	bizon: 'PP-Bizon',
	nova: 'Nova',
	xm1014: 'XM1014',
	mag7: 'MAG-7',
	sawedoff: 'Sawed-Off',
	m249: 'M249',
	negev: 'Negev',
	glock: 'Glock-18',
	hkp2000: 'P2000',
	usp_silencer: 'USP-S',
	p250: 'P250',
	fiveseven: 'Five-SeveN',
	tec9: 'Tec-9',
	cz75a: 'CZ75-Auto',
	deagle: 'Desert Eagle',
	revolver: 'R8 Revolver',
	elite: 'Dual Berettas',
	taser: 'Zeus x27',
	hegrenade: 'HE Grenade',
	flashbang: 'Flashbang',
	smokegrenade: 'Smoke',
	molotov: 'Molotov',
	incgrenade: 'Incendiary',
	decoy: 'Decoy',
	c4: 'C4',
	knife: 'Knife',
	knife_t: 'Knife',
	healthshot: 'Medi-Shot'
};

/** `weapon_ak47` -> `ak47` */
export function shortWeaponName(name: string | undefined | null): string {
	return (name ?? '').replace(/^weapon_/, '');
}

export function weaponLabel(name: string | undefined | null): string {
	const short = shortWeaponName(name);
	if (!short) return '—';
	if (short.startsWith('knife') || short === 'bayonet') return 'Knife';
	return DISPLAY[short] ?? short.replace(/_/g, ' ');
}

/** GSI weapon `type` values that count as a primary weapon. */
const PRIMARY_TYPES = new Set(['Rifle', 'SniperRifle', 'Submachine Gun', 'Shotgun', 'Machine Gun']);

export function isPrimaryType(type: string | undefined): boolean {
	return PRIMARY_TYPES.has(type ?? '');
}

export function isGrenadeType(type: string | undefined): boolean {
	return type === 'Grenade';
}

/** Short grenade code for compact display. */
export function grenadeIcon(name: string | undefined): string {
	switch (shortWeaponName(name)) {
		case 'hegrenade':
			return 'HE';
		case 'flashbang':
			return 'FL';
		case 'smokegrenade':
			return 'SM';
		case 'molotov':
		case 'incgrenade':
			return 'MO';
		case 'decoy':
			return 'DE';
		default:
			return '?';
	}
}
