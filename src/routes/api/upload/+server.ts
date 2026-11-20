import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/index.ts';
import { checkUploadKey, MAX_UPLOAD_BYTES, receiveUpload } from '#lib/server/sync/receive.ts';

// Local copies of CS2Live POST finished matches here with their upload key. See
// src/lib/server/sync/receive.ts for the checks.

const noDb = () =>
	Response.json(
		{ message: 'This CS2Live server has no database, so it cannot take uploads.' },
		{ status: 404 }
	);

export const GET: RequestHandler = async ({ request }) => {
	const db = getDb();
	if (!db) return noDb();
	const r = await checkUploadKey(db, request.headers.get('authorization'));
	return Response.json(r.body, { status: r.status });
};

export const POST: RequestHandler = async ({ request }) => {
	const db = getDb();
	if (!db) return noDb();
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_UPLOAD_BYTES) {
		return Response.json({ message: 'Match record too large.' }, { status: 413 });
	}
	try {
		const r = await receiveUpload(db, request.headers.get('authorization'), await request.text());
		return Response.json(r.body, { status: r.status });
	} catch (err) {
		console.error('[upload] failed:', err);
		return Response.json(
			{ message: 'Could not save the match. Try again later.' },
			{ status: 500 }
		);
	}
};
