// CS2 posts Game State Integration updates here (up to ~10 per second while playing).
// Auth is the GSI token only (no session). Respond fast: CS2 waits on slow responses and
// retries. All work is in-memory; saving a finished match happens in the background outbox.
import type { RequestHandler } from './$types';
import { getRuntime } from '#lib/server/live/index.ts';
import { authToken, ingest, tokenMatches } from '#lib/server/gsi/ingest.ts';

const CAPTURED_HEADERS = ['content-type', 'user-agent', 'content-length'];

export const POST: RequestHandler = async ({ request }) => {
	const rt = getRuntime();
	if (!rt) {
		return Response.json(
			{ message: 'Live tracking only runs on a local copy of CS2Live.' },
			{ status: 404 }
		);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(await request.text());
	} catch {
		return Response.json({ message: 'Body is not JSON.' }, { status: 400 });
	}

	if (!tokenMatches(rt.gsiToken, authToken(raw))) {
		return Response.json({ message: 'Bad or missing GSI token.' }, { status: 401 });
	}

	const headers: Record<string, string> = {};
	for (const h of CAPTURED_HEADERS) {
		const v = request.headers.get(h);
		if (v !== null) headers[h] = v;
	}
	ingest(rt, raw, Date.now(), headers);
	return new Response(null, { status: 200 });
};
