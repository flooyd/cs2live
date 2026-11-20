# CS2Live

A Counter-Strike 2 companion app. It reads CS2's Game State Integration (GSI) feed while you
play, shows a live dashboard on a second monitor, saves every match with a per-round
breakdown, and serves match history and stats on a public site where anyone can look up a
Steam ID.

## How it fits together

```
 CS2 (your PC) ──GSI POST──▶ CS2Live, running locally (yarn live)
                              ├─ /live, /overlay   live dashboard over SSE
                              └─ finished match ──▶ the CS2Live site (Vercel) ──▶ Neon Postgres
                                                     ├─ /            look up any Steam ID
                                                     ├─ /players/…   match history and stats
                                                     └─ /matches/…   match detail
```

- **Live tracking only runs locally.** CS2 posts to a URL on your own machine, and live state
  needs a long-running process. Vercel's serverless functions can't hold that state.
- **The site holds the database.** Your local copy uploads each finished match to the site with
  your upload key. Friends can run CS2Live too; nobody but the site needs the Neon password.
  (The site owner can instead set `DATABASE_URL` locally and write straight to Neon.)
- **GSI only describes you.** While you play, CS2 sends your own state, team scores and round
  results. It sends a teammate's state only while you're dead and spectating them, and it
  never sends enemies. So there is no 10-player scoreboard. Teammates you spectate are saved as
  _partial sightings_, so they can still find those matches by Steam ID.

## Setup

Requires Node 22.17+ and yarn 1.

```sh
yarn install
cp .env.example .env    # then fill it in, see below
```

### Installing the CS2 GSI config

CS2 sends game state to every `gamestate_integration_*.cfg` file in its cfg folder.

1. Generate the config. This writes `.cs2live/gamestate_integration_cs2live.cfg`, and creates
   `GSI_TOKEN` in `.env` if you don't have one yet:

   ```sh
   yarn gsi:config            # write the file and print where it goes
   yarn gsi:config --install  # ...and copy it into CS2's cfg folder
   ```

   The cfg folder is
   `...\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\`. The script finds
   it through Steam's library list; set `CS2_CFG_DIR` if yours is somewhere unusual.

2. **Restart CS2.** It only reads GSI configs at startup.
3. Start CS2Live (`yarn live`, or `yarn dev` while developing) and open
   <http://localhost:5173/live>. On first run it asks for your Steam ID.

The config posts to `http://127.0.0.1:5173/api/gsi`. Change `GSI_URL` in `.env` and rerun
`yarn gsi:config --install` if you use another port. Re-run it whenever you change `GSI_TOKEN`.

## Using it while you play

- **`/live`**: the full-screen live view for a second monitor: health, money, weapons, round
  history, your match stats and an estimate of next round's money.
- **`/overlay`**: a compact, transparent card for OBS (add it as a Browser Source;
  `?scale=1.5` makes it bigger).
- **`/setup`**: your Steam ID, a check that CS2 is sending data, and where matches are saved.

A match is saved when it reaches the scoreboard. If you leave, crash or alt-F4, it is saved as
_incomplete_ after two minutes without in-match data, and continues as the same match if you
reconnect.

## Playing with friends

Each friend runs their own copy and uploads to the shared site:

1. The site owner adds the friend's email to `SIGNUP_ALLOWLIST` on Vercel.
2. The friend signs up on the site, opens **Account**, claims their Steam ID and creates an
   **upload key** (shown once).
3. The friend installs CS2Live (Node 22.17+, yarn 1):
   ```sh
   git clone <repo> cs2live && cd cs2live
   yarn install
   yarn gsi:config --install   # then restart CS2
   yarn live
   ```
4. On <http://localhost:5173/setup> they enter their Steam ID, the site URL and the upload key.
   **Test connection** checks the key.

Finished matches are written to `.cs2live/outbox/` first and uploaded from there, so nothing
is lost while the site or the network is down; CS2Live retries with a growing delay, on the next start, and when the
settings are saved. A wrong or revoked key pauses uploads until you save a new one. A match the site rejects outright (a bad file) is moved to
`.cs2live/outbox/rejected/`.

On the site anyone can look up a Steam ID. A player's list shows matches they recorded, plus
_partial sightings_: games where a friend spectated them, with their stats as last seen.

## Deploying the site (Vercel + Neon)

