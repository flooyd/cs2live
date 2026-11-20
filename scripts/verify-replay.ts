// yarn verify:replay [fixture.ndjson] [options]
//
// End-to-end check for the verify skill: replays a fixture into a running CS2Live server
// (POST /api/gsi, the same path CS2 uses), then checks the server's database for exactly one
// new match with the right number of rounds.
//
// The server must have live tracking on, write straight to a database (DATABASE_URL), and be
// set to the fixture's Steam ID (or pass --as with the server's Steam ID). Point this script
// at the same database with DATABASE_URL. Use a test database: the replay adds a real match.
//
//   --url <base>     server base URL (default http://127.0.0.1:5173)
//   --rounds <n>     expected rounds (default: the final score in the fixture)
//   --as <steamid>   passed to gsi:replay
//   --speed <n>      replay speed (default: --instant)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const file =
	process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--')) ??
	'fixtures/synthetic/full-match.ndjson';
const base = (arg('url') ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes('@host:port/') || dbUrl.includes('ep-example-')) {
	console.error('Set DATABASE_URL to the database the server writes to (a test database).');
	process.exit(1);
}

/** Rounds in the fixture: the score when it reached gameover (or the last score seen). */
function fixtureRounds(path: string): number {
	let rounds = 0;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line) as { p?: { map?: Record<string, unknown> } };
			const map = row.p?.map;
			if (!map) continue;
			const score = (team: unknown) =>
				Number((team as { score?: unknown } | undefined)?.score ?? 0);
			const total = score(map.team_ct) + score(map.team_t);
			if (Number.isFinite(total) && total > 0) rounds = total;
			if (map.phase === 'gameover') break;
		} catch {
			// meta lines and junk
		}
	}
	return rounds;
}

const expected = Number(arg('rounds') ?? fixtureRounds(file));
const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });

try {
	// Server-side clock, so a skewed local clock can't hide the new match.
	const [{ now }] = await sql<{ now: Date }[]>`select now()`;

	const replayArgs = [
		'--env-file-if-exists=.env',
		'scripts/replay-gsi.ts',
		file,
		'--url',
		`${base}/api/gsi`
	];
	replayArgs.push(...(arg('speed') ? ['--speed', arg('speed')!] : ['--instant']));
	if (arg('as')) replayArgs.push('--as', arg('as')!);
	console.log(`Replaying ${file} into ${base} (expecting one match, ${expected} rounds)…`);
	const code = await new Promise<number | null>((done) => {
		const child = spawn(process.execPath, replayArgs, { stdio: 'inherit' });
		child.on('exit', done);
	});
	if (code !== 0) throw new Error(`gsi:replay exited with ${code}`);

	// The server saves after gameover; give the outbox a moment.
	let found: { id: string; status: string; rounds_played: number; rounds: number }[] = [];
	for (let i = 0; i < 40; i++) {
		found = await sql`
			select m.id, m.status, m.rounds_played,
				(select count(*)::int from rounds r where r.match_id = m.id) as rounds
			from matches m where m.created_at >= ${now}`;
		if (found.length) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	// A late duplicate would show up just after the first save.
	await new Promise((r) => setTimeout(r, 1500));
	found = await sql`
		select m.id, m.status, m.rounds_played,
			(select count(*)::int from rounds r where r.match_id = m.id) as rounds
		from matches m where m.created_at >= ${now}`;

	const problems: string[] = [];
	if (found.length !== 1) problems.push(`expected 1 new match, found ${found.length}`);
	const m = found[0];
	if (m) {
		if (m.status !== 'complete') problems.push(`status is ${m.status}, expected complete`);
		if (m.rounds_played !== expected)
			problems.push(`rounds_played ${m.rounds_played} ≠ ${expected}`);
		if (m.rounds !== expected) problems.push(`${m.rounds} round rows ≠ ${expected}`);
	}
	if (problems.length) {
		console.error(`✗ verify:replay failed: ${problems.join('; ')}`);
		if (!found.length) {
			console.error(
				'  No match was saved. Is live tracking on, the Steam ID set (or --as given), and the server using this DATABASE_URL?'
			);
		}
		process.exitCode = 1;
	} else {
		console.log(`✓ one complete match saved (${m.id}) with ${expected} rounds`);
	}
} finally {
	await sql.end();
}
