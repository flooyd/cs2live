# Build: CS2 Live Match Tracker (SvelteKit + GSI + Neon)

You're working in a fresh SvelteKit project I created with `npx sv create`. These options were selected:

- TypeScript
- prettier, eslint, vitest (unit and component testing)
- sveltekit-adapter: **vercel**
- drizzle: **PostgreSQL** with the **Postgres.JS** client, no docker-compose
- better-auth: Email & Password demo
- ai-tools: Claude Code with the Svelte plugin (use the Svelte MCP/docs tools it provides for any Svelte 5 or SvelteKit question rather than relying on memory)
- Package manager: **yarn**

Read the generated project first (`package.json`, `src/lib/server/db/*`, `src/lib/server/auth.ts`, `drizzle.config.ts`, `src/hooks.server.ts`) and build on what's there. Don't re-scaffold.

## Goal

A personal Counter-Strike 2 companion app that:

1. **Receives CS2 Game State Integration (GSI) data live** while I play my own matches.
2. **Shows a live scoreboard/dashboard** on a second monitor, with as much detail as GSI allows.
3. **Saves every match to the database** when it ends, with as much detail as possible, including a per-round breakdown.
4. **Shows match history, single-match detail pages, and aggregated stats** (career totals, per-map, per-side, trends over time).

## Database: Neon

- I'll put the Neon connection string in `.env` as `DATABASE_URL`. Update `.env.example` to match.
- Keep the scaffolded `drizzle-orm/postgres-js` setup. Neon needs SSL (`?sslmode=require`). If the URL is Neon's **pooled** endpoint (`-pooler` in the host), set `prepare: false` on the postgres.js client because PgBouncer transaction mode doesn't support prepared statements. Write a comment explaining this.
- Use `drizzle-kit generate` plus `drizzle-kit migrate` with committed migration files. Don't use `push` for anything beyond quick local experiments. Add yarn scripts for `db:generate`, `db:migrate`, and `db:studio`.

## CS2 GSI facts you must design around

Valve's official GSI documentation dates from CS:GO, and CS2's behavior differs in places. **Treat the notes below as a starting hypothesis. Verify every field against real captured payloads before building on it** (see "Phase 1").

**Config file.** The user drops this file into `...\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\`. Generate it from a template with a yarn script (`yarn gsi:config`) that reads `GSI_TOKEN` and the endpoint URL from env:

```
"CS2 Tracker"
{
  "uri"       "http://127.0.0.1:5173/api/gsi"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.1"
  "heartbeat" "10.0"
  "auth" { "token" "<GSI_TOKEN>" }
  "data"
  {
    "provider"            "1"
    "map"                 "1"
    "map_round_wins"      "1"
    "round"               "1"
    "player_id"           "1"
    "player_state"        "1"
    "player_weapons"      "1"
    "player_match_stats"  "1"
    "player_position"     "1"
    "phase_countdowns"    "1"
    "bomb"                "1"
    "grenades"            "1"
    "allplayers_id"            "1"
    "allplayers_state"         "1"
    "allplayers_match_stats"   "1"
    "allplayers_weapons"       "1"
    "allplayers_position"      "1"
  }
}
```

**Main limitation.** While you're _playing_ (not spectating, GOTV, or casting), CS2 only sends data about **you**. The `allplayers_*`, `bomb`, `grenades`, and probably `phase_countdowns` sections are generally only populated for spectators and observers. Request them anyway, handle them if present, and never depend on them. A full 10-player scoreboard is **not** possible from GSI during my own matches. Design the UI around my own stats plus team scores and round history, and say this plainly in the UI where relevant.

**The `player` block isn't always me.** When I'm dead and spectating a teammate, `player` describes _them_. Always compare `player.steamid` with `provider.steamid`. Only attribute stats to me when they match. Show "Spectating <name>" in the live UI otherwise.

**Fields you can expect** (verify them):

- `provider`: steamid, timestamp, version
- `map`: name, mode, phase (`warmup` | `live` | `intermission` | `gameover`), round, team_ct / team_t (score, name, timeouts_remaining, consecutive_round_losses), `round_wins` (map of round number to reason, e.g. `ct_win_elimination`, `t_win_bomb`, `ct_win_defuse`, `ct_win_time`)
- `round`: phase (`freezetime` | `live` | `over`), win_team, bomb (`planted` | `exploded` | `defused`)
- `player`: steamid, name, team, activity, `state` (health, armor, helmet, defusekit, flashed, smoked, burning, money, round_kills, round_killhs, round_totaldmg, equip_value), `match_stats` (kills, assists, deaths, mvps, score), `weapons` (name, type, state, ammo), position, forward
- `previously` and `added` diff blocks. These are useful for detecting transitions such as a kill happening or a phase changing.

**Auth.** Reject any POST to `/api/gsi` whose `auth.token` doesn't match `GSI_TOKEN`. Respond `200` fast because CS2 retries and waits on slow responses. Do any heavy work after responding, or keep it trivially fast.

**No match ID.** GSI sends no match ID. Create one yourself when `map.phase` moves into `live` (or `warmup` to `live`), keyed by map, mode, and start time. Handle mid-match joins, reconnects to the same match (same map and the score continues), and quitting before `gameover` by marking the match `incomplete` after a heartbeat timeout.

## Deployment reality: live ingest runs locally

The game posts to a URL on my machine, and live state needs a long-lived process (in-memory state plus Server-Sent Events). Vercel serverless functions can't hold that state. So:

- **Live tracking runs locally** (`yarn dev`, or a local production build). Add a `yarn live` script that runs a local production server. If adapter-vercel can't do this cleanly, add `@sveltejs/adapter-node` as a second build target selected by env var, and document why.
- **The Vercel deployment** serves history, match pages, and stats from Neon. It must build and run without the live features. The live route should show a friendly "live tracking only runs locally" state there.
- Keep live state in a server-side singleton module (`src/lib/server/live/`) and push updates to the browser over **SSE** (`/api/live/stream`), with auto-reconnect on the client.

## Architecture

```
src/lib/server/gsi/
  schema.ts         Zod (or valibot) schemas for payloads, all fields optional and lenient
  ingest.ts         validate, then update live state, then run the match state machine
  match-tracker.ts  state machine: idle -> warmup -> live -> (round loop) -> gameover -> persist
  round-builder.ts  builds per-round records from transitions (freeze end, round over, etc.)
  recorder.ts       optional raw payload capture to NDJSON (env flag GSI_CAPTURE=1)
