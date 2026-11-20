// yarn gsi:fixtures
//
// Regenerates the synthetic fixture sequences in fixtures/synthetic/ from the GSI simulator.
// They follow our *hypothesis* of CS2's GSI feed; real captures (fixtures/real/) win wherever
// they disagree. Deterministic: the same seeds always produce the same files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulateMatch, type SimOptions } from '../src/lib/server/gsi/sim/simulate.ts';

export const SYNTHETIC_FIXTURES: Record<string, { description: string; options: SimOptions }> = {
	'full-match': {
		description: 'Warmup, then a full competitive match on Mirage to gameover.',
		options: { seed: 11, map: 'de_mirage' }
	},
	'mid-match-join': {
		description: 'Joins a match in progress at round 8 (no warmup, scores already set).',
		options: { seed: 12, map: 'de_inferno', joinAtRound: 8 }
	},
	'quit-before-gameover': {
		description: 'Plays 9 rounds, then goes to the main menu and never comes back.',
		options: { seed: 13, map: 'de_nuke', quitAfterRound: 9 }
	},
	'death-spectate': {
		description: 'Dies every round and spectates a teammate until the round ends.',
		options: { seed: 14, map: 'de_ancient', alwaysDie: true }
	},
	overtime: {
		description: 'Regulation ends 12-12 and the match is decided in overtime.',
		options: { seed: 15, map: 'de_dust2', forceOvertime: true }
	},
	reconnect: {
		description: 'Disconnects after round 6 for 5 minutes, then reconnects to the same match.',
		options: { seed: 16, map: 'de_anubis', disconnectAfterRound: 6, reconnectAfterMs: 300_000 }
	},
	wingman: {
		description: 'A Wingman (scrimcomp2v2) match on Vertigo.',
		options: { seed: 17, map: 'de_vertigo', mode: 'scrimcomp2v2' }
	}
};

const outDir = join('fixtures', 'synthetic');
mkdirSync(outDir, { recursive: true });

for (const [name, { description, options }] of Object.entries(SYNTHETIC_FIXTURES)) {
	const frames = simulateMatch(options);
	const meta = {
		meta: {
			synthetic: true,
			description,
			options,
			startedAt: new Date(frames[0].t).toISOString(),
			headers: { 'content-type': 'application/json' }
		}
	};
	const lines = [JSON.stringify(meta), ...frames.map((f) => JSON.stringify({ t: f.t, p: f.p }))];
	writeFileSync(join(outDir, `${name}.ndjson`), lines.join('\n') + '\n');
	console.log(`${name}.ndjson  ${frames.length} payloads  ${description}`);
}
