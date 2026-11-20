// Server configuration resolved from env. The only place (besides db/auth) that reads
// `$app/env/private`, so pure modules can take plain values instead.
import {
	CS2LIVE_DATA_DIR,
	CS2LIVE_SITE_URL,
	CS2LIVE_UPLOAD_KEY,
	GSI_CAPTURE,
	GSI_CAPTURE_DIR,
	GSI_TOKEN,
	INCOMPLETE_TIMEOUT_S,
	LIVE_TRACKING,
	STEAM_ID,
	STORE_RAW_PAYLOADS,
	VERCEL
} from '$app/env/private';
import { version } from '$app/env';

/** Live tracking needs a long-running process, so it is off on Vercel unless forced. */
export const liveEnabled = LIVE_TRACKING ? /^(1|true|yes|on)$/i.test(LIVE_TRACKING) : !VERCEL;

export const config = {
	gsiToken: GSI_TOKEN ?? null,
	capture: GSI_CAPTURE,
	captureDir: GSI_CAPTURE_DIR,
	dataDir: CS2LIVE_DATA_DIR,
	envSteamId: STEAM_ID ?? null,
	envSiteUrl: CS2LIVE_SITE_URL ?? null,
	envUploadKey: CS2LIVE_UPLOAD_KEY ?? null,
	storeRawPayloads: STORE_RAW_PAYLOADS,
	incompleteTimeoutMs: INCOMPLETE_TIMEOUT_S * 1000,
	appVersion: version
} as const;
