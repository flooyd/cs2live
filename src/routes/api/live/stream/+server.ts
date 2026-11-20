// Server-Sent Events: pushes the full LiveView on every change, plus a ping every 15 s so
// proxies and the browser keep the connection open. EventSource reconnects on its own.
import type { RequestHandler } from './$types';
import { getRuntime } from '#lib/server/live/index.ts';

const PING_MS = 15_000;

export const GET: RequestHandler = ({ request }) => {
	const rt = getRuntime();
	if (!rt) {
		return Response.json(
			{ message: 'Live tracking only runs on a local copy of CS2Live.' },
			{ status: 404 }
		);
	}

	const encoder = new TextEncoder();
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const write = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					cleanup();
				}
			};
			const send = (view: unknown) => write(`event: state\ndata: ${JSON.stringify(view)}\n\n`);

			write('retry: 2000\n\n');
			send(rt.view());
			const unsubscribe = rt.subscribe(send);
			const ping = setInterval(() => write(`: ping ${Date.now()}\n\n`), PING_MS);

			cleanup = () => {
				if (closed) return;
				closed = true;
				clearInterval(ping);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// Already closed by the client.
				}
			};
			request.signal.addEventListener('abort', cleanup);
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
