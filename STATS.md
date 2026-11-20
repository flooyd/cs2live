# Stats glossary

How every number on CS2Live is worked out, and how much to trust it. Each stat carries one tag:

- **OBSERVED**: CS2 sent it directly in a GSI payload.
- **DERIVED**: plain arithmetic on observed values.
- **INFERRED**: worked out from how values changed between payloads. Usually right, can be off.
- **ESTIMATED**: a rule of thumb applied to observed values. It is a label, not a fact.
- **PARTIAL**: about another player, seen only while the recorder spectated them.

The same tags are on the database columns (`drizzle/0001_column_comments.sql`). In the UI, inferred
and estimated values are underlined with dots and explain themselves on hover.

GSI only describes the person running the game, plus whoever they spectate while dead. There is
no kill feed and no scoreboard, so nothing about enemies is ever recorded.

Stats on a player's Stats page come only from matches **that player recorded**. Partial sightings
have no round data, so they appear in match lists but not in stats.

## Per match

| Stat                                | Tag      | Definition                                                                                                                                                                                         |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kills, assists, deaths, MVPs, score | OBSERVED | `player.match_stats` at the last payload of the match.                                                                                                                                             |
| Result                              | DERIVED  | `win` / `loss` / `tie` from the final team scores and the recorder's side. `incomplete` matches (left, crashed, timed out) have no result.                                                         |
| Score                               | OBSERVED | `map.team_ct.score` / `team_t.score`, shown as the recorder's team first.                                                                                                                          |
| Rounds played                       | DERIVED  | Rounds the recorder saw finish. Lower than the score total if they joined mid-match.                                                                                                               |
| Damage                              | INFERRED | Sum over rounds of the highest `player.state.round_totaldmg` seen in that round. Damage done after you die is not sent, so it is missed.                                                           |
| ADR                                 | DERIVED  | Damage ÷ rounds played.                                                                                                                                                                            |
| HS%                                 | INFERRED | Headshot kills ÷ kills counted round by round, × 100. Both come from `round_killhs` / `round_kills`, so kills not seen round by round are left out of the base.                                    |
| K/D                                 | DERIVED  | Kills ÷ deaths (kills when there are no deaths).                                                                                                                                                   |
| Joined mid-match                    | OBSERVED | The first payload was already past round 1; the first round number is stored.                                                                                                                      |
| Linked recordings                   | INFERRED | Two players' recordings are the same game when map and mode match, they started within ten minutes of each other, and the final score is the same from either side (or one of them is incomplete). |

## Per round

| Stat            | Tag       | Definition                                                                                                                                                                                               |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Side            | OBSERVED  | `player.team` during the round.                                                                                                                                                                          |
| Won / lost, how | OBSERVED  | `map.round_wins[n]`, e.g. `t_win_bomb`. The win reason gives the winning side.                                                                                                                           |
| Kills, HS kills | OBSERVED  | Kills: the larger of the highest `round_kills` seen and the rise in `match_stats.kills` over the round. HS kills: the highest `round_killhs`, capped at kills. Joining mid-round can miss earlier kills. |
| Damage          | INFERRED  | The highest `round_totaldmg` seen in the round.                                                                                                                                                          |
| Survived        | INFERRED  | Your `match_stats.deaths` did not go up, health never hit 0, and you were never seen spectating. Unknown for rounds joined part-way.                                                                     |
| Money           | OBSERVED  | `player.state.money` when freeze time started (before buying).                                                                                                                                           |
| Equipment value | OBSERVED  | `player.state.equip_value` when freeze time ended (after buying).                                                                                                                                        |
| Buy type        | ESTIMATED | See below.                                                                                                                                                                                               |
| Primary weapon  | OBSERVED  | The rifle, SMG, shotgun, sniper or machine gun in your loadout when freeze time ended.                                                                                                                   |
| MVP             | OBSERVED  | `match_stats.mvps` went up during the round.                                                                                                                                                             |

### Buy type (ESTIMATED)

From your own money and equipment only; GSI says nothing about what teammates bought. Thresholds
live in `src/lib/cs2/economy.ts` (`BUY_THRESHOLDS`).

| Buy      | Rule                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pistol   | First round of a regulation half, or a round right after a side switch that you started with $1000 or less (covers mid-match joins). |
| Full buy | Equipment value ≥ $4000.                                                                                                             |
| Force    | Equipment value ≥ $2000.                                                                                                             |
| Save     | Equipment value < $2000 although you started freeze time with ≥ $3000: you chose not to buy.                                         |
| Eco      | Equipment value < $2000 and you started freeze time with < $3000.                                                                    |

### Kill events (INFERRED)

GSI has no kill feed. A kill event is recorded each time `round_kills` goes up between two
payloads. It is a headshot if `round_killhs` went up by the same amount, and its weapon is the
**active weapon in that payload**. Two kills between payloads become two events with the same
weapon. A kill with a grenade or the bomb gets whatever was in your hand. Weapon tables are built
from these events.

## Player stats page

All sums run in SQL (`src/lib/server/db/stats/player-stats.ts`) over the player's recorded
matches, after the map, mode and period filters.

| Stat              | Tag       | Definition                                                                                                     |
| ----------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| Matches, W/L/T    | DERIVED   | Count of recorded matches by result; unfinished ones are counted separately.                                   |
| Win rate          | DERIVED   | Wins ÷ (wins + losses + ties). Incomplete matches are left out.                                                |
| K/D               | DERIVED   | Total kills ÷ total deaths.                                                                                    |
| ADR               | INFERRED  | Total damage ÷ total rounds played (not the average of per-match ADR, so long matches weigh more).             |
| HS%               | INFERRED  | Total headshot kills ÷ total kills counted round by round.                                                     |
| KPR               | DERIVED   | Kills ÷ rounds played.                                                                                         |
| Played            | OBSERVED  | Sum of match durations (first to last payload).                                                                |
| Recent form       | INFERRED  | ADR of each of the last 20 matches, oldest first.                                                              |
| CT vs T           | INFERRED  | Per side: rounds won ÷ rounds, ADR, kills per round, and survival (survived ÷ rounds where survival is known). |
| Multi-kill rounds | OBSERVED  | Rounds with exactly 2, 3 or 4 kills, and aces (5).                                                             |
| Maps, modes       | DERIVED   | The match stats above, grouped by map or mode.                                                                 |
| Buy types         | ESTIMATED | Per estimated buy type: rounds, rounds won ÷ rounds, ADR, and average equipment value.                         |
| Kills by weapon   | INFERRED  | Kill events grouped by weapon, top 12, with the share that were headshots.                                     |

## Partial sightings (PARTIAL)

While the recorder is dead, CS2 sends the spectated player's `player` block. CS2Live keeps the
last values seen for each spectated player in that match: name, team relative to the recorder,
kills, assists, deaths, MVPs, score, and the first and last round they were seen. These are
**as last seen, not final**, and there is no damage or round data for them. A sighting is never
shown for a game the player recorded themselves, and one game seen by several recorders counts once.
