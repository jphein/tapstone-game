# Runbook — a whole match over the real radio

Part of tapstone#132 (item 1). Two `tapstone-gw` boards (smol#549) on one host's USB: every frame
between the arena and seat B crosses both gateways and the ESP-NOW air.

- **Seat A** is the arena's remote seat (0038) in **gateway mode**, played over `/remote/*` exactly
  the way `tools/remote_smoke.py` (and Roblox) plays it. The arena's `SerialLink` holds board 61.
- **Seat B** is `radio_shrine play`: a desk-style shrine (the reference `Follower` plus a
  `ScriptedSeat`) whose `SerialLink` holds board 62. It stands in for shrine firmware.

| board | node | MAC | role |
|---|---|---|---|
| 61 | 61 | `14:C1:9F:D1:C6:38` | arena gateway (seat A's link) |
| 62 | 62 | `14:C1:9F:D1:C0:88` | shrine gateway (seat B) |

Both must answer `@TS1 PING` with `HELLO <mac> <node> <fw> <epoch>` (fw `1f400a7` tonight).

## 1. Build (on a build host, not the board host)

```sh
cd rust
cargo build --release -p tapstone-arena --features server --bin tapstone-arena --bin radio_shrine
cargo build --release -p tapstone-sim
```

## 2. Deploy

Copy `tapstone-arena`, `radio_shrine`, `tapstone-sim`, `tools/radio_match.py` and
`tools/radio_verify.py` into one bin dir on the host with the boards
(`rsync -rlpi --checksum`, so you can see what actually changed). The arena finds its deck book at
the baked repo path; copy `decks/` there too if the host has no checkout.

## 3. Configs, the scratch ledger and the registry

`radio_match.py` writes all of them into a fresh `--run-dir` (it refuses one that exists), and
never touches `~/.config/tapstone-arena` or a real ledger:

- `arena.toml` — `gateway_mac` (board 61), `http_bind` (loopback), `ledger_path`, `registry_path`,
  all inside the run dir.
- `registry.jsonl` — `radio_shrine registry --deck tide-neutral --index 0`: seat B's figurine plus
  one row per physical copy (26 rows for tide-neutral). Gateway mode's registry is **strict**: it
  resolves every claim, cast and charge by UID. The remote seat's copies are *virtual* and are
  added at startup by `RemoteLink::at_gateway`, which refuses any virtual UID that names a real row.
- `ledger.sqlite` — a scratch ledger. `config.rs` refuses a ledger under `/tmp` or `/var/tmp`, so
  the run dir lives under `$HOME` (tonight: `~/tapstone-radio-orion/<run>/`).

## 4. Run

```sh
B=<bin dir>; R=~/tapstone-radio-orion
python3 $B/radio_match.py --bin-dir $B --run-dir $R/run-c21 \
  --arena-mac 14:C1:9F:D1:C6:38 --shrine-mac 14:C1:9F:D1:C0:88 --seed 21
```

It starts the arena (`--remote ember-neutral --once`, with `TAPSTONE_SERIAL_TRACE`), reads the join
code, starts `radio_shrine play` on board 62 (tide-neutral, `--trace`, `--summary shrine.json`),
joins over `POST /remote/join`, and plays seat A through `/remote/view`, `/remote/choices` and
`/remote/propose`. Exit 0 means the arena finished the match and the shrine heard `RESULT`; the
summary is in `radio_match.txt`. Wall time is about 10 s.

## 5. Verify

```sh
python3 $B/radio_verify.py $R/run-c21 $B/tapstone-sim        # exit 0: VERIFIED
$B/radio_shrine report --arena $R/run-c21/arena.trace --shrine $R/run-c21/shrine.trace > $R/run-c21/report.txt
```

`radio_verify.py` reads only what the arena wrote (`ledger.sqlite`, with Python's `sqlite3`) and what
the shrine computed on the far side of the air (`shrine.json`). It checks that `tapstone-sim replay`
re-derives every hash of the transcript, that the journal equals the transcript, that the TSX1 bytes
and their SHA-256 match `transcript_sha`, and that the ledger, the transcript and the shrine agree on
the final chain head. Perturbing a journal hash, a transcript record, a TSX1 byte or the shrine head
each gives exit 1.

`report` joins both boards' TX/RX trace lines into per-leg delivered, lost and latency counts. Lost
frames are split into air, `txerr` (the gateway refused to send), unanswered (sent by a process that
was already exiting), and `after_close` (arrived after the other side's trace ended). None of those
three is air loss. `src_mismatch` counts RX whose link-layer src differs from the frame header (see
Known faults).

## 6. The stall control

```sh
python3 $B/radio_match.py ... --run-dir $R/control-c2 --seed 24 --no-propose
```

Seat B proposes nothing, so the match must **not** finish. Exit 0 means `CONTROL OK: no result in
90 s`; exit 1 means a match finished with a silent seat. Expect about 8 `match_records` (claims plus
the remote's draws), with the remote seat stuck waiting after ~6 taps.

## Known faults (bench, 2026-09-26/27)

- **Gateway roster poisoning (firmware, smol).** A gateway's `ROSTER` sometimes puts its *own* id
  on the peer's MAC (board 62: `62:14:c1:9f:d1:c6:38`; board 61: `61:14:c1:9f:d1:c0:88`),
  apparently learned from the peer relaying its own frames. The receiver then labels the peer's
  frames with the wrong src, and `TX dst=<own id>` gets refused (`txerr`). The arena drops frames
  named as its own node (`core/mod.rs`). Without that guard, run-s14 seated node 61 (itself) and
  stalled in the lobby. The shrine retransmits, so the correctly named copy is the one that counts.
- **Stale FIFO prefix.** The S3's USB-Serial-JTAG keeps a partial line while no host reads, so the
  first line after open is `@TS1 @TS1 HELLO …`. `SerialLink::await_hello` pings until it gets a
  clean HELLO.
- **Port lock.** `serialport` opens with `TIOCEXCL`. A port still held by an exiting process fails
  to open, and `radio_shrine` retries for 5 s.

## Evidence (katana, fw 1f400a7)

a->s = arena→shrine, s->a = shrine→arena; delivered/tx, then the air-lost count.

| run | build | match | records | wall | winner | verify | a->s | s->a | src_mismatch |
|---|---|---|---|---|---|---|---|---|---|
| run2 | pre-guard | 57b8ae50 | 70 | 9.3 s | 1 | VERIFIED | 79/80, air 0 | 107/110, air 0 | – |
| run-s12 | pre-guard | 57b8af8c | 61 | 9.0 s | – | VERIFIED | air 0 | air 0 | 0/0 |
| run-s13 | pre-guard | 57b8af98 | 65 | 9.0 s | – | VERIFIED | – | air 2 of 98 | – |
| run-s14 | pre-guard | 57b8b212 | – | – | – | **STALL**: seated itself (nodes [61,165]) | – | – | – |
| run-g14 | guard | 57b8b2c2 | – | 9.3 s | 1 | VERIFIED | 71/72, air 1 | 95/98, air 0 | 0/0 |
| run-g15 | guard | 57b8b2ce | – | 12.5 s | 1 | VERIFIED | 97/101, air 1, txerr 3 | 132/157, air 0, txerr 22 | 10/33 |
| run-g16 | guard | 57b8b2df | – | 12.4 s | 0 | VERIFIED | – | – | – |
| run-c21 | 6dca192 | 57b8d220 | 62 | 9.1 s | 1 | VERIFIED | 72/73, air 0 | 95/98, air 0 | 0/0 |
| run-c22 | 6dca192 | 57b8d229 | 62 | 10.1 s | 1 | VERIFIED | 76/78, air 1 | 97/118, air 0, txerr 17 | 4/5 |
| run-c23 | 6dca192 | 57b8d233 | 68 | 9.1 s | 1 | VERIFIED | 80/82, air 2 | 104/107, air 2 | 0/0 |
| control1 | pre-guard | 57b8aece | 8 | 98.8 s | — | CONTROL OK (stalled) | – | – | – |
| control-c2 | 6dca192 | – | 8 | 97.0 s | — | CONTROL OK (stalled) | 102/103, air 1 | 91/106, air 0, txerr 14 | 14/15 |

Every `txerr` burst coincides with a poisoned roster line, and the air itself lost at most 2 frames
per leg per match. The protocol's 100 ms retransmit absorbed all of them.

## Real shrines: smol's station firmware (tapstone#132 item c, 2026-09-27)

The steps above have a desk-style process stand in for the shrine. Here both seats, or seat B
alone, are **smol's shrine station firmware** (`--features tapstone-station`). Its seat is
`tapstone_proto::shrine::Shrine`, the state machine the arena's tests run as `DeskShrine`, and it
chooses its taps with `shrine::Autoplay` until a reader is wired. One image carries the
`tapstone-gw` bridge too.

- **Build** in smol `rust/clock`. Use the S3 recipe with `esp32s3,hw,tapstone-station,espnow,cast`
  and **no `io`**, since P3 belongs to a reader. Bake the seat in at build time:
  - `SMOL_NODE_ID`
  - `TAPSTONE_DECK` (`ember-neutral` | `tide-neutral`)
  - `TAPSTONE_INDEX` (the registry index)
  - `TAPSTONE_STATION_NODE`, on the board whose USB holds the arena. The arena drops every frame
    from its own gateway's node as an echo, so seat A there needs its own id (161).
  - `TAPSTONE_NO_PROPOSE=1` for the stall control.
- **Keys:** build the stations with the same `secrets.rs` as the gateway they talk through. A
  station with another group key sees the arena's frames as `BadTag` and refuses them.
- **Decks:** the arena binaries find `decks/` relative to the path they were built at. Build them
  from a source tree at a path that exists on the board host too (tonight
  `~/tapstone-radio-selene/src/tapstone`), and copy `decks/` there.

```sh
# (i) two real shrines: board 61 = the arena's radio + seat A (ember, index 0, station node 161),
#     board 62 = seat B across the air (tide, index 1)
python3 $B/radio_table.py --bin-dir $B --run-dir $R/run-t6 \
  --arena-mac 14:C1:9F:D1:C6:38 --shrine-mac 14:C1:9F:D1:C0:88
python3 $B/radio_verify.py $R/run-t6 $B/tapstone-sim       # shrine.json is board 62's head
# (ii) a real shrine against the remote seat: board 61 runs plain tapstone-gw, board 62 the station
python3 $B/radio_match.py --bin-dir $B --run-dir $R/run-r2 --arena-mac 14:C1:9F:D1:C6:38 \
  --shrine-mac 14:C1:9F:D1:C0:88 --firmware-shrine --shrine-index 1 --shrine-deck tide-neutral
```

The station's head comes from its console. Every 2 s it prints a `[station] status …` line, then
`[station] FINAL match <id> … head <h>` once its game is over and `[station] RESULT match <id>` when
it hears `R`. `radio_table.py` writes each seat's `shrine-{a,b}.json` from those lines. Board A's
lines arrive in the arena's serial trace.

| run | seats | key | match | records | wall | verify | control |
|---|---|---|---|---|---|---|---|
| run-t4 | two stations | CI throwaway (both) | 57b95826 | 105 | 17.7 s | VERIFIED, both heads | run-t5: stuck at mseq 13, CONTROL OK |
| run-t6 | two stations | fleet | 57b95b7d | 95 | 14.7 s | VERIFIED | — |
| run-r2 | station vs /remote/* | fleet | 57b95acd | 83 | 6.3 s | VERIFIED | run-r3: remote 6 taps, CONTROL OK |

Found while getting there (smol firmware): the arena heads its frames with its gateway's node, not
200, so the station recognises the arena by what it sends. After a match the station holds the
result for 10 s before claiming again; before that hold, its rematch claim put a second match in
the scratch ledger.
