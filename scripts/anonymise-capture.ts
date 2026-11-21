// yarn gsi:anonymise <capture.ndjson> <out.ndjson> [options]
//
// Turns a real GSI capture into a fixture that is safe to commit:
//   - every SteamID64 (values and allplayers keys) becomes a fake one, consistently, so the
//     recorder and each spectated player keep their identity across payloads;
//   - player names become "Player 1", "Player 2", ... (the recorder is always "Player 1"), and
//     clan tags are blanked;
//   - auth blocks and sensitive request headers are dropped.
// Map, scores, rounds, weapons and stats are kept as they are: that is what fixtures are for.
//
//   --from <n>      keep payloads from index n (0-based, meta line not counted)
//   --to <n>        ...up to and including index n
//   --keep-names    keep player names (only for captures that stay private)
//
// Fake IDs start at fakeSteamId(100), clear of the simulator's (1-99).
import { readFileSync, writeFileSync } from 'node:fs';
import { fakeSteamId } from '../src/lib/cs2/steamid.ts';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const [input, output] = process.argv
	.slice(2)
	.filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.match(/^--(from|to)$/));
if (!input || !output) {
	console.error('Usage: yarn gsi:anonymise <capture.ndjson> <out.ndjson> [--from n] [--to n]');
	process.exit(1);
}
const from = Number(arg('from') ?? 0);
const to = Number(arg('to') ?? Infinity);
const keepNames = process.argv.includes('--keep-names');

const STEAM_ID = /^7656\d{13}$/;
const ids = new Map<string, string>();
const names = new Map<string, string>();

function fakeId(real: string): string {
	let id = ids.get(real);
	if (!id) ids.set(real, (id = fakeSteamId(100 + ids.size)));
	return id;
}

function fakeName(real: string): string {
	if (keepNames) return real;
	let name = names.get(real);
	if (!name) names.set(real, (name = `Player ${names.size + 1}`));
	return name;
}

const DROP_KEYS = new Set(['auth', 'token']);
const DROP_HEADERS = /^(authorization|cookie|x-forwarded-for|forwarded|x-real-ip)$/i;

/**
 * `key` is this value's key, `parentKey` its parent's. Only player objects (`player`, and each
 * entry of `allplayers`, also inside `previously` / `added`) have a player name: `map.name` and
 * weapon `name`s must stay as they are.
 */
function clean(value: unknown, key = '', parentKey = ''): unknown {
	if (typeof value === 'string') return STEAM_ID.test(value) ? fakeId(value) : value;
	if (Array.isArray(value)) return value.map((v) => clean(v));
	if (value && typeof value === 'object') {
		const isPlayer = key === 'player' || parentKey === 'allplayers';
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (DROP_KEYS.has(k)) continue;
			if (key === 'headers' && DROP_HEADERS.test(k)) continue;
			const outKey = STEAM_ID.test(k) ? fakeId(k) : k;
			if (isPlayer && typeof v === 'string' && k === 'name') out[outKey] = fakeName(v);
			// CS2 sends your clan tag in every player block; it identifies you as well as a name.
			else if (isPlayer && typeof v === 'string' && k === 'clan') out[outKey] = keepNames ? v : '';
			else out[outKey] = clean(v, k, key);
		}
		return out;
	}
	return value;
}

const lines = readFileSync(input, 'utf8')
	.split('\n')
	.filter((l) => l.trim());
const out: string[] = [];
let index = -1;
let kept = 0;
let skipped = 0;

for (const line of lines) {
	let row: Record<string, unknown>;
	try {
		row = JSON.parse(line) as Record<string, unknown>;
	} catch {
		skipped++;
		continue;
	}
	if ('meta' in row) {
		const meta = clean(row.meta) as Record<string, unknown>;
		out.push(JSON.stringify({ meta: { ...meta, anonymised: true, source: undefined } }));
		continue;
	}
	index++;
	if (index < from || index > to) continue;
	// The recorder gets the first fake ID and "Player 1" even if a teammate appears first.
	const provider = (row.p as { provider?: { steamid?: unknown } } | undefined)?.provider;
	if (typeof provider?.steamid === 'string') fakeId(provider.steamid);
	const player = (row.p as { player?: { steamid?: unknown; name?: unknown } } | undefined)?.player;
	if (player?.steamid === provider?.steamid && typeof player?.name === 'string') {
		fakeName(player.name);
	}
	out.push(JSON.stringify(clean(row)));
	kept++;
}

writeFileSync(output, out.join('\n') + '\n');
console.log(
	`Wrote ${kept} payloads to ${output} (${ids.size} Steam IDs and ${keepNames ? 'no' : names.size} names replaced${skipped ? `, ${skipped} unreadable lines skipped` : ''}).`
);
