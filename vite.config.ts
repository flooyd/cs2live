import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import vercelAdapter from '@sveltejs/adapter-vercel';
import nodeAdapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

// Two build targets from one codebase:
// - Vercel (default): history, match pages, stats and the upload API. Serverless functions
//   cannot hold the in-memory live state or a long-lived SSE stream, so live tracking is off there.
// - Node (`CS2LIVE_ADAPTER=node`, used by `yarn live`): a long-running local server that receives
//   CS2's GSI posts and streams live state to /live and /overlay.
const adapter =
	process.env.CS2LIVE_ADAPTER === 'node' ? nodeAdapter({ out: 'build' }) : vercelAdapter();

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter
		})
	],
	server: {
		// CS2 posts to 127.0.0.1; keep the dev server on the same port `yarn gsi:config` writes.
		port: 5173,
		strictPort: true
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
