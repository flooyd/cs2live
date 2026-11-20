// Wires the outbox to its target: the database when this copy has DATABASE_URL (the site
// owner), otherwise the site's upload API with the key from /setup.
import { join } from 'node:path';
import { getDb } from '../db/index.ts';
import { persistMatch, RecorderMismatchError } from '../db/persist.ts';
import type { SettingsFile } from '../live/settings.ts';
import { Outbox, PermanentSyncError, uploadTarget, type SyncTarget } from './outbox.ts';

export function createOutbox(dataDir: string, settings: SettingsFile, onChange: () => void) {
	const resolveTarget = (): SyncTarget | null => {
		const db = getDb();
		if (db) {
			return {
				mode: 'direct',
				label: 'database',
				send: (record) =>
					persistMatch(db, record).catch((err: unknown) => {
						if (err instanceof RecorderMismatchError) {
							throw new PermanentSyncError(err.message, { cause: err });
						}
						throw err;
					})
			};
		}
		const { siteUrl, uploadKey } = settings.get();
		if (siteUrl && uploadKey) return uploadTarget(siteUrl, uploadKey);
		return null;
	};
	return new Outbox(join(dataDir, 'outbox'), resolveTarget, onChange);
}
