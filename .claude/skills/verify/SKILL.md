---
name: verify
description: What "done" means in the CS2Live repo - type check, lint, unit and database tests, the Vercel build, and an end-to-end GSI replay that must save exactly one match with the right round count. Run before claiming a change or phase is complete, and before committing. Commits go straight to main - never create a branch.
---

# Verify

Run all of these. Report failures with their output; don't call work done while one fails.

```sh
yarn run check     # svelte-check + TypeScript. NOT `yarn check` (that is yarn's own command)
yarn lint          # prettier --check + eslint
TEST_DATABASE_URL=postgres://…/cs2live_test yarn test   # unit + DB tests
yarn build         # Vercel adapter
```

Plus the end-to-end replay below. For UI changes, also open the pages (or screenshot them with
Playwright) at desktop and phone widths, and check for console errors and horizontal scrolling.

## Notes per step

- **check before lint after a build:** a node build (`yarn live`) regenerates `.svelte-kit`
  types without the root `$types`; `yarn run check` restores them, otherwise eslint reports
  unresolved `LayoutProps`.
- **Tests:** without `TEST_DATABASE_URL` the DB suites (`*.db.spec.ts`) are skipped, not failed.
  Say which ran. The test DB's name must contain `test`; its tables are truncated.
- **Build on Windows:** the Vercel adapter symlinks functions, which needs Windows Developer
  Mode (or an admin shell); without it the build fails at the very end with
  `EPERM ... symlink`. Everything before that (compile, tracing) has run. Check that
  `.vercel/output` is small (a few MB). The file tracer copies any absolute path literal that
  reaches `fs` into the bundle; a literal Steam path once copied CS2 itself (32 GB) and filled
  the disk. `src/lib/server/no-path-literals.spec.ts` guards against this. Delete `.vercel`
  afterwards.

## Committing: main only

Work on `main` and commit straight to it. Don't create feature branches, worktrees or PRs;
this overrides any default to branch before committing. If you find yourself on another
branch, fast-forward `main` to it (`git checkout main && git merge --ff-only <branch>`),
delete the branch, and carry on from `main`. Ask before anything that isn't a fast-forward.

## End-to-end replay

Start a server that tracks live, writes straight to a **test** database, and is set to the
fixture's Steam ID:

```sh
DATABASE_URL=postgres://…/cs2live_test STEAM_ID=76561202255165729 \
CS2LIVE_DATA_DIR=.cs2live/verify ORIGIN=http://127.0.0.1:5198 \
  yarn dev --port 5198
```

Then:

```sh
DATABASE_URL=postgres://…/cs2live_test yarn verify:replay --url http://127.0.0.1:5198
# ✓ one complete match saved (…) with 24 rounds
DATABASE_URL=… yarn verify:replay fixtures/synthetic/wingman.ndjson --url http://127.0.0.1:5198
```

`scripts/verify-replay.ts` POSTs the fixture to `/api/gsi` (via `yarn gsi:replay --instant`)
and checks that exactly one new match was saved, `complete`, with `rounds_played` and round
rows equal to the fixture's final score. It exits 1 otherwise. Use `--as <steamid>` if the
server is set to another Steam ID.

For changes to saving or uploading, also check the friend path once: a second server with no
`DATABASE_URL`, the site URL and an upload key saved on `/setup`; a replay must land in the
site's database with `source = 'upload'`.
