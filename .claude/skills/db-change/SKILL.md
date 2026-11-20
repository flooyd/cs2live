---
name: db-change
description: Workflow for any database schema change in CS2Live - edit the drizzle schema, generate and review the SQL migration, add column comments for inferred data, migrate, update queries and run the DB tests, with Neon notes (pooled vs direct URL, branches for risky migrations, prepare false). Use before adding, renaming or removing a table, column or index.
---

# Changing the database

Schema: `src/lib/server/db/schema.ts` (app tables) and `auth.schema.ts` (better-auth, generated
with `scripts/auth-schema.config.ts`). Migrations: `drizzle/`, committed. Never `db:push` outside
a throwaway database.

## Steps

1. **Edit the schema.** Keep names snake_case in SQL, camelCase in TS. New nullable columns
   are the easy path; a NOT NULL column on an existing table needs a default or a backfill.
2. **Generate:** `yarn db:generate --name <what_changed>`. drizzle-kit diffs against
   `drizzle/meta`, so never edit old migrations or the snapshots.
3. **Read the SQL** in the new `drizzle/NNNN_*.sql`. Look for drops or renames that drizzle
   turned into drop + add (data loss), missing defaults and long table rewrites.
4. **Label the data.** Every column that stores inferred, estimated, derived or partial data
   gets a comment. Use a custom migration:
   `yarn db:generate --custom --name <x>_comments`, then add
   `COMMENT ON COLUMN matches.foo IS 'INFERRED: ...';` lines separated by
   `--> statement-breakpoint` (see `drizzle/0001_column_comments.sql`). Tags and meanings are
   in `STATS.md`.
5. **Migrate a test database:** the DB tests run all migrations on `TEST_DATABASE_URL`
   themselves (`src/lib/server/db/testing.ts`), so `yarn test` with it set is the check.
   For a dev database: `yarn db:migrate`.
6. **Update the code that reads and writes it:** `persist.ts` (MatchRecord → rows), the
   upload schema in `src/lib/match-record.ts` (bump `MATCH_RECORD_VERSION` if old clients can't
   send the field; keep accepting the old shape), and the queries in `src/lib/server/db/stats/`.
7. `yarn run check`, `yarn lint`, `yarn test` with `TEST_DATABASE_URL` set. Then commit the
   schema, the migration SQL and `drizzle/meta` together.

## Neon notes

- **Pooled vs direct.** The app uses `DATABASE_URL` (the `-pooler` host is fine; the client
  sets `prepare: false` for pooled hosts because PgBouncer in transaction mode drops prepared
  statements; see `src/lib/server/db/client.ts`). Migrations use `DATABASE_URL_UNPOOLED`, the
  direct endpoint (`drizzle.config.ts` prefers it). Neon's Vercel integration sets both.
- **Risky migrations** (drops, type changes, big backfills): create a Neon branch from
  production in the console, point `DATABASE_URL_UNPOOLED` at the branch, run
  `yarn db:migrate`, check the site against it, then migrate production and delete the branch.
- **Order with deploys:** migrate before deploying code that needs the new columns. Additive
  changes are safe to run first; for removals, deploy code that no longer uses the column, then
  drop it in a later migration.
- Neon requires SSL; keep `?sslmode=require` in the URLs.
- Uploads from friends' older CS2Live versions keep arriving after a deploy: the upload API
  must keep accepting their payloads.
