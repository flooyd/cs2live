// The site's side of uploads: checks the key, validates the MatchRecord and saves it. Kept out
// of the route so it can be tested against a real database. No framework imports.
import type { Db } from '../db/client.ts';
import { linkForUploadKey, touchUpload, type SteamLink } from '../db/accounts.ts';
import { persistMatch, RecorderMismatchError } from '../db/persist.ts';
import { bearerToken } from '../upload-keys.ts';
import { matchRecordSchema } from '#lib/match-record.ts';

/** A finished match is a few hundred KB at most; refuse anything far larger. */
export const MAX_UPLOAD_BYTES = 3_000_000;

export interface UploadReply {
	status: number;
	body: { message: string; [key: string]: unknown };
}

const reply = (
	status: number,
	message: string,
	extra: Record<string, unknown> = {}
): UploadReply => ({
	status,
	body: { message, ...extra }
});

type Auth = { ok: true; link: SteamLink } | { ok: false; reply: UploadReply };

async function authenticate(db: Db, authorization: string | null): Promise<Auth> {
	const key = bearerToken(authorization);
	if (!key) {
		return { ok: false, reply: reply(401, 'Missing upload key (Authorization: Bearer <key>).') };
	}
	const link = await linkForUploadKey(db, key);
	if (!link) {
		return {
			ok: false,
			reply: reply(401, 'Unknown upload key. Create a new one on your account page.')
		};
	}
	return { ok: true, link };
}

/** GET /api/upload: lets the Setup page test a key. */
export async function checkUploadKey(db: Db, authorization: string | null): Promise<UploadReply> {
	const auth = await authenticate(db, authorization);
	if (!auth.ok) return auth.reply;
	return reply(200, 'Key OK.', { steamId: auth.link.steamId });
}

/** POST /api/upload: saves one MatchRecord. */
export async function receiveUpload(
	db: Db,
	authorization: string | null,
	body: string
): Promise<UploadReply> {
	const auth = await authenticate(db, authorization);
	if (!auth.ok) return auth.reply;
	if (body.length > MAX_UPLOAD_BYTES) return reply(413, 'Match record too large.');

	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return reply(400, 'Body is not valid JSON.');
	}
	const parsed = matchRecordSchema.safeParse(json);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
		return reply(400, `Invalid match record${where}: ${issue?.message ?? 'unknown error'}`);
	}
	const record = parsed.data;
	if (record.recorderSteamId !== auth.link.steamId) {
		return reply(
			403,
			`This key belongs to Steam ID ${auth.link.steamId}, but the match was recorded by ${record.recorderSteamId}.`
		);
	}

	try {
		await persistMatch(db, record, 'upload');
	} catch (err) {
		if (err instanceof RecorderMismatchError) return reply(409, err.message);
		throw err;
	}
	await touchUpload(db, auth.link.userId);
	return reply(200, 'Saved.', { id: record.id });
}