1. Create a Neon database. The Vercel Neon integration sets `DATABASE_URL` (pooled) and
   `DATABASE_URL_UNPOOLED` (direct) for you.
2. Import the repo into Vercel (framework: SvelteKit) and set:

   | Variable                | Value                                                                                     |
   | ----------------------- | ----------------------------------------------------------------------------------------- |
   | `DATABASE_URL`          | Neon pooled URL (`…-pooler…/neondb?sslmode=require`)                                      |
   | `DATABASE_URL_UNPOOLED` | Neon direct URL, used for migrations                                                      |
   | `BETTER_AUTH_SECRET`    | 32+ random characters                                                                     |
   | `ORIGIN`                | the site's URL, e.g. `https://cs2live.vercel.app`                                         |
   | `SIGNUP_ALLOWLIST`      | emails allowed to sign up, comma-separated (`*` = anyone). Empty = only the first account |

   Live tracking is off on Vercel automatically.

3. Run the migrations against Neon from your machine (put the Neon URLs in `.env` first):
   `yarn db:migrate`. Do this again before deploying a change that adds a migration.
4. Open the site, sign up (the first account is always allowed), claim your Steam ID and create
   an upload key, then enter the site URL and key on your local `/setup`.

The site owner can instead put `DATABASE_URL` in their local `.env`: that copy then writes
straight to Neon and needs no upload key.

## Commands

| Command                   | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `yarn dev`                | Dev server on :5173, live tracking included                           |
| `yarn live`               | Local production build (adapter-node) on :5173 for real play          |
| `yarn build`              | Vercel build (history, stats, upload API; no live tracking)           |
| `yarn gsi:config`         | Generate (and with `--install`, install) the CS2 GSI config           |
| `yarn gsi:replay <file>`  | Replay a GSI capture or fixture into a running server                 |
| `yarn gsi:anonymise`      | Trim and anonymise a real capture into a fixture                      |
| `yarn gsi:fixtures`       | Regenerate the synthetic fixtures from the simulator                  |
| `yarn run check`          | svelte-check (note: `yarn check` is yarn's own, unrelated command)    |
| `yarn lint` / `yarn test` | Prettier + ESLint / Vitest                                            |
| `yarn verify:replay`      | End-to-end check: replay a fixture, expect exactly one saved match    |
| `yarn db:generate`        | Generate a SQL migration from the drizzle schema                      |
| `yarn db:migrate`         | Apply migrations (uses `DATABASE_URL_UNPOOLED` when set)              |
| `yarn db:seed`            | Fill a dev database with simulated matches (`--reset` removes them)   |
| `yarn db:cleanup`         | Delete stored raw payloads older than 30 days (`--days`, `--dry-run`) |
| `yarn db:studio`          | Drizzle Studio                                                        |

## Development

- **Tests.** `yarn test` runs unit tests everywhere. The database tests (`*.db.spec.ts`) need
  `TEST_DATABASE_URL`: any Postgres database whose name contains `test` (its tables are
  truncated). Without it they are skipped.
- **No CS2 needed.** Replay a fixture (`yarn gsi:replay fixtures/synthetic/full-match.ndjson
--speed 20`) and seed a database (`yarn db:seed`) to work on any page.
- **Real captures.** `GSI_CAPTURE=1` records every payload to `captures/`. Please capture a
  real match: see `fixtures/README.md`.
- **What's measured and what's guessed:** `STATS.md` defines every number and tags it observed,
  derived, inferred, estimated or partial. The UI underlines inferred values with dots.
- Notes for Claude Code (conventions, skills) are in `CLAUDE.md` and `.claude/skills/`.

## Limitations

- GSI only describes you and whoever you spectate. There is no data about enemies, no full
  scoreboard, no kill feed (kills, headshots and weapons are inferred), and damage you deal is
  not updated after you die.
- Custom Steam profile URLs (`/id/name`) can't be resolved without a Steam Web API key; search
  by SteamID64 or a `/profiles/7656…` link (name search works for known players).
- Steam ID ownership isn't verified: the first account to claim a Steam ID gets it. Fine among
  friends; a Steam OpenID login would be needed for a public site.
- On Windows, `yarn build` needs Developer Mode (the Vercel adapter creates symlinks). Vercel
  itself builds on Linux.