src/lib/server/live/   in-memory store and SSE broadcaster
src/lib/server/db/     drizzle schema and query modules (stats queries kept here, not in routes)
src/routes/api/gsi/+server.ts
src/routes/api/live/stream/+server.ts
src/routes/live/          second-monitor scoreboard
src/routes/overlay/       transparent-background variant for OBS browser sources
src/routes/matches/       history list with filters
src/routes/matches/[id]/  match detail
src/routes/stats/         aggregated stats dashboard
```

Use **Svelte 5 runes** throughout. Keep pure logic (state machine, round building, stat math) free of framework imports so it's easy to unit test.

## Data model (starting point; refine it after seeing real payloads)

- **matches**: id, map, mode, started_at, ended_at, duration, my_team_start (CT/T), final score (mine/theirs), result (win | loss | tie | incomplete), my final kills/assists/deaths/mvps/score, totals: hs kills, damage, rounds played, derived ADR, HS%, KD, steamid
- **rounds**: match_id, number, my_side, winner_side, win_reason, i_won, bomb outcome, my kills, hs kills, damage, survived, health at end, money at freeze start / freeze end / round end, equip_value, weapons held at freeze end (jsonb), primary weapon, buy type (derived: pistol | eco | force | full | save, using thresholds you document), mvp this round, round duration
- **kill_events** (best-effort): match_id, round, timestamp, active weapon at the time, was_headshot (inferred from the `round_killhs` delta). Label these clearly as _inferred_.
- **raw_payloads** (optional, toggleable): match_id, received_at, payload jsonb. This lets matches be reprocessed later when the parsers improve. Add a retention or cleanup script because Neon storage is limited.
- better-auth tables as scaffolded.

## Pages

**/live (second monitor, the main event).** Dark, high-contrast, readable from across a desk, no scrolling at 1080p. Show:

- Map, mode, phase, round number, big team scores, a round-history strip (one pip per round coloured by winner, with an icon for win reason), and halftime and overtime markers
- My health, armor, helmet, kit, money, equip value, active weapon with ammo, and grenades held
- My K/A/D/MVP/score, this round's kills, HS, and damage, live ADR, HS%, and KD
- Status effects (flashed, smoked, burning) as transient indicators
- A round timer. Use `phase_countdowns` if present. Otherwise estimate from phase-transition timestamps and standard timings, and label it as an estimate.
- A bomb-planted state with an estimated countdown
- A "Spectating X" banner when `player` isn't me
- Connection status (last payload age, heartbeat)
- A small "money next round" estimator based on the loss bonus (consecutive_round_losses)
- Subtle animations on changes (score tick, kill pop) without anything distracting

**/overlay.** Same data, compact, transparent background.

**/matches.** Filterable by map, mode, result, and date range. Columns: result, score, KDA, ADR, HS%, duration.

**/matches/[id].** Header, round-by-round timeline (side, winner, reason, my kills, damage, money, buy type), money-over-time chart, damage-per-round chart, multi-kill rounds highlighted.

**/stats.** Career totals plus filters (date range, map, mode, last N matches):

- K/D, ADR, HS%, win rate, MVPs per match, rounds survived %
- By map: win rate, ADR, and matches played
- By side: CT vs T round win %, ADR, and kills per round
- Pistol rounds, eco/force/full-buy round win rates, and my performance by buy type
- Multi-kill distribution (2K, 3K, 4K, ACE)
- Trends: rolling ADR, KD, and HS% over matches, plus win/loss streaks
- Best and worst matches, and a most-used-weapons breakdown (inferred)

Do aggregation in SQL with drizzle (not by loading every row into JS), and index accordingly.

Visual design: a clean, data-dense esports-dashboard feel. Pick a coherent dark palette with CT blue and T amber accents and use it consistently. Use LayerChart or hand-rolled SVG for charts. Avoid heavy chart libraries.

## Auth

Keep better-auth. The app is single-user, so gate `/matches`, `/stats`, and `/live` behind login on the deployed site, with sign-up disabled after the first account (or allowlisted by env). `/api/gsi` uses only the GSI token, not session auth. Locally, allow an env flag to skip login for `/live` and `/overlay` so the second monitor never shows a login screen mid-match.

## Phased plan (commit after each phase)

**Phase 0: Setup.** Env vars (`DATABASE_URL`, `GSI_TOKEN`, `BETTER_AUTH_SECRET`, flags), Neon client config, the `gsi:config` script, and a README section on installing the cfg file.

**Phase 1: Capture before you build.** Implement `/api/gsi` with token checks and NDJSON capture. Write a `fixtures/README.md` asking me to play one match (and ideally spectate some of one) with capture on. Until real captures exist, also write a few hand-made fixture sequences (full match, mid-match join, quit before gameover, death plus spectating a teammate, overtime). Once real captures are available, **diff the real fields against your schema and update it**. Real data wins over these instructions.

**Phase 2: Match state machine and round builder**, with thorough Vitest unit tests driven by fixtures.

**Phase 3: Live store, SSE, and the /live and /overlay pages.**

**Phase 4: Persistence**: schema, migrations, and saving on gameover or timeout. Make it idempotent, so a duplicate gameover never creates a second match.

**Phase 5: History, match detail, and stats pages** with the SQL aggregations.

**Phase 6: Polish**: empty states, loading states, error handling, Vercel build check, README.

## Claude Code skills to create

Create these as project skills in `.claude/skills/<name>/SKILL.md`, each with proper frontmatter (`name`, plus a `description` that says clearly _when_ to use it). Keep each one concise and practical, and include runnable scripts where noted. Update them as the project evolves.

1. **`cs2-gsi-reference`**: Verified field reference built from the real captures (not this prompt): which fields appear in which situations (alive, dead/spectating, warmup, halftime, gameover, observer), `player` vs `provider` steamid gotchas, the round_wins reason list, and known quirks. Use whenever touching GSI parsing.
2. **`gsi-replay`**: A script (`scripts/replay-gsi.ts`) that POSTs an NDJSON fixture to `/api/gsi` with the original timing or at Nx speed, so the live UI and persistence can be tested without launching CS2. The skill explains how to run it and how to create a new fixture from a capture, including trimming and anonymising.
3. **`db-change`**: The workflow for any schema change: edit the drizzle schema, `db:generate`, review the SQL, `db:migrate`, update query types, and run tests. Include Neon notes (pooled vs direct URL for migrations, using a Neon branch for risky migrations, `prepare: false`).
4. **`add-stat`**: A checklist for adding a new aggregated stat end to end: define it precisely (including what's inferred), write the SQL/drizzle query in `src/lib/server/db/stats`, unit test it against seeded data, add it to `/stats`, and document it in a `STATS.md` glossary.
5. **`seed-dev-data`**: A script that generates realistic fake matches and rounds (varied maps, sides, buy types, results) into the DB, so stats pages can be built and checked without playing 50 matches.
6. **`verify`**: What "done" means in this repo: `yarn check`, `yarn lint`, `yarn test`, `yarn build` (Vercel adapter), plus replaying a full-match fixture and confirming exactly one match with the correct round count is saved.

Also add a `CLAUDE.md` with project conventions, commands, the local-vs-Vercel split, and pointers to the skills.

## Working rules

- Ask me before adding major dependencies beyond: zod or valibot, layerchart, date-fns, and adapter-node if needed.
- Never trust an unverified GSI field. Code defensively with optional chaining and defaults, and never let a malformed payload throw out of `/api/gsi`.
- Label inferred or estimated data as such, both in the UI and in the DB column comments.
- Run the `verify` steps before claiming a phase is complete.
