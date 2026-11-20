// Finds the CS2 cfg folder on this machine. Plain Node, no framework imports.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CS2_CFG = join(
	'steamapps',
	'common',
	'Counter-Strike Global Offensive',
	'game',
	'csgo',
	'cfg'
);

const DEFAULT_STEAM_ROOTS = [
	'C:\\Program Files (x86)\\Steam',
	'C:\\Program Files\\Steam',
	join(process.env.HOME ?? '', '.steam', 'steam'),
	join(process.env.HOME ?? '', '.local', 'share', 'Steam'),
	join(process.env.HOME ?? '', 'Library', 'Application Support', 'Steam')
];

/** Library folder paths listed in Steam's libraryfolders.vdf (games can live on other drives). */
export function steamLibraries(steamRoot: string): string[] {
	const vdf = join(steamRoot, 'steamapps', 'libraryfolders.vdf');
	if (!existsSync(vdf)) return [steamRoot];
	const text = readFileSync(vdf, 'utf8');
	const paths = [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'));
	return [steamRoot, ...paths];
}

/** The CS2 cfg folder, or null if it cannot be found. CS2_CFG_DIR overrides the search. */
export function findCs2CfgDir(): string | null {
	const override = process.env.CS2_CFG_DIR;
	if (override) return existsSync(override) ? override : null;
	for (const root of DEFAULT_STEAM_ROOTS) {
		if (!existsSync(root)) continue;
		for (const lib of steamLibraries(root)) {
			const dir = join(lib, CS2_CFG);
			if (existsSync(dir)) return dir;
		}
	}
	return null;
}
