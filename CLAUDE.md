# CS2Live — notes for Claude

CS2 Game State Integration (GSI) tracker. The original brief is `cs2-tracker-prompt.md`; the
user changed it in one important way: **multi-user**. Friends run CS2Live locally and upload
finished matches to the Vercel site with a per-user upload key; anyone can look up a Steam ID
on the public site, which also shows _partial sightings_ (teammates spectated while dead).

## Stack

SvelteKit **3** (not 2), Svelte 5 runes, TypeScript 6, yarn 1, drizzle-orm + postgres.js
(Neon), better-auth, zod 4, Vitest. Kit 3 differences that matter here:

- Imports use `#lib/...` **with file extensions** (`#lib/server/db/index.ts`), not `$lib`.
- Env vars are declared in `src/env.ts` (`defineEnvVars`) and imported from
  `$app/env/private` / `$app/env/public`. `$app/env` has `building`, `dev`, `browser`.
- Hook types come from `@sveltejs/kit/hooks`. Use `Response.json(...)`, not `json()`.
- No `svelte.config.js`; adapter and kit options live in `vite.config.ts`.
- In production SvelteKit rejects POSTs with no Content-Type and no matching Origin (CSRF).
  `scripts/live.ts` patches the Content-Type for `/api/gsi` in case CS2 omits it.

## Local vs Vercel

- `CS2LIVE_ADAPTER=node` selects adapter-node (`yarn live` does this); default is Vercel.
- Live tracking (`/api/gsi`, `/api/live/stream`, `/live`, `/overlay`, `/setup`) runs only
  where `LIVE_TRACKING` resolves on: by default everywhere except Vercel (`VERCEL` env set).
- `DATABASE_URL` is optional. Without it there is no database and no better-auth; the local
  copy uploads to `CS2LIVE_SITE_URL` instead. `getDb()` / `getAuth()` return `null` then.

## Commands

`yarn dev`, `yarn live`, `yarn build`, `yarn run check` (never `yarn check`), `yarn lint`,
`yarn test`, `yarn gsi:config [--install]`, `yarn db:generate`, `yarn db:migrate`.
Scripts in `scripts/` are plain Node TypeScript (type stripping): use only erasable syntax
(no enums, no parameter properties) and import relative files with `.ts` extensions.

## Conventions

- Keep pure logic (GSI parsing, match state machine, round building, stat math) free of
  framework imports so it is unit-testable: no `$app/*` in `src/lib/gsi/` or `src/lib/stats/`.
- Never trust a GSI field: optional chaining, defaults, and nothing may throw out of
  `/api/gsi`. Respond 200 fast.
- Attribute stats to the user only when `player.steamid === provider.steamid`.
- Label inferred/estimated data as such in the UI and in DB column comments.
- Stats aggregation happens in SQL (drizzle), in `src/lib/server/db/stats/`, never in routes.
- Schema changes: generate + commit migrations; never `db:push` beyond local experiments.
