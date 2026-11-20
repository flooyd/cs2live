---
name: cs2-gsi-reference
description: Field reference for CS2's Game State Integration payloads - which sections and fields arrive in which situations (alive, dead/spectating, warmup, halftime, gameover, observer), the provider vs player steamid rule, round_wins reasons and known quirks. Use whenever touching GSI parsing, the zod schema, the match tracker, the round builder or anything that reads a payload.
---

# CS2 GSI reference

> **Status: unverified.** No real CS2 capture has been checked in yet (`fixtures/real/` is
> empty). Everything below comes from Valve's CS:GO-era docs, community notes and our own
> simulator (`src/lib/server/gsi/sim/simulate.ts`). When a real capture arrives, diff it
> against this file and `src/lib/server/gsi/schema.ts`, fix both, and remove this banner.
> Real data wins. Lines marked **(verify)** are the most likely to be wrong.

## Where things live

| What                    | File                                                       |
| ----------------------- | ---------------------------------------------------------- |
| zod schema (lenient)    | `src/lib/server/gsi/schema.ts`                             |
| Payload helpers         | `src/lib/server/gsi/payload.ts`                            |
| Match state machine     | `src/lib/server/gsi/match-tracker.ts`                      |
| Rounds, kill events     | `src/lib/server/gsi/round-builder.ts`                      |
| Win reasons, sides      | `src/lib/cs2/rounds.ts`                                    |
| Mode rules (halves, OT) | `src/lib/cs2/modes.ts`                                     |
| cfg sections we request | `src/lib/server/gsi/gsi-template.ts` (`GSI_DATA_SECTIONS`) |

## Rules that never change

- **Validate leniently, never throw.** `parsePayload` keeps what it can; a bad field becomes
  `undefined`, never a 500. `/api/gsi` always answers 200 quickly (CS2 retries otherwise).
- **`provider.steamid` is the person running the game. `player.steamid` is whoever the
  `player` block describes.** They are equal while you are alive and playing. When you are
  dead and spectating, `player` is the teammate you watch. Attribute stats to the user only
  when `player.steamid === provider.steamid` (`isSelf`). A different `player` is a partial
  sighting (`spectatedPlayer`).
- **`allplayers` means observer.** It is only sent to spectators, GOTV and casters, never to
  someone playing. The tracker ignores those payloads for recording (`isObserverPayload`).
- **`auth.token`** must equal `GSI_TOKEN`; it is stripped before anything is stored.

## Sections

| Section               | Sent while playing                   | Notes                                                                                                                                   |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`            | always                               | `steamid`, `timestamp` (seconds), `appid` 730, `name` "Counter-Strike: Global Offensive"                                                |
| `map`                 | in a server; absent in the main menu | `name`, `mode`, `phase`, `round` (rounds completed), `team_ct/team_t`, `round_wins`                                                     |
| `round`               | in a server                          | `phase`, `win_team` (during `over`), `bomb` (planted/exploded/defused) **(verify)**                                                     |
| `player`              | always (menu: just id/name)          | you, or the spectated teammate (see above)                                                                                              |
| `player.state`        | in a server                          | `health`, `armor`, `helmet`, `money`, `equip_value`, `round_kills`, `round_killhs`, `round_totaldmg`, `flashed`, `burning`, `defusekit` |
| `player.match_stats`  | in a server                          | `kills`, `assists`, `deaths`, `mvps`, `score`                                                                                           |
| `player.weapons`      | in a server                          | `weapon_0..n` with `name`, `type`, `state` (`active`/`holstered`), `ammo_clip`, `ammo_reserve`                                          |
| `phase_countdowns`    | probably observer only **(verify)**  | `phase_ends_in` is a **string** of seconds                                                                                              |
| `bomb`, `grenades`    | observer only **(verify)**           | never relied on                                                                                                                         |
| `allplayers*`         | observer only                        | keyed by SteamID64                                                                                                                      |
| `previously`, `added` | most payloads                        | diffs against the last payload; we ignore them                                                                                          |

## Phases

- `map.phase`: `warmup` → `live` → (`intermission` at halftime) → `live` → `gameover`.
  The tracker starts a match on `warmup`/`live`, ends it on `gameover`.
- `round.phase`: `freezetime` → `live` → `over`. During `over`, the team score may or may not
  include the round that just ended yet **(verify)**; `round_wins` is the source of truth for
  results.
- Main menu: `map` and `round` are missing. After `INCOMPLETE_TIMEOUT_S` (default 120 s) with no
  in-match data, an unfinished match is saved as `incomplete`; a reconnect to the same game
  within the resume window continues the same match id.

## `map.round_wins`

`{ "1": "ct_win_elimination", "2": "t_win_bomb", ... }`, keyed by round number, for the whole
match so far (also after a mid-match join). Reasons seen in CS:GO and assumed for CS2:

`ct_win_elimination`, `t_win_elimination`, `ct_win_defuse`, `t_win_bomb`, `ct_win_time`,
`ct_win_rescue`, `t_win_hostage`... and surrenders **(verify the exact strings)**.
`parseWinReason` only relies on the `ct_` / `t_` prefix and a keyword, so new variants degrade
to kind `other` instead of breaking.

## Modes (`map.mode`)

`competitive` and `premier` (MR12: 24 rounds, halves of 12, MR3 overtime), `scrimcomp2v2`
(Wingman: 16 rounds, halves of 8), `casual`, `deathmatch` and others (no halves). Premier may
report as `competitive` **(verify)**.

## Known gaps and quirks

- No kill feed, no enemy data, no 10-player scoreboard. Kill events and weapons are INFERRED
  from `round_kills` going up (see `STATS.md`).
- `round_totaldmg` stops updating when you die.
- Joining mid-round: `round_kills` may already include kills from before you were watching.
- CS2 may omit the `Content-Type` header **(verify: the first capture line records headers)**;
  `scripts/live.ts` forces JSON for `/api/gsi` because SvelteKit's CSRF check would reject it.
- `heartbeat` in the cfg is 10 s, so the live view treats more than 15 s of silence as stale.
- Numbers may arrive as strings in some sections; the schema coerces them.

## When you get a real capture

1. Anonymise it: `yarn gsi:anonymise captures/gsi-….ndjson fixtures/real/<name>.ndjson` (see the
   `gsi-replay` skill).
2. List the fields it actually contains, per situation, and compare with the tables above.
3. Update `schema.ts`, this file and the simulator so synthetic fixtures match reality, then
   `yarn gsi:fixtures` and `yarn test`.
