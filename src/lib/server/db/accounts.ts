// Site accounts' Steam ID claims and upload keys (steam_links). No framework imports.
import { eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { players, steamLinks } from './schema.ts';
import { generateUploadKey, hashUploadKey } from '../upload-keys.ts';

export type SteamLink = typeof steamLinks.$inferSelect;

export async function getSteamLink(db: Db, userId: string): Promise<SteamLink | null> {
	const rows = await db.select().from(steamLinks).where(eq(steamLinks.userId, userId));
	return rows[0] ?? null;
}

/** The link an upload key belongs to, or null for an unknown key. */
export async function linkForUploadKey(db: Db, key: string): Promise<SteamLink | null> {
	const rows = await db
		.select()
		.from(steamLinks)
		.where(eq(steamLinks.uploadKeyHash, hashUploadKey(key)));
	return rows[0] ?? null;
}

export type ClaimResult = { ok: true } | { ok: false; reason: 'taken' };

/**
 * Links a Steam ID to an account. First claim wins: Steam ownership is not verified (that would
 * need Steam OpenID), so a Steam ID already claimed by another account is refused.
 */
export async function claimSteamId(db: Db, userId: string, steamId: string): Promise<ClaimResult> {
	return db.transaction(async (tx) => {
		const owner = await tx
			.select({ userId: steamLinks.userId })
			.from(steamLinks)
			.where(eq(steamLinks.steamId, steamId));
		if (owner[0] && owner[0].userId !== userId) return { ok: false, reason: 'taken' } as const;

		await tx.insert(players).values({ steamId }).onConflictDoNothing();
		await tx
			.insert(steamLinks)
			.values({ userId, steamId })
			.onConflictDoUpdate({ target: steamLinks.userId, set: { steamId } });
		return { ok: true } as const;
	});
}

/** Creates (or replaces) the account's upload key. Returns the key; it is not stored. */
export async function rotateUploadKey(db: Db, userId: string): Promise<string | null> {
	const { key, hash, prefix } = generateUploadKey();
	const rows = await db
		.update(steamLinks)
		.set({ uploadKeyHash: hash, uploadKeyPrefix: prefix, keyCreatedAt: new Date() })
		.where(eq(steamLinks.userId, userId))
		.returning({ userId: steamLinks.userId });
	return rows.length ? key : null;
}

export async function revokeUploadKey(db: Db, userId: string) {
	await db
		.update(steamLinks)
		.set({ uploadKeyHash: null, uploadKeyPrefix: null, keyCreatedAt: null })
		.where(eq(steamLinks.userId, userId));
}

export async function touchUpload(db: Db, userId: string) {
	await db
		.update(steamLinks)
		.set({ lastUploadAt: new Date() })
		.where(eq(steamLinks.userId, userId));
}
