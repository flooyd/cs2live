// The process-wide live runtime. Kept on globalThis so Vite's dev-server module reloads do not
// throw away the match in progress.
import { config, liveEnabled } from '../config.ts';
import { LiveRuntime } from './runtime.ts';
import { SettingsFile } from './settings.ts';
import { createOutbox } from '../sync/index.ts';

const TICK_MS = 5000;

type Global = typeof globalThis & { __cs2liveRuntime?: LiveRuntime };

function create(): LiveRuntime {
	const settings = new SettingsFile(config.dataDir, {
		steamId: config.envSteamId,
		siteUrl: config.envSiteUrl,
		uploadKey: config.envUploadKey
	});
	const rt = new LiveRuntime({
		settings,
		gsiToken: config.gsiToken,
		capture: config.capture,
		captureDir: config.captureDir,
		incompleteTimeoutMs: config.incompleteTimeoutMs,
		appVersion: config.appVersion
	});
	rt.sink = createOutbox(config.dataDir, settings, () => rt.broadcast());
	setInterval(() => rt.tick(Date.now()), TICK_MS).unref();
	if (!config.gsiToken) {
		console.warn('[live] GSI_TOKEN is not set; run `yarn gsi:config` and restart.');
	}
	return rt;
}

/** The live runtime, or null where live tracking is off (Vercel). */
export function getRuntime(): LiveRuntime | null {
	if (!liveEnabled) return null;
	const g = globalThis as Global;
	g.__cs2liveRuntime ??= create();
	return g.__cs2liveRuntime;
}
