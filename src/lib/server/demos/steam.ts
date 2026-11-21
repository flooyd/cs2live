// Asks the Steam Game Coordinator for your recent official matches, through the Steam client
// that is running on this PC. Uses boiler-writter (@akiver/boiler-writter, the helper CS Demo
// Manager uses): it starts as app 730 through Steamworks, requests the match list and writes it
// to a file. No password or API key; it answers for whichever account Steam is logged in to.
//
// It only works while CS2 itself is closed: with CS2 open the Game Coordinator answers the game,
// not the helper (exit code 4, checked Nov 2026). While it runs, Steam briefly shows you as
// playing CS2. Node-only.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { decodeMatchList, type GcMatchList } from './gc-match-list.ts';

export type DemoErrorKind =
	'cs2-open' | 'steam-offline' | 'unsupported' | 'not-listed' | 'no-demo' | 'failed';

export class DemoError extends Error {
	readonly kind: DemoErrorKind;
	constructor(kind: DemoErrorKind, message: string, options?: ErrorOptions) {
		super(message, options);
		this.kind = kind;
	}
}

// Held in a variable so bundlers and Vercel's file tracer leave the package alone: it only runs
// on the PC you play on, never on the hosted site.
const BOILER_PACKAGE = '@akiver/boiler-writter/package.json';

/** The boiler-writter executable for this platform, or null when there is none. */
export function boilerPath(): string | null {
	try {
		const pkg = createRequire(import.meta.url).resolve(BOILER_PACKAGE);
		const dir = join(dirname(pkg), 'dist', 'bin', `${process.platform}-${process.arch}`);
		const exe = join(dir, process.platform === 'win32' ? 'boiler-writter.exe' : 'boiler-writter');
		return existsSync(exe) ? exe : null;
	} catch {
		return null;
	}
}

/** boiler-writter's exit codes (BoilerExitCode.h). */
const EXIT_MESSAGES: Record<number, [DemoErrorKind, string]> = {
	1: ['failed', 'The Steam helper crashed.'],
	3: ['failed', 'Could not talk to the Steam Game Coordinator.'],
	4: ['cs2-open', 'CS2 is open. Demos can only be looked up while it is closed.'],
	5: ['steam-offline', 'Steam asked to restart the helper. Is Steam running?'],
	6: ['steam-offline', "Steam isn't running, or nobody is logged in."],
	7: ['steam-offline', 'Steam is in offline mode.'],
	9: ['failed', 'The Steam helper could not write its output file.']
};

/** Your recent official matches, as the Game Coordinator lists them. Throws DemoError. */
export async function recentMatches(workDir: string): Promise<GcMatchList> {
	const exe = boilerPath();
	if (!exe) {
		throw new DemoError(
			'unsupported',
			`The Steam helper has no build for ${process.platform}-${process.arch}.`
		);
	}
	await mkdir(workDir, { recursive: true });
	const out = join(workDir, 'matches.info');
	await rm(out, { force: true });
	const code = await new Promise<number>((resolve) => {
		// Its stdout includes your Steam ID; it is not logged.
		execFile(exe, [out], { cwd: dirname(exe), timeout: 90_000, windowsHide: true }, (err) => {
			if (!err) resolve(0);
			else resolve(typeof err.code === 'number' ? err.code : -1);
		});
	});
	if (code === 8) return { accountId: null, matches: [] };
	if (code !== 0) {
		const [kind, message] = EXIT_MESSAGES[code] ?? [
			'failed',
			code === -1 ? 'The Steam helper did not finish.' : `The Steam helper failed (${code}).`
		];
		throw new DemoError(kind, message);
	}
	try {
		return decodeMatchList(await readFile(out));
	} catch (err) {
		throw new DemoError('failed', 'Could not read the match list from Steam.', { cause: err });
	} finally {
		await rm(out, { force: true });
	}
}

/** Whether the CS2 process is running (Windows and Linux). Null when we cannot tell. */
export function isCs2Running(): Promise<boolean | null> {
	const [cmd, args, match] =
		process.platform === 'win32'
			? ['tasklist', ['/FI', 'IMAGENAME eq cs2.exe', '/NH'], /cs2\.exe/i]
			: process.platform === 'linux'
				? ['pgrep', ['-x', 'cs2'], /\d/]
				: [null, [], /$^/];
	if (!cmd) return Promise.resolve(null);
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, stdout) => {
			// pgrep exits 1 when nothing matches.
			if (err && !(process.platform === 'linux' && err.code === 1)) resolve(null);
			else resolve(match.test(stdout));
		});
	});
}
