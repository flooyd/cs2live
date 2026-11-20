import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getRuntime } from '#lib/server/live/index.ts';
import { hasDb } from '#lib/server/db/index.ts';
import { config } from '#lib/server/config.ts';
import { findCs2CfgDir } from '#lib/server/gsi/cs2-paths.ts';
import { GSI_CONFIG_FILENAME, readGsiConfig } from '#lib/server/gsi/gsi-template.ts';
import { parseSteamId } from '#lib/cs2/steamid.ts';

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

function gsiStatus(token: string | null) {
	const dir = findCs2CfgDir();
	const file = dir ? join(dir, GSI_CONFIG_FILENAME) : null;
	let installed = false;
	let cfg: { uri: string | null; token: string | null } | null = null;
	try {
		installed = !!file && existsSync(file);
		if (installed) cfg = readGsiConfig(readFileSync(file!, 'utf8'));
	} catch {
		// Unreadable; report as not installed.
	}
	return {
		tokenConfigured: !!token,
		cfgDir: dir,
		installed,
		uri: cfg?.uri ?? null,
		tokenMatches: !!token && cfg?.token === token
	};
}

export const load: PageServerLoad = () => {
	const rt = getRuntime();
	if (!rt) return { liveEnabled: false as const };
	const settings = rt.settings.get();
	const view = rt.view();
	return {
		liveEnabled: true as const,
		steamId: settings.steamId,
		siteUrl: settings.siteUrl,
		uploadKeyHint: settings.uploadKey ? `${settings.uploadKey.slice(0, 10)}…` : null,
		locked: rt.settings.locked(),
		provider: view.connection.providerSteamId
			? { steamId: view.connection.providerSteamId, name: view.connection.providerName }
			: null,
		lastPayloadAt: view.connection.lastPayloadAt,
		sync: view.setup.sync,
		gsi: gsiStatus(rt.gsiToken),
		hasDb,
		capture: config.capture,
		captureDir: config.captureDir
	};
};

export const actions: Actions = {
	steamId: async ({ request }) => {
		const rt = getRuntime();
		if (!rt) return fail(404, { steamIdError: 'Live tracking is not available here.' });
		const form = await request.formData();
		const parsed = parseSteamId(text(form.get('steamId')));
		if (!parsed.ok) {
			const steamIdError =
				parsed.reason === 'vanity'
					? `"${parsed.vanity}" is a custom profile name. Use your SteamID64 or /profiles/ link instead.`
					: parsed.reason === 'empty'
						? 'Enter your Steam ID.'
						: "That doesn't look like a Steam ID.";
			return fail(400, { steamIdError });
		}
		rt.setSteamId(parsed.steamId);
		const to = text(form.get('redirectTo'));
		if (to.startsWith('/') && !to.startsWith('//')) redirect(303, to);
		return { steamIdSaved: parsed.steamId };
	},

	sync: async ({ request }) => {
		const rt = getRuntime();
		if (!rt) return fail(404, { syncError: 'Live tracking is not available here.' });
		const form = await request.formData();
		const siteUrl = text(form.get('siteUrl')).replace(/\/+$/, '');
		const uploadKey = text(form.get('uploadKey'));
		if (siteUrl && !/^https?:\/\/[^\s/]+/.test(siteUrl)) {
			return fail(400, { syncError: 'The site URL should start with https://' });
		}
		const patch: { siteUrl: string | null; uploadKey?: string | null } = {
			siteUrl: siteUrl || null
		};
		// An empty key field keeps the saved key; "forget" clears it explicitly.
		if (uploadKey) patch.uploadKey = uploadKey;
		if (form.get('forgetKey')) patch.uploadKey = null;
		rt.settings.save(patch);
		void rt.sink.flush();
		rt.broadcast();
		return { syncSaved: true };
	},

	testUpload: async () => {
		const rt = getRuntime();
		if (!rt) return fail(404, { testError: 'Live tracking is not available here.' });
		const { siteUrl, uploadKey, steamId } = rt.settings.get();
		if (!siteUrl || !uploadKey)
			return fail(400, { testError: 'Save a site URL and upload key first.' });
		try {
			const res = await fetch(`${siteUrl}/api/upload`, {
				headers: { authorization: `Bearer ${uploadKey}` },
				signal: AbortSignal.timeout(10_000)
			});
			const body = (await res.json().catch(() => ({}))) as { steamId?: string; message?: string };
			if (!res.ok)
				return fail(400, { testError: body.message ?? `The site answered ${res.status}.` });
			if (steamId && body.steamId !== steamId) {
				return fail(400, {
					testError: `This key belongs to Steam ID ${body.steamId}, but this copy tracks ${steamId}. Uploads would be rejected.`
				});
			}
			return { testOk: `Key works for Steam ID ${body.steamId}.` };
		} catch (err) {
			return fail(400, { testError: `Could not reach ${siteUrl}: ${(err as Error).message}` });
		}
	}
};
