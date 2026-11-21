---
name: cs2-gsi-reference
description: Field reference for CS2's Game State Integration payloads - which sections and fields arrive in which situations (alive, dead/spectating, warmup, halftime, gameover, observer), the provider vs player steamid rule, round_wins reasons and known quirks. Use whenever touching GSI parsing, the zod schema, the match tracker, the round builder or anything that reads a payload.
---

# CS2 GSI reference

> **Status: partly verified.** One real match is checked in: `fixtures/real/wingman-inferno.ndjson`
> (Wingman, playing not observing, GSI `provider.version` 14200, Nov 2026). A Deathmatch session
> agreed with it. Lines marked **(seen)** are confirmed by real data; **(verify)** lines are still
> from Valve's CS:GO-era docs, community notes and our simulator. When a new capture arrives,
> diff it against this file and `src/lib/server/gsi/schema.ts` and fix both. Real data wins.
> Still never captured: Competitive/Premier, overtime, observer (`allplayers`).

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

| Section               | Sent while playing                    | Notes                                                                                                                                                                        |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`            | always                                | `steamid`, `timestamp` (seconds), `appid` 730, `version`, `name` "Counter-Strike: Global Offensive" **(seen)**                                                               |
| `map`                 | in a server; absent in the main menu  | `name`, `mode`, `phase`, `round` (rounds completed), `team_ct/team_t`, `round_wins`, `num_matches_to_win_series` **(seen)**                                                  |
| `round`               | in a server, not in warmup            | `phase`, `win_team` (during `over`), `bomb` (`planted`, `defused` seen; `exploded` **(verify)**)                                                                             |
| `player`              | almost always (menu: just id/name)    | you, or the spectated teammate (see above). **Missing entirely** in some `over` payloads after your whole team died **(seen)**. Also `clan` (your clan tag), `observer_slot` |
| `player.state`        | in a server                           | `health`, `armor`, `helmet`, `money`, `equip_value`, `round_kills`, `round_killhs`, `flashed`, `smoked`, `burning`, `health_c4_preview`, `defusekit` **(verify)**            |
| `player.match_stats`  | in a server                           | `kills`, `assists`, `deaths`, `mvps`, `score` **(seen)**                                                                                                                     |
| `player.weapons`      | in a server                           | `weapon_0..n` with `name`, `paintkit`, `type`, `state` (`active`/`holstered`), `ammo_clip`, `ammo_reserve`. **Empty** in the payload where you die **(seen)**                |
| `phase_countdowns`    | **not sent while playing** **(seen)** | observer only, probably; `phase_ends_in` is a **string** of seconds **(verify)**                                                                                             |
| `bomb`, `grenades`    | observer only **(verify)**            | never relied on                                                                                                                                                              |
| `allplayers*`         | observer only                         | keyed by SteamID64                                                                                                                                                           |
| `previously`, `added` | most payloads                         | diffs against the last payload; we ignore them                                                                                                                               |

**`round_totaldmg` is not sent by CS2** **(seen)**: it was in none of the 314 payloads about the
player in the real match, nor in the Deathmatch session. Damage and ADR cannot be measured from GSI.
CS2Live stores damage as `null` (unknown) and shows "—" until it reads the official match demo after
the game (`src/lib/server/demos/`); ADR only counts rounds with damage. The
simulator still sends `round_totaldmg` on purpose, so that code path stays tested.

## Phases

- `map.phase`: `warmup` → `live` → (`intermission` at halftime) → `live` → `gameover`.
  The tracker starts a match on `warmup`/`live`, ends it on `gameover`.
- **The last round never reaches `over`** **(seen)**: CS2 goes straight from `live` to
  `map.phase: gameover` with **`round.phase: freezetime`** and `map.round` = rounds played. The
  round builder treats gameover as the end of the open round, never the start of a new one.
- Halftime arrives as `map.phase: intermission` with `round.phase: over` **(seen)**.
- `team_ct` / `team_t` scores follow the sides, so they swap at halftime: 6:2 before, 2:6 after
  **(seen)**.
- `round.phase`: `freezetime` → `live` → `over`. During `over`, the team score may or may not
  include the round that just ended yet **(verify)**; `round_wins` is the source of truth for
  results.
- Main menu: `map` and `round` are missing. After `INCOMPLETE_TIMEOUT_S` (default 120 s) with no
  in-match data, an unfinished match is saved as `incomplete`; a reconnect to the same game
  within the resume window continues the same match id.

## `map.round_wins`

`{ "1": "ct_win_elimination", "2": "t_win_bomb", ... }`, keyed by round number, for the whole
match so far (also after a mid-match join). Reasons seen in CS:GO and assumed for CS2:

`ct_win_elimination`, `t_win_elimination`, `ct_win_defuse` **(seen)**; `t_win_bomb`,
`ct_win_time`, `ct_win_rescue`, `t_win_hostage`... and surrenders **(verify the exact strings)**.
`parseWinReason` only relies on the `ct_` / `t_` prefix and a keyword, so new variants degrade
to kind `other` instead of breaking.

## Modes (`map.mode`)

`competitive` and `premier` (MR12: 24 rounds, halves of 12, MR3 overtime), `scrimcomp2v2`
(Wingman: 16 rounds, halves of 8, first to 9 **(seen)**), `casual`, `deathmatch` **(seen)** and
others (no halves). Premier may report as `competitive` **(verify)**.

Wingman money differs from Competitive **(seen)**: $8000 cap, loss bonus $2000 then +$300 per
loss in a row, $2750 for an elimination win. `src/lib/cs2/economy.ts` has both rule sets
(`economyRules(mode)`). After a win, `consecutive_round_losses` dropped from 5 to 3, then to 2.

## Known gaps and quirks

- No kill feed, no enemy data, no 10-player scoreboard. Kill events and weapons are INFERRED
  from `round_kills` going up (see `STATS.md`).
- No damage at all: `round_totaldmg` is not sent (see Sections).
- Dying inside the buy window: the death payload still describes you (`health` 0) with full
  `equip_value` but an empty `weapons` block, and a kill pays its reward into `money` at once.
  The buy snapshot stops at your first kill or death for that reason.
- Joining mid-round: `round_kills` may already include kills from before you were watching.
- CS2 sends `Content-Type: application/json` and `User-Agent: Valve/Steam HTTP Client 1.0 (730)`
  **(seen)**. `scripts/live.ts` still forces JSON for `/api/gsi` in case that ever changes.
- `heartbeat` in the cfg is 10 s, so the live view treats more than 15 s of silence as stale.
- Numbers may arrive as strings in some sections; the schema coerces them.

## When you get a real capture

1. Anonymise it: `yarn gsi:anonymise captures/gsi-….ndjson fixtures/real/<name>.ndjson` (see the
   `gsi-replay` skill).
2. List the fields it actually contains, per situation, and compare with the tables above.
3. Update `schema.ts`, this file and the simulator so synthetic fixtures match reality, then
   `yarn gsi:fixtures` and `yarn test`.
