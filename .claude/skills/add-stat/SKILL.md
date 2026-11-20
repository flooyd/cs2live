---
name: add-stat
description: Checklist for adding a new aggregated stat to CS2Live end to end - define it precisely (including what is inferred), write the SQL in src/lib/server/db/stats, test it against seeded data, show it on the stats or match page, and document it in STATS.md. Use when asked for a new number, rate, breakdown or chart on the history or stats pages.
---

# Adding a stat

1. **Define it in one sentence**, with its tag from `STATS.md` (OBSERVED, DERIVED, INFERRED,
   ESTIMATED, PARTIAL). Say what the denominator is, what is left out (incomplete matches?
   rounds where survival is unknown? partial sightings?) and what GSI can't see. If GSI
   doesn't send what the stat needs, say so and stop. Don't fabricate enemy or teammate data.
2. **Check the data exists.** Per-match values are on `matches`, per-round on `rounds`,
   inferred kills on `kill_events`, spectated players on `sightings`. If a new column is needed,
   follow the `db-change` skill first. Values computed at record time belong in
   `src/lib/server/gsi/round-builder.ts` / `match-tracker.ts` (pure, unit-tested).
3. **Write the query in SQL** in `src/lib/server/db/stats/` (`player-stats.ts` for the stats
   page, `matches.ts` for lists and the match page). Never aggregate in a route or component.
   Reuse the `scope()` filters (map, mode, period) and the shared `TOTALS` fragment. Sum first,
   divide last: a rate over many matches is `sum(x) / sum(rounds)`, not an average of
   per-match rates. Return `null` rather than 0 when the denominator is 0.
4. **Test it** in `src/lib/server/db/stats/stats.db.spec.ts` against simulated matches
   (`runFrames` + `persistMatch`): compare the SQL result with the same number computed in
   TS from the `MatchRecord`s. Run with `TEST_DATABASE_URL` set.
5. **Show it.** Stats page: `src/routes/(app)/players/[steamid]/stats/+page.svelte`; match page:
   `src/routes/(app)/matches/[id]/+page.svelte`. Inferred or estimated values get
   `class="inferred"` with a `title` that explains the inference. Charts use the components in
   `src/lib/components/charts/` and the `--viz-*` tokens in `src/app.css`, and every chart also
   has a table or list with the same numbers (load the `dataviz` skill before designing a new
   chart).
6. **Document it** in `STATS.md`: name, tag, exact definition, known gaps.
7. Run the `verify` skill. Check it on seeded data: `yarn db:seed`, then open
   `/players/76561202255165729/stats`.
