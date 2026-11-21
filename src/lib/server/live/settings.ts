// Local settings, saved as JSON in CS2LIVE_DATA_DIR/settings.json. Node-only, no framework
// imports. The /setup page writes them; env vars (STEAM_ID, CS2LIVE_SITE_URL,
// CS2LIVE_UPLOAD_KEY) override what is saved.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface LocalSettings {
	steamId: string | null;
	siteUrl: string | null;
	uploadKey: string | null;
	/** Fill in damage from official match demos after the game (on unless turned off). */
	demoDamage: boolean;
}

export interface SettingsOverrides {
	steamId: string | null;
	siteUrl: string | null;
	uploadKey: string | null;
}

const EMPTY: LocalSettings = { steamId: null, siteUrl: null, uploadKey: null, demoDamage: true };

export class SettingsFile {
	private path: string;
	private overrides: SettingsOverrides;
	private saved: LocalSettings;

	constructor(dataDir: string, overrides: SettingsOverrides) {
		this.path = join(dataDir, 'settings.json');
		this.overrides = overrides;
		this.saved = this.read();
	}

	private read(): LocalSettings {
		try {
			if (!existsSync(this.path)) return { ...EMPTY };
			const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<LocalSettings>;
			return {
				steamId: typeof raw.steamId === 'string' ? raw.steamId : null,
				siteUrl: typeof raw.siteUrl === 'string' ? raw.siteUrl : null,
				uploadKey: typeof raw.uploadKey === 'string' ? raw.uploadKey : null,
				demoDamage: typeof raw.demoDamage === 'boolean' ? raw.demoDamage : true
			};
		} catch (err) {
			console.error(`[settings] could not read ${this.path}:`, err);
			return { ...EMPTY };
		}
	}

	/** Effective settings: env overrides win over saved values. */
	get(): LocalSettings {
		return {
			steamId: this.overrides.steamId ?? this.saved.steamId,
			siteUrl: (this.overrides.siteUrl ?? this.saved.siteUrl)?.replace(/\/+$/, '') ?? null,
			uploadKey: this.overrides.uploadKey ?? this.saved.uploadKey,
			demoDamage: this.saved.demoDamage
		};
	}

	/** Which fields are fixed by env vars (the UI shows them read-only). */
	locked(): Record<keyof LocalSettings, boolean> {
		return {
			steamId: this.overrides.steamId !== null,
			siteUrl: this.overrides.siteUrl !== null,
			uploadKey: this.overrides.uploadKey !== null,
			demoDamage: false
		};
	}

	save(patch: Partial<LocalSettings>): LocalSettings {
		this.saved = { ...this.saved, ...patch };
		mkdirSync(dirname(this.path), { recursive: true });
		const tmp = this.path + '.tmp';
		writeFileSync(tmp, JSON.stringify(this.saved, null, '\t') + '\n');
		renameSync(tmp, this.path);
		return this.get();
	}
}
