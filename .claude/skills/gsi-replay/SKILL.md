---
name: gsi-replay
description: Replay a recorded or synthetic GSI sequence into a running CS2Live server, and turn a real capture into a committed fixture (trimming and anonymising). Use when testing the live view, overlay, match tracking or saving without launching CS2, when reproducing a tracking bug, or when adding a fixture.
---

# GSI replay and fixtures

## Replay into a running server

```sh
yarn dev                                   # or yarn live; needs GSI_TOKEN in .env
yarn gsi:replay fixtures/synthetic/full-match.ndjson --speed 20
```

| Option             | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `--speed <n>`      | n× faster than recorded (default 1)                                 |
| `--instant`        | no waiting (round timers become meaningless; fine for saving tests) |
| `--max-gap <s>`    | cap any single wait (default 20 s)                                  |
| `--as <steamid>`   | rewrite the recorder's Steam ID, so a fixture is tracked as _you_   |
| `--from <n>`       | skip the first n payloads                                           |
| `--url`, `--token` | endpoint and token (default `GSI_URL` / `GSI_TOKEN` from `.env`)    |

The server only records payloads from its configured Steam ID (set on `/setup` or `STEAM_ID`).
The synthetic fixtures use `76561202255165729`; either set that or pass `--as <your id>`.

Watch `/live` and `/overlay` while it plays. For an end-to-end save check use the `verify`
skill (`yarn verify:replay`).

Don't run two replays against one server at once: the tracker sees interleaved games and churns
between incomplete and resumed matches.

## Synthetic fixtures

`fixtures/synthetic/*.ndjson` come from the simulator: `yarn gsi:fixtures` regenerates them
(`scripts/make-fixtures.ts`, scenarios listed in `fixtures/README.md`). Never edit them by
hand; change the simulator and regenerate. Tests depend on them.

## Real captures → fixtures

1. Capture: `GSI_CAPTURE=1` in `.env`, run `yarn live`, play. Files land in `captures/`
   (gitignored), one JSON per line; the first line is `{"meta":…}` with the request headers.
2. Find the interesting part. Payload index = line number − 2 (the meta line is not counted):
   ```sh
   node -e "require('fs').readFileSync(process.argv[1],'utf8').split('\n').slice(1).forEach((l,i)=>{try{const p=JSON.parse(l).p;console.log(i,p.map?.phase,p.round?.phase,p.map?.round,p.player?.steamid===p.provider?.steamid?'self':'other')}catch{}})" captures/gsi-xyz.ndjson
   ```
3. Trim and anonymise in one go:
   ```sh
   yarn gsi:anonymise captures/gsi-xyz.ndjson fixtures/real/halftime.ndjson --from 1200 --to 1500
   ```
   Every SteamID64 (values and `allplayers` keys) becomes a consistent fake ID from
   `fakeSteamId(100)` up; player names become `Player 1…n` (the recorder is `Player 1`); clan tags are blanked; auth
   and sensitive headers are dropped. Map, weapon and stat fields are kept.
4. Check nothing personal is left: `grep -E "7656119|<your name>" fixtures/real/halftime.ndjson`.
5. Replay it as yourself: `yarn gsi:replay fixtures/real/halftime.ndjson --as <your id> --instant`.
6. If it exposes a bug, add a test that runs the fixture through the tracker
   (`src/lib/server/gsi/testing.ts` has `loadFixture` / `runFrames`).

## Format

```
{"meta":{"startedAt":"…","appVersion":"…","headers":{"content-type":"application/json"}}}
{"t":1793556000000,"p":{"provider":{…},"map":{…},"round":{…},"player":{…}}}
```

`t` = when the server received it (epoch ms), `p` = the payload without `auth`.
