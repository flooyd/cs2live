// Upload keys: what a friend's local copy sends to the site to prove which Steam ID it uploads
// for. Only a SHA-256 hash is stored; the key is shown once when created. No framework imports.
import { createHash, randomBytes } from 'node:crypto';

export const UPLOAD_KEY_PREFIX = 'cs2l_';
/** How much of the key the account page shows to identify it ("cs2l_AbC12"). */
const VISIBLE_CHARS = 10;

export function generateUploadKey() {
	const key = UPLOAD_KEY_PREFIX + randomBytes(24).toString('base64url');
	return { key, hash: hashUploadKey(key), prefix: key.slice(0, VISIBLE_CHARS) };
}

export function hashUploadKey(key: string): string {
	return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** The token from an `Authorization: Bearer <key>` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
	const m = header?.match(/^Bearer\s+(\S+)\s*$/i);
	return m ? m[1] : null;
}
