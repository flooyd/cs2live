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

## Commands

| Command                   | What it does                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| `yarn dev`                | Dev server on :5173, live tracking included                        |
| `yarn live`               | Local production build (adapter-node) on :5173 for real play       |
| `yarn build`              | Vercel build (history, stats, upload API; no live tracking)        |
| `yarn gsi:config`         | Generate (and with `--install`, install) the CS2 GSI config        |
| `yarn run check`          | svelte-check (note: `yarn check` is yarn's own, unrelated command) |
| `yarn lint` / `yarn test` | Prettier + ESLint / Vitest                                         |
| `yarn db:generate`        | Generate a SQL migration from the drizzle schema                   |
| `yarn db:migrate`         | Apply migrations (uses `DATABASE_URL_UNPOOLED` when set)           |
| `yarn db:studio`          | Drizzle Studio                                                     |
