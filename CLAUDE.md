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
- **Damage comes from match demos**, not GSI (CS2 sends none). The local copy keeps each finished
  official match without damage as a job (`src/lib/server/demos/`). Once CS2 is closed it asks
  Steam's Game Coordinator for recent matches with `@akiver/boiler-writter` (fails while CS2 runs),
  downloads the demo, parses it with `@laihoe/demoparser2` (native) and re-sends the match through
  the outbox. Both are runtime `dependencies`, loaded with `createRequire` from a variable so
  Vercel's tracer leaves their binaries out of the site bundle.

## Commands

`yarn dev`, `yarn live`, `yarn build`, `yarn run check` (never `yarn check`), `yarn lint`,
`yarn test`, `yarn gsi:config [--install]`, `yarn gsi:replay`, `yarn gsi:anonymise`,
`yarn gsi:fixtures`, `yarn demo:damage <demo|latest> <steamid>`, `yarn verify:replay`, `yarn db:generate`, `yarn db:migrate`, `yarn db:seed`,
`yarn db:cleanup`. DB tests (`*.db.spec.ts`) need `TEST_DATABASE_URL`; otherwise they skip.
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
- Stat definitions and their OBSERVED / DERIVED / INFERRED / ESTIMATED / PARTIAL tags live in
  `STATS.md`. Keep it in sync with the queries.
- Routes are grouped: `(app)` has the site shell, `(screen)` the full-screen `/live` and
  `/overlay`. Typed `resolve()` takes the group in the route ID (`resolve('/(app)/matches')`);
  links that only change the query string use `here(query)` from `#lib/components/here.ts`.
- Charts are hand-rolled SVG in `src/lib/components/charts/` with the validated `--viz-*`
  tokens from `src/app.css`; every chart has a hover tooltip and the same numbers in a table.
- **No absolute filesystem path literals in `src/`** (`'C:\Program Files…'`): Vercel's file
  tracer copies whatever they point at into the build (it once copied CS2, 32 GB). Build such
  paths from env vars. `no-path-literals.spec.ts` enforces it.

## Gotchas

- The live runtime is a singleton on `globalThis` and survives Vite HMR: restart the dev
  server after changing `src/lib/server/live/` or the tracker.
- After a node build, run `yarn run check` before `yarn lint` (it restores `.svelte-kit` types).
- `yarn build` on Windows ends in `EPERM symlink` without Developer Mode; everything before it
  ran. Delete `.vercel` afterwards.
- Don't run two GSI replays into one server at once.

## Skills (`.claude/skills/`)

- `cs2-gsi-reference`: what GSI sends when; read before touching parsing or the tracker.
- `gsi-replay`: replaying fixtures, turning captures into anonymised fixtures.
- `db-change`: schema change workflow and Neon notes.
- `add-stat`: adding a stat end to end (SQL, test, UI, STATS.md).
- `seed-dev-data`: simulated matches for development.
- `verify`: what "done" means; run it before claiming work is complete.
