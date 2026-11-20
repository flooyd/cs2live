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

/**
 * Where Steam usually lives, built from environment variables at runtime.
 *
 * Never write these as absolute path literals ('C:\Program Files (x86)\Steam'): Vercel's file
 * tracer (@vercel/nft) reads a literal path passed to fs as a file the server needs and copies
 * the whole folder, CS2's game files included, into the build until the disk is full. The
 * tracer cannot see environment variables, so this stays out of the bundle.
 */
function defaultSteamRoots(): string[] {
	const roots: string[] = [];
	for (const programFiles of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
		if (programFiles) roots.push(join(programFiles, 'Steam'));
	}
	const home = process.env.HOME ?? process.env.USERPROFILE;
	if (home) {
		roots.push(
			join(home, '.steam', 'steam'),
			join(home, '.local', 'share', 'Steam'),
			join(home, 'Library', 'Application Support', 'Steam')
		);
	}
	return roots;
}

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
	for (const root of defaultSteamRoots()) {
		if (!existsSync(root)) continue;
		for (const lib of steamLibraries(root)) {
			const dir = join(lib, CS2_CFG);
			if (existsSync(dir)) return dir;
		}
	}
	return null;
}
