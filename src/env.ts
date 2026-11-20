import { defineEnvVars } from '@sveltejs/kit/env';

/** Empty or missing means "not set". */
const optional = (value: string | undefined) => (value ? value : undefined);
/** `1`, `true`, `yes` and `on` mean true; anything else (or missing) means false. */
const flag = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value ?? '');

export const variables = defineEnvVars({
	DATABASE_URL: {
		description:
			'Neon (or any Postgres) connection string. Set it on the Vercel site, and locally only if this copy should write straight to the database. Friends running CS2Live locally leave it empty and upload through the site instead.',
		schema: optional
	},
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://localhost:5173` or your Vercel URL.',
		schema: optional
	},
	BETTER_AUTH_SECRET: {
		description:
			'Secret used to sign auth tokens. Needed wherever DATABASE_URL is set. Use 32+ random characters.',
		schema: optional
	},
	SIGNUP_ALLOWLIST: {
		description:
			'Comma-separated emails allowed to create an account on the site. `*` opens sign-up to anyone. When empty, only the very first account can sign up.',
		schema: optional
	},
	GSI_TOKEN: {
		description:
			'Shared secret CS2 sends in `auth.token` with every GSI post. `yarn gsi:config` generates one if missing.',
		schema: optional
	},
	GSI_CAPTURE: {
		description: 'Set to 1 to append every GSI payload to an NDJSON file (see fixtures/README.md).',
		schema: flag
	},
	GSI_CAPTURE_DIR: {
		description: 'Where NDJSON captures go. Defaults to `captures`.',
		schema: (value) => value || 'captures'
	},
	LIVE_TRACKING: {
		description:
			'Force live tracking on (1) or off (0). By default it is on everywhere except on Vercel, where serverless functions cannot hold live state.',
		schema: optional
	},
	VERCEL: {
		description: 'Set by Vercel itself. Used to switch off live tracking there.',
		schema: optional
	},
	CS2LIVE_DATA_DIR: {
		description:
			'Local folder for settings, the upload outbox and the generated GSI config. Defaults to `.cs2live`.',
		schema: (value) => value || '.cs2live'
	},
	CS2LIVE_SITE_URL: {
		description:
			'The public CS2Live site that local copies upload matches to, e.g. `https://cs2live.vercel.app`. Can also be set on the /setup page.',
		schema: optional
	},
	CS2LIVE_UPLOAD_KEY: {
		description:
			'Upload key from your account page on the site. Can also be pasted on the /setup page.',
		schema: optional
	},
	STEAM_ID: {
		description:
			'Your SteamID64. Optional: the /setup page asks for it on first run and saves it in CS2LIVE_DATA_DIR.',
		schema: optional
	},
	STORE_RAW_PAYLOADS: {
		description:
			'Set to 1 to also store raw GSI payloads in the raw_payloads table (direct-to-database mode only). Uses a lot of Neon storage; see `yarn db:cleanup`.',
		schema: flag
	},
	INCOMPLETE_TIMEOUT_S: {
		description:
			'Seconds without in-match GSI data before an unfinished match is saved as incomplete. Defaults to 120.',
		schema: (value) => {
			const n = Number(value || 120);
			if (!Number.isFinite(n) || n < 15)
				throw new Error('INCOMPLETE_TIMEOUT_S must be a number >= 15');
			return n;
		}
	}
});
