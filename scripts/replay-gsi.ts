// yarn gsi:replay <file.ndjson> [options]
//
// POSTs a captured (or synthetic) GSI sequence to /api/gsi with its original timing, so the
// live UI and persistence can be tested without launching CS2.
//
//   --speed <n>     play n times faster (default 1)
//   --instant       no waiting at all (round timers become meaningless)
//   --max-gap <s>   cap any single wait at s seconds of real time (default 20)
//   --as <steamid>  replay as this Steam ID (rewrites provider and own player steamid), so a
//                   fixture recorded by someone else is tracked as you
//   --from <n>      skip the first n payloads
//   --url <url>     endpoint (default GSI_URL or http://127.0.0.1:5173/api/gsi)
//   --token <t>     GSI token (default GSI_TOKEN from .env)
import { readFileSync } from 'node:fs';

interface Row {
	t: number;
	p: Record<string, unknown>;
}

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const file = process.argv
	.slice(2)
	.find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!file) {
	console.error('Usage: yarn gsi:replay <file.ndjson> [--speed 10] [--as <steamid>] [--instant]');
	process.exit(1);
}

const url = arg('url') ?? process.env.GSI_URL ?? 'http://127.0.0.1:5173/api/gsi';
const token = arg('token') ?? process.env.GSI_TOKEN;
if (!token) {
	console.error('No GSI token: set GSI_TOKEN in .env (yarn gsi:config makes one) or pass --token.');
	process.exit(1);
}
const speed = Number(arg('speed') ?? 1);
const instant = flag('instant');
const maxGapMs = Number(arg('max-gap') ?? 20) * 1000;
const as = arg('as');
const from = Number(arg('from') ?? 0);

const rows: Row[] = readFileSync(file, 'utf8')
	.split('\n')
	.filter((l) => l.trim())
	.map((l) => JSON.parse(l) as Partial<Row> & { meta?: unknown })
	.filter((r): r is Row => typeof r.t === 'number' && !!r.p)
	.slice(from);

/** Rewrites the recorder's Steam ID (provider + own player block) to `steamId`. */
function rewrite(p: Record<string, unknown>, steamId: string): Record<string, unknown> {
	const provider = p.provider as { steamid?: string } | undefined;
	const original = provider?.steamid;
	const out: Record<string, unknown> = { ...p };
	if (provider) out.provider = { ...provider, steamid: steamId };
	const player = p.player as { steamid?: string } | undefined;
	if (player && player.steamid === original) out.player = { ...player, steamid: steamId };
	return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(
	`Replaying ${rows.length} payloads from ${file} to ${url}` +
		(instant ? ' (instant)' : ` at ${speed}x`)
);
const started = Date.now();
let sent = 0;
let failed = 0;
for (let i = 0; i < rows.length; i++) {
	const row = rows[i];
	if (i > 0 && !instant) {
		const gap = Math.min(maxGapMs, Math.max(0, (row.t - rows[i - 1].t) / speed));
		if (gap > 0) await sleep(gap);
	}
	const payload = { ...(as ? rewrite(row.p, as) : row.p), auth: { token } };
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			failed++;
			if (failed <= 3) console.error(`payload ${i}: HTTP ${res.status} ${await res.text()}`);
		} else sent++;
	} catch (err) {
		console.error(
			`Could not reach ${url}: ${(err as Error).message}. Is yarn dev / yarn live running?`
		);
		process.exit(1);
	}
	if (i % 50 === 0) process.stdout.write(`\r${i + 1}/${rows.length}`);
}
console.log(
	`\rSent ${sent}/${rows.length} payloads in ${((Date.now() - started) / 1000).toFixed(1)} s` +
		(failed ? `, ${failed} failed` : '')
);
