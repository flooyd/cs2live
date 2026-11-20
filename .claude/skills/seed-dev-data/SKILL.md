---
name: seed-dev-data
description: Fill a development database with realistic simulated CS2 matches (maps, modes, sides, buy types, results, incomplete and mid-join games, partial sightings, linked recordings by friends) using yarn db:seed, and remove them again. Use when building or checking history, stats or match pages without real data, or when a page looks empty in development.
---

# Seeding development data

```sh
yarn db:seed                  # 40 matches for the simulated player, plus 8 for each of two friends
yarn db:seed --matches 100    # more for the simulated player
yarn db:seed --reset          # delete every seeded row (it does not seed again)
yarn db:seed --reset && yarn db:seed   # start over
```

- Uses `DATABASE_URL`. It **refuses to touch a Neon database without `--yes`**. Prefer a local
  Postgres or a Neon branch. Never seed production.
- Every match goes through the real path: simulator (`src/lib/server/gsi/sim/simulate.ts`) →
  match tracker (`runFrames`) → `persistMatch`. So seeded data has the same shape, inferred
  fields and quirks as real recordings.
- All seeded Steam IDs are in the reserved fake range (`fakeSteamId(n)` in
  `src/lib/cs2/steamid.ts`, far above any real account). `--reset` deletes exactly that range,
  so real data is never touched. The UI marks these players "Simulated data".
- The recorder is `76561202255165729` (SimPlayer). Teammates `fakeSteamId(2..5)` appear as
  partial sightings; two friends (`fakeSteamId(6)`, `fakeSteamId(7)`) record games of their own,
  and teammates' copies of some of SimPlayer's games are saved too, so linked recordings (`game_id`) and the global match list have something to show.
- Seeded with a fixed random seed, so runs are repeatable.

Good pages to check afterwards: `/`, `/matches`, `/players/76561202255165729`,
`/players/76561202255165729/stats`, and a match from the list.

## A local Postgres for development

Any Postgres 15+ works. With PostgreSQL installed on Windows, a throwaway cluster:

```sh
initdb -D .pgdata -U postgres -A trust
pg_ctl -D .pgdata -o "-p 54329 -c listen_addresses=127.0.0.1" -l .pgdata/log start
createdb -h 127.0.0.1 -p 54329 -U postgres cs2live
createdb -h 127.0.0.1 -p 54329 -U postgres cs2live_test
# .env: DATABASE_URL=postgres://postgres@127.0.0.1:54329/cs2live
#       TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/cs2live_test
yarn db:migrate && yarn db:seed
```
