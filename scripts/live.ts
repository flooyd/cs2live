// yarn live [--no-build]
//
// Builds CS2Live with adapter-node and runs it as a long-lived local server, which is what live
// tracking needs (in-memory match state plus an SSE stream). `yarn dev` works too; this is the
// faster, steadier option while you play.
//
// It wraps the adapter-node handler in a tiny server of our own for one reason: SvelteKit
// rejects cross-site POSTs that have no Content-Type header (its CSRF guard), and game clients do
// not send an Origin header. If CS2 ever posts without a Content-Type, every GSI update would
// get a 403. We give /api/gsi requests a JSON content type when they arrive without one.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = new Set(process.argv.slice(2));
const port = Number(process.env.PORT || 5173);
// Local only by default. Set HOST=0.0.0.0 to open /live from another device on your network
// (anyone on that network could then also open /setup).
const host = process.env.HOST || '127.0.0.1';

if (!args.has('--no-build')) {
	console.log('Building CS2Live for local live tracking (adapter-node)...');
	const vite = resolve('node_modules', 'vite', 'bin', 'vite.js');
	const result = spawnSync(process.execPath, [vite, 'build'], {
		stdio: 'inherit',
		env: { ...process.env, CS2LIVE_ADAPTER: 'node' }
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const handlerPath = resolve('build', 'handler.js');
if (!existsSync(handlerPath)) {
	console.error('No build found. Run `yarn live` without --no-build first.');
	process.exit(1);
}

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;
const { handler } = (await import(pathToFileURL(handlerPath).href)) as { handler: NodeHandler };

const server = createServer((req, res) => {
	if (req.url?.startsWith('/api/gsi') && !req.headers['content-type']) {
		req.headers['content-type'] = 'application/json';
	}
	handler(req, res);
});

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		console.error(
			`Port ${port} is already in use. Is \`yarn dev\` (or another \`yarn live\`) running?`
		);
	} else {
		console.error(err);
	}
	process.exit(1);
});

server.listen(port, host, () => {
	console.log(`\nCS2Live is running at http://localhost:${port}`);
	console.log(`  live view:  http://localhost:${port}/live`);
	console.log(`  overlay:    http://localhost:${port}/overlay`);
	console.log(`  GSI posts:  http://127.0.0.1:${port}/api/gsi\n`);
});

const shutdown = () => {
	server.close();
	server.closeAllConnections();
	// Give the app a moment to flush the upload outbox (see src/lib/server/live).
	setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
