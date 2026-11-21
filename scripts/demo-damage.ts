// yarn demo:damage <demo.dem | latest> <steamid64>
//
// Prints a player's damage per round and ADR from a CS2 demo, the way CS2Live reads it for
// matches (enemies only, each hit capped at the victim's remaining health). `latest` takes the
// newest demo in CS2's replays folder. Handy for checking the numbers against the scoreboard.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cs2ReplaysDir, parseDemo } from '../src/lib/server/demos/demo-file.ts';

const [arg, steamId] = process.argv.slice(2);
if (!arg || !steamId || !/^\d{17}$/.test(steamId)) {
	console.error('Usage: yarn demo:damage <demo.dem | latest> <steamid64>');
	process.exit(2);
}

let file = arg;
if (arg === 'latest') {
	const dir = cs2ReplaysDir();
	const demos = dir
		? readdirSync(dir)
				.filter((n) => n.endsWith('.dem'))
				.map((n) => join(dir, n))
				.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
		: [];
	if (!demos[0]) {
		console.error('No demos in CS2’s replays folder.');
		process.exit(1);
	}
	file = demos[0];
}

const started = Date.now();
const demo = parseDemo(file, steamId);
console.log(
	`${demo.map ?? 'unknown map'}, ${demo.rounds} rounds (read in ${Date.now() - started} ms)`
);
if (!demo.present) {
	console.error('That Steam ID is not in this demo.');
	process.exit(1);
}
const rows = [...demo.damage].sort(([a], [b]) => a - b);
for (const [round, damage] of rows) console.log(`  round ${String(round).padStart(2)}  ${damage}`);
const total = rows.reduce((n, [, d]) => n + d, 0);
console.log(`total ${total}, ADR ${(total / Math.max(1, rows.length)).toFixed(1)}`);
