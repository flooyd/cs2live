// Guards the Vercel build. Its file tracer (@vercel/nft) treats an absolute path literal that
// reaches fs as a file the server needs and copies it, folders included, into the function
// bundle. A literal Steam path once made `yarn build` copy CS2's game files until the disk was
// full. Build such paths from environment variables at runtime instead (see cs2-paths.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		if (e.isDirectory()) return sourceFiles(path);
		return /\.(ts|js|svelte)$/.test(e.name) && !e.name.endsWith('.spec.ts') ? [path] : [];
	});
}

// 'C:\\...' or "/home/...", "/Users/...", "/Library/..." and friends as string literals.
const ABSOLUTE =
	/['"`](?:[A-Za-z]:\\\\|\/(?:home|Users|Library|opt|var|etc|usr|mnt|Applications)\/)/;

describe('server source', () => {
	it('has no absolute filesystem path literals', () => {
		const hits = sourceFiles('src').flatMap((file) =>
			readFileSync(file, 'utf8')
				.split('\n')
				.map((line, i) => ({ file, line: i + 1, text: line.trim() }))
				.filter((l) => !l.text.startsWith('//') && !l.text.startsWith('*') && ABSOLUTE.test(l.text))
		);
		expect(hits).toEqual([]);
	});
});
