# Tapstone mesh protocol — DRAFT

**Status:** draft, 2026-09-20, unreviewed. Companion: [`state-machine.md`](state-machine.md).
Fits into SMOLv1 as documented in `~/Projects/smol/docs/protocol.md` and `rust/clock/src/net/wire.rs`;
where this draft and smol's code disagree, smol wins and this doc is wrong.

## 1. Model

> **2026-09-23 (0006, 0028):** the arbiter is the arena, which is present at every match, not seat 0's shrine. A shrine arbitrates only in recovery. The rest of this section predates both decisions.

Decision 0004: both shrines run the same deterministic rules engine over the same ordered list of
tap events. The mesh carries **proposals, commits and hashes** — never opinions about the board.

- **Seat.** A player position, `0..3`. v1 uses seats 0 and 1; seats 2–3 are spectators (or 2v2 later —
  the seat field is a byte either way).
- **Arbiter.** Seat 0's shrine. It is the *only* node that assigns match sequence numbers (`mseq`).
  A tap becomes an event only when the arbiter commits it; every engine applies commits in `mseq`
  order and nothing else. There is no vote and no merge.
- **Chain hash.** After applying commit *n*, each engine computes
  `h_n = SHA-256(h_{n-1} ‖ record_n ‖ canonical_state_n)[..8]`; `h_0` is taken over the house rules
  when the game leaves the Lobby (§3.1, normative in `rust/tapstone-rules/src/hash.rs`). The arbiter
  puts its `h_n` on every commit; a follower whose `h_n` differs **halts** (§5). `sha2` is already
  in the smol tree (OTA, group-MAC), so this costs no new dependency.
- **Randomness.** The only random act is the opening coin; `coin = match_id & 1`. Shuffling is
  physical. The engine's RNG, if a card set ever needs one, is seeded from `match_id` and advanced
  once per commit — still deterministic.
- **Canonical state** is the snapshot encoding (§4.6). One encoder, two uses: hashing and transfer.

The arbiter is *not* the mesh crown: a crown's WiFi burst deafens it for up to ~15 s (single-radio,
`protocol.md` "COEXIST"). A crown at the table is the **HA relay** (§6) or a spectator, never the
node that must answer a tap within 200 ms. Election fitness is used once, at pairing (§4.2), to
order candidates — not to crown.

## 2. Frame family: `SMOLv1 MATCH `

One new prefix, one `kind` byte, binary after the prefix (the SNK/FAM precedent — density is
justified because every byte competes with the 9-byte group-MAC trailer). Byte 7 = `'M'` is
unused by every existing tag (`H A B T G C S D R U F E O L`), so `classify()` gains one
`starts_with` branch and can never mis-parse an old frame.

**Common header, 20 B.**

| off | B | field | meaning |
|---|---|---|---|
| 0 | 13 | tag | `b"SMOLv1 MATCH "` |
| 13 | 1 | `ver` | =1; a parser ignores trailing bytes it does not know (SNK's length-tolerance rule) |
| 14 | 1 | `kind` | ASCII letter, table below |
| 15 | 4 | `match` | u32 LE match id; `0` in LOBBY |
| 19 | 1 | `src` | sender node id (u8; shrines are the S3 block `160–175`, #388) |

The `send_to` choke appends the 9 B trailer, so the payload budget is **250 − 20 − 9 = 221 B**.
Every size below is pre-trailer, as in `protocol.md`.

| kind | name | cast | payload B | frame B | on air | §
|---|---|---|---|---|---|---|
| `L` | LOBBY | broadcast, 2 s | 18 | 38 | 47 | 4.1 |
| `P` | PAIR | unicast | 4 | 24 | 33 | 4.2 |
| `B` | BEGIN | arena → shrines: broadcast at match start, unicast on retransmit and on a seat's `J` | 9 + 2 + 8 + 2 × (1 + 2 × 30) = ≤141 | ≤161 | ≤170 | 4.2b |
| `T` | TAP (proposal / reject) | unicast → arbiter | 27 (proposal: `sub` 1 · `lseq` 2 · record 24) / 4 (reject: `sub` 1 · `lseq` 2 · reason 1) | 47 / 24 | 56 / 33 | 4.3 |
| `C` | COMMIT | broadcast | 36 (`mseq` 2 · `lseq` 2 · record 24 · hash 8; arena spec §6) | 56 | 65 | 4.3 |
| `A` | ACK | unicast → arbiter | 10 | 30 | 39 | 4.4 |
| `N` | NAK (replay request) | unicast → arbiter | 4 | 24 | 33 | 4.4 |
| `J` | JOIN | unicast → arbiter | 3 | 23 | 32 | 4.6 |
| `S` | SNAP chunk | unicast / broadcast | 6 + ≤200 = ≤206 (`last_lseq` +4 when spectators land, §4.6) | ≤226 | ≤235 | 4.6 |
| `Q` | SNAP-NAK | unicast → arbiter | 10 | 30 | 39 | 4.6 |
| `X` | HALT | broadcast | 19 | 39 | 48 | 5 |
| `R` | RESULT | broadcast | 45 (unsigned, `sig_kind 0`: playtest one, arena spec §11) / 77 (HMAC) / 109 (Ed25519) | 65 / 97 / 129 | 74 / 106 / 138 | 4.8 |
| `D` | DOLL | arena → shrine | 43 | 63 | 72 | arena spec §6.2 |
| `E` | EQUIP | shrine → arena | 11 | 31 | 40 | arena spec §6.2 |
| `H` | HANDBACK chunk | recovering shrine → arena; interim → a rejoining seat (#76) | 5 + 4 (`last_lseq`) + ≤6 × 32 = ≤201 | ≤221 | ≤230 | 4.5; arena spec §6.3 |
| `K` | HANDBACK-NAK | arena → shrine | 10 | 30 | 39 | 4.5; arena spec §6.3 |

Unicast targets a node id; smol's roster already maps id → MAC (`add_peer` on first HELLO).

## 3. Event record (the transcript atom, 24 B)

**Normative:** `rust/tapstone-rules/src/event.rs` (`Record::encode`/`decode`). Used verbatim inside
`T`, `C` and the transcript. Little-endian, fixed layout; the seat/lseq/ts/ms/gesture/intent layout
of the morning draft is **superseded as of 2026-09-20**.

| off | B | field | meaning |
|---|---|---|---|
| 0 | 2 | `seq` | u16, the arbiter's match sequence number (`mseq`); a follower applies in `seq` order |
| 2 | 1 | `seat` | 0–1 in v1 (the byte allows 0–3) |
| 3 | 1 | `kind` | 1 ClaimSeat · 2 Mulligan · 3 Charge · 4 CastUnit · 5 CastSpell · 6 Advance · 7 Pass · 8 Leave · 9 Draw; anything else fails to decode. **8 Leave is reserved in v0**: it decodes, and the engine always refuses it with `NotPlaying`. **9 Draw** (0036): `card` is the design tapped as it is drawn. Legal only while the seat owes a draw (else `NoDrawOwed`) and an undrawn copy is in its list (else `NotInDeck`). While a seat owes, any other tap is `DrawOwed`. A seat owing its opening hand may draw during the other seat's turn |
| 4 | 2 | `card` | u16 design index, resolved by the arbiter from the UID registry; `0` when the kind needs no card |
| 6 | 1 | `lane` | i8, 0–2 for CastUnit/Advance; for **ClaimSeat** the commander's keyword code (2 Haste · 4 Taunt; 0 Ranged, 1 Shield 1 and 3 Rush are refused, 0034) or −1 for none (0029); −1 otherwise |
| 7 | 1 | `target` | spell target byte: `seat<<4 \| lane<<2 \| cell`; `0xFF` = enemy castle; bits 5–7 reserved and ignored. For **ClaimSeat**: the commander's final attack |
| 8 | 1 | `aux` | kind-specific; for a Shift spell `0` = toward lane 0, `1` = toward lane 2; for **ClaimSeat** the commander's final toughness (0 is refused, so a pre-commander claim fails closed) |
| 9 | 1 | reserved | zero on encode, ignored on decode |
| 10 | 4 | `time_ms` | u32, display and replay pacing only — **never ordering** |
| 14 | 7 | `uid` | the tapped tag's 7-byte UID, carried for the audit trail; the rules never read it |
| 21 | 1 | `auth` | 0 registry-only (NTAG215) · 1 NTAG 424 DNA SUN verified by the arbiter (§7) |
| 22 | 2 | reserved | zero on encode, ignored on decode |

**Decode rule.** A record is exactly 24 bytes on the wire; a decoder consumes the first 24 bytes of
the buffer it is given and ignores the rest; fewer than 24 is an error. The rules engine reads a
decoded `Record` and answers `Applied` or a `Refusal`; it never panics on any 24 bytes.

Ambiguity is resolved *before* the frame exists: a card that needs a lane shows the lane picker and
nothing is sent until the touch lands (FT6336U).

### 3.1 Hash chain

**Normative:** `rust/tapstone-rules/src/hash.rs`. `h_0 = SHA-256(b"tapstone:v0" ‖ house_rules_bytes ‖
per seat: commander attack, toughness, keyword code ‖ per seat: list length, then the deck list
sorted)[..8]` (`Chain::genesis(&Game)`; the rule bytes are the nine of `HouseRules::bytes()`, 0029;
the lists since 0036, so a reshuffle never moves `h_0`); `h_n = SHA-256(h_{n−1} ‖ record_n ‖ canonical_state_n)[..8]`
(`Chain::step`). The canonical image is **144 B** (`hash::CANON`, derived from its parts; asserted
against 0022's text by `tapstone-rules/tests/commander.rs`): a 6-byte header (round, active, phase,
winner, seq) then 69 B per seat (castle design, life, charged, spent, owed draws (0036; the byte
`deck_pos` held when the deck had an order), a flags byte, the
commander's attack, toughness, keyword code, return round and return lane, nine lane-major cells of
design/damage/entered_round, hand length and the ten hand slots). A commander's cell uses the
ordinary cell encoding with design `0xFFFE`. The flags byte is bit 0 charged
this round, bits 1–3 lane advanced, bit 4 acted, bit 5 mulliganed, bit 6 present. The `winner` byte
is 0xFF while the game runs and the seat number once it ends; the value 2 (`Winner::Draw`) is
**reserved and unused in v0** — ties break on units, then on seat 1. Hand contents are hashed on
purpose: state is fully replicated on both shrines and cards leave hands only through committed
events.

**Genesis contract.** The rules and both lists reach a shrine in `B` (§4.2b, #67), which also states
the arbiter's `h_0`. The chain starts when the game leaves the Lobby, after house rules and both
commanders' stats are final (the second `ClaimSeat`, after which both seats owe their opening hands
as `Draw` taps, 0036); lobby records are transcript-only and carry no
hash. The chain is over the committed record bytes as received; a follower never substitutes its
own `ms`/`uid`.

## 4. Flows

### 4.1 Discovery — LOBBY
While in the lobby a shrine broadcasts `L` every 2 s (the HELLO tick): `seat_pref` 1 ·
`deck_sigil` 4 (deck-list hash, the realm-sigil name shown to the opponent) · `ruleset` 4 (first
4 B of the running image's SHA-256 — the same image the signed OTA manifest names, so "same
firmware" means "same rules" by construction) · `registry` 4 (UID-map version hash) · `rules` 4
(house-rules hash, CFG key `M`, §8) · `flags` 1 (bit0 wants a match · bit1 accepts spectators ·
bit2 has WiFi and can post to HA · **bit3 = arena**, set only by the arena, arena spec §6.1). A peer with a different `ruleset`, `registry` or `rules` hash is
shown greyed with the reason; it cannot be paired with. The screen lists candidates nearest first
using the roster RSSI EWMA (Marauder's Watch, #58).

### 4.2 Pairing — PAIR
The player touches a candidate. The shrine sends `P sub=0 (offer) peer=<id>` carrying a proposed
`match = (my_id << 24) ^ unix_now` and the seat map (`seat0 = lower node id, seat1 = the other`).
The peer's screen asks; a touch answers `P sub=1 (accept)` or `2 (reject)`. Two simultaneous
offers: the one with the lower `match` wins, the other is dropped silently. **Arbiter = seat 0 =
the lower node id.** Deterministic, no round-trip, and the same rule works for four shrines.
Spectator shrines pair with `seat_pref = 2`; they receive commits, send no ACKs, and may NAK.

> **Amended by 0028 (2026-09-23, arena spec `docs/superpowers/specs/2026-09-23-arena-service-design.md` §5.1):** with an arena at the table, pairing goes through the
> arena. A player seats their shrine by tapping their castle figurine (a `ClaimSeat` proposal). Seats are
> assigned in claim order, and the arena assigns `match`. The first-claimed shrine is the recovery arbiter
> while the arena is dark (0006, 0029). The `P` exchange above is the arena-less fallback.

### 4.2b Match start — BEGIN (#67)
A shrine knows its own deck, but not which node took which seat, the other player's list, or (for
certain) the rules the arena runs, and genesis hashes all three (§3.1). So when the second claim
starts the match, the arena broadcasts **`B`** *before* the two `ClaimSeat` commits: `rules` 9
(`HouseRules::bytes()`) · `nodes` 2 (seat 0's node, then seat 1's: claim order) · `genesis` 8 (the
arena's `h_0`, taken on a copy of the game after both claims) · per seat `len` 1 then `len` × u16
designs, in the arena's order. At `DECK_MAX` = 30 that is 141 B, **one frame**: a const assert on
`BEGIN_MAX` fails the build if a bigger deck ever needs a per-seat split. A decoder refuses a `len` over
`DECK_MAX`. Commanders and castles are not in `B`; they ride in the `ClaimSeat` records, as before.
- **A follower builds its game only from `B`** (`Follower::awaiting`, `on_begin`) and learns its seat
  from `nodes`. Until `B` it applies nothing (`OnCommit::Unbegun`). It refuses a `B` that does not
  seat its own node, a `B` for another match while a game is in play (Playing, not halted, and its
  match's `R` not yet heard: a halted follower, or one that missed its last commit, must still take
  the next match's `B`), and a late `B` for the last
  match whose game it played (its chain started) once it has moved on to a newer one (Oracle on #86: a
  `B(N)` arriving after `B(N+1)` would otherwise pull it back). A `C` whose header names another match
  is dropped (`on_commit_in`, `OtherMatch`), never acked as a duplicate, and a shrine not in play that
  hears one asks with `J` for the match's `B`.
  **Known residual (corrected 2026-09-25):** any other stray `B`, whether older than that or for a
  match whose game never started, is taken while no game is in play. Match ids are
  `(node << 24) ^ unix`, which is not monotone, so none can be refused by order. The follower then
  holds the wrong game: it drops the live match's commits as `OtherMatch`, asks with `J`, retakes the
  live `B` from the answer and replays. That costs one `J` round-trip, and the follower heals itself;
  it neither halts nor locks out. (The paragraph merged in #86 said a desync would void the match. It
  would not: the stray `B` was recorded as "left", and the live `B` was then refused as stale until a
  reboot, a lockout that Oracle found. `left` now records only a game whose chain started.) Refusing
  stray `B`s outright would need a monotone match id. Within one arena process and across a revival
  from its journal, consecutive matches get different ids. A match voided at once and re-claimed
  used to start in the same unix second with the same `(node << 24) ^ unix`, so the arena bumps an
  id equal to the last match's, and a revived arena remembers the one it recovered. *Residual:* a
  clean restart (a new process with no journal of the last match) that starts a match in that
  match's second can still reuse its id. The arena drops an `A`, `X`, `T` or `N` whose header names
  another match (a stale `T` was committed into the running match, Oracle on #89), so a shrine
  stamps its play taps with the match id. `J` is exempt, because a shrine sends it, with id 0,
  exactly when it lacks the match's `B` and cannot know the id.
- **Genesis is checked where the chain starts.** On the record that starts the chain, the follower
  compares its own `h_0` with `B.genesis`; a difference is `X reason=hash` at that mseq, so a wrong list,
  rule or seat is caught before anything is hashed on. An all-zero `genesis` means not stated (a revived
  arena whose journal never reached the start); the first hashed commit then catches the same split.
- **Loss.** The arena re-sends `B` (unicast) ahead of each commit retransmit to a seat that has acked
  nothing. A shrine that hears a commit with no `B` sends `J role=seat have_mseq=0` once a second, and
  the arena answers a seat's `J` with `B`, then the full replay (§4.5).

### 4.3 Taps — TAP and COMMIT
Follower seat: reader debounces one UID per presence (spike-scry `main.rs` already does this),
intent resolved by touch, then `T sub=0` unicast to the arbiter, retransmitted every 100 ms until a
`C` carrying its `(seat, lseq)` arrives, or `T sub=1` (reject, `arg` = reason) comes back, or 2 s
pass (→ link-lost, §4.5). The arbiter validates against its engine; a legal tap becomes
`C mseq=n record hash=h_n`, broadcast. The arbiter's own taps skip the wire and enter the same
queue. Every engine, arbiter included, applies **only** commits, in `mseq` order, and rejects a
commit its own validation refuses — that refusal surfaces as a hash mismatch, not as a special case.

**Ordering of simultaneous taps.** Proposals arriving at the arbiter within `SIMUL_MS = 50` of
each other from different seats are ordered by (1) the turn owner first, (2) lower `ts`, (3)
lower `seat`. Outside that window: arrival order. `ms` is never consulted — the mesh clock is
seconds, local clocks are not comparable, and a rule that cannot be evaluated on both sides must
not exist.

**Idle repair.** The arbiter re-broadcasts its head `C` every 1 s while nothing else is flowing —
idempotent by `mseq`, and it doubles as the heartbeat.

### 4.4 Loss — ACK, NAK, replay
A follower answers each new `C` with `A mseq hash` (and beats `A` with its head every 1 s). The
arbiter retransmits a `C` that is unacked after 200 ms, five times, then declares the seat lost
(§4.5). A follower that sees `mseq` jump sends `N from to` (`to = 0xFFFF` = "to head"); the
arbiter replays from its ring of the last 64 commits. A gap older than the ring is answered with a
snapshot (§4.6). Duplicate `C` (already-applied `mseq`) is acked and dropped.

### 4.5 Disconnect and resume
No `A` for 3 s (`PEER_STALE_MS` idiom) → PAUSED: both screens show "link lost", the turn clock
freezes, taps are queued locally but not proposed. Any `MATCH` frame with the same `match` id ends
the pause: the follower NAKs its gap (or JOINs for a snapshot), then the queue drains. A rebooted
shrine that kept `match`, seat and head `mseq` (RAM, optionally an NVS journal — under 3 KB per
match, §6) rejoins the same way. 120 s without contact → RESULT `reason = timeout`, winner = the
seat still present. No match survives a power cycle of the arbiter in v1.
**Superseded for the arena by 0028 (2026-09-23):** a lost *arena* never times the match out. A shrine
holds the arbiter role from the last agreed hash and snapshot and the match waits until an arena
rejoins. The 120 s timeout stays for a lost *seat* only. The shrines keep full state in RAM, so the
rejoining arena's *state* comes from a snapshot (§4.6). What the arena loses is the **transcript**: a
snapshot is state, not records, and without the records the arena cannot post the transcript,
compute `transcript_sha` (§4.8) or feed the ledger. So every shrine keeps the match's full record list
(≈3.3 KB per hundred events, §6, in RAM), and the protocol needs a **transcript hand-back** frame from
the recovering shrine to the rejoining arena: that frame is `H`, with `K` for missing chunks (arena spec §6.3, §7). The NVS journal stays what it was: an option for a
shrine's own reboot, and its "under 3 KB" figure is smaller than a long transcript.
**Retransmits across a recovery (ruled 2026-09-23).** The hand-back carries each seat's highest
committed lseq (`H.last_lseq`, 2 × 2 B), and the arena seeds its dedupe from it, so a tap the interim
committed, whose `C` a seat lost and then retransmits, is not committed twice. The dedupe path is the
one it always was: `lseq ≤ last` for that seat. That is the rule, not an
assumption: **a shrine never proposes an lseq it has used in the match.** A rebooted shrine loses its counter,
so before it proposes it re-syncs, applying every `mseq` up to the highest it has heard in any `C` and
staying caught up for one head re-broadcast period (`HEAD_MS`, 1 s), or until it hears `R` (the first commits
heard may be an old retransmit, so the highest heard is not yet the head), and
resumes at its seat's last committed lseq + 1, learned from the re-synced records (their `C` frames carry
each tap's `(seat, lseq)`). Either path does it: NAKing its gap, or `J role=seat` (a seated shrine's `J`
is answered with `B` (§4.2b) and a full replay of the log, not a snapshot; a shrine that kept
nothing across the reboot has no `B`, so it must take the `J` path, and the NAK path needs the `B` it kept). The arena enforces it: on a used lseq it
re-sends the commit only if the proposal is the tap committed under it, and otherwise answers
`T sub=1 STALE_LSEQ` (107), so a counter that went backwards re-syncs instead of taking an old commit
as confirmation of a new tap. A shrine refused as stale moves its counter past the refused lseq.
**While the arena is dark, the interim answers a seat's `J` and `N` (#76).** A rebooted seat kept nothing, so
its `J` is answered with `B` rebuilt from the interim's own state, then `H` chunks (the hand-back's shape,
unicast to the seat) from the `J`'s `have_mseq` to the head. A seat's `N` gets the same chunks from `from`.
Each chunk carries the interim's per-seat `last_lseq`, because the records carry none. The seat re-sends `J`
from its `next_mseq` once a second until it has caught up. The interim stores no `B`: it has no budget
for 141 B. So each original list is rebuilt as the undrawn list, plus the hand, plus every card a
committed `Charge`, `CastUnit` or `CastSpell` of that seat took out of a hand. These are the only rules
that remove a card from a hand. The rebuilt `B` states the interim's genesis, so a list the arithmetic
got wrong halts the seat at mseq 1. The interim dedupes a seat's taps from every lseq it has seen
committed, not only the ones it committed itself. It must also record its own draws and mulligans, which
it commits without hearing its own `C`: otherwise it re-draws a copy it already drew, and once the arena
returns it refuses that copy forever (`COPY_DRAWN`) and the match stalls. The interim itself rebooting is still out of scope:
no match survives a power cycle of the arbiter (§4.5 above).
*Deviation from the ruling's wording*, which put lseq in each handed-back record: a per-record lseq would
cost the follower 256 × 2 = 512 B, making it 8,584 + 512 = 9,096 B, over its 8,704 B budget. The per-seat
maximum costs 4 B (8,588 B measured on thumbv7em and xtensa) and is all the dedupe reads. A full `H`
chunk is 2 + 1 + 1 + 1 + 4 + 6 × 32 = 201 B of the 221 B payload. (Arena spec §6.3, §7.)

### 4.6 Spectator join and snapshots — JOIN, SNAP, SNAP-NAK
`J role have_mseq` asks the arbiter for state. The arbiter encodes canonical state at its head
(`at_mseq`) and sends `S` chunks of ≤200 B: `at_mseq` 2 · `idx` 1 · `count` 1 · `total_len` 2.
Each chunk also carries `last_lseq` 2 × 2 B, each seat's highest committed lseq, so a joiner learns where its
counter resumes (ruled 2026-09-23; a chunk is then ≤ 10 + 200 = 210 B of the 221 B payload). This is spec'd,
and built with the spectator feature; a rebooted *seat* rejoins by a full replay instead (§4.5).
The receiver answers `Q at_mseq bitmap` — OTAN's shape, one bit per chunk, set = missing,
all-zero = done — and the arbiter resends only set bits. Commits with `mseq > at_mseq` that
arrived during transfer are held and applied after. Budget: a 3-lane × 4-cell × 2-side board with
life, mana, turn, deck and grave counts is ~300 B → two chunks; the 64-bit bitmap allows 12.8 KB.

### 4.7 Hash after every event
`h_n` rides every `C` and every `A`, so the arbiter learns of a divergence one RTT after it
happens and the follower learns of it on receipt. There is no separate hash frame.

### 4.8 End of match — RESULT
On lethal, concede, sudden death or timeout the arbiter emits `R`: `final_mseq` 2 · `winner` 1 ·
`reason` 1 · `chain_hash` 8 · `transcript_sha` 32 (SHA-256 over the header + all records) ·
`sig_kind` 1 · `sig` (32 or 64). The follower seat emits its own `R` over the same fields. Two
matching signed results from two shrines are the proof; one is a claim.

## 5. Divergence: halt and show, never negotiate
A follower whose `h_n` ≠ the arbiter's sends `X at_mseq reason my_hash their_hash` (broadcast, so
spectators see it too) and stops applying. The arbiter stops committing. Both screens show
"Desync at event *n*" with the last agreed board (`n−1`) and the two hashes. The match is void:
`R reason = desync`, the transcript is posted with both hashes, and the bug is fixed in the engine.
Replaying the transcript on the bench reproduces the split — that is decision 0004's point. Nothing
on the mesh may pick a winner.

## 6. The transcript

**Bytes.** Header 36 B — `magic` `"TSX1"` · `match` 4 · `ruleset` 4 · `registry` 4 · `rules` 4 ·
`seat0_node` 1 · `seat1_node` 1 · `seat0_deck` 4 · `seat1_deck` 4 · `start_ts` 4 · `pad` 2 (these sum to 36: the
earlier "32 B" label was an arithmetic slip) — then
`mseq`-ordered 32 B records (the 24 B event record + `h_n` 8). Sixty events ≈ 2 KB; a hundred
≈ 3.3 KB. Verification is a fresh engine run.

**JSON rendering** (what HA and the bench see): the shape of `tapstone-sim`'s `Transcript`, which the
goldens (`rust/tapstone-sim/golden/seed-*.json`) and the arena's `MatchOver.json` use. An earlier example here
carried `lseq`, `g` and `intent` fields; the record layout of 2026-09-20 superseded them.
`card` is resolved from `uid` through the registry at render time; the wire never carries names.

**Posting to HA.** After `R`, the seat with `flags.bit2` (WiFi) — the arbiter if both — does
what the scry station already does for a tap: a smoltcp HTTP `POST /tapstone/match/<id>?k=<tok>`
to scry-glass (VLAN6, capability token as today), body = the binary transcript, and scry-glass
publishes `tapstone/match/<id>` retained on Mosquitto plus the JSON rendering, so HA discovery
creates the match sensors. The burst happens *after* the match, when deafness is free. Rooms where
only the crown has WiFi use the mesh uplink later (§8 item 7); `RELAY_MAX_MSG = 256 B` cannot carry
a transcript today.

## 7. Security

**What the group-MAC gives.** Every `MATCH` frame carries the #190 trailer, so an outsider on the
channel cannot inject a tap or a commit once the fleet is in enforce mode — today it is *observe*,
so this is measured, not enforced (§8 item 2 asks for the ELECT treatment: a sealed send path).

**NTAG215 today (decision 0003).** The UID is cloneable, so the defence is the registry, not the
tag: a UID must be in the shared UID map (`registry` hash matched at pairing), bound to exactly one
card and one deck; the engine rejects a UID already on the battlefield, a UID not in the tapping
seat's declared deck, and a card that is not legal now. The transcript is the audit: HA can flag a
UID that appears in two matches in one room at one time. Frame replay is dead by `(seat, lseq)` and `mseq`; card replay is a rules question, and the rules say no.

**NTAG 424 DNA hook.** `auth = 1` means the arbiter read the tag's SUN NDEF (UID ‖ read counter ‖
AES-CMAC), verified the CMAC with the per-card key derived from a master it holds, and checked the
counter is strictly greater than the last one seen for that UID (registry-side state). The `T`
frame's variable tail carries `ctr` 3 + `cmac` 8 (+11 B, the 36 B upper bound in §2) so the
follower can re-verify if it also holds the master. The record format does not change; the byte is reserved now so the first commercial print needs no wire bump.

**Result signatures.** `sig_kind = 1`: HMAC-SHA256 with the fleet group key over
`transcript_sha ‖ match ‖ winner ‖ reason` — proves "a fleet shrine said so", not which one.
`sig_kind = 2`: Ed25519 with a per-shrine key, once provisioning exists; the verifier for Ed25519
is already on-device (signed OTA manifests), only signing and key storage are new.

## 8. What Tapstone needs from smol (issues to open)
Ready-to-paste issue bodies with acceptance tests: [`smol-issues.md`](smol-issues.md).
1. **Register `SMOLv1 MATCH `** in `wire.rs` + `protocol.md`, byte 7 = `'M'`, and a
   `Frame::Match { ver, kind, match_id, src, body }` arm in `classify()` that hands the body to an
   app hook (`on_app_frame`) rather than to `mode.rs` — the engine lives in the Tapstone app.
2. **Enforce the group-MAC on MATCH** the way ELECT is enforced: a `SealedMatch` type whose only
   exit is `send_to`, covered by `tools/check_elect_send_path.py` or its sibling. A forged commit is
   a forged match result.
3. **An app slot**: `AppKind::Tapstone` in the s3-cyd GUI flavor (the scry station's registry,
   smol#540) and in the fleet flavor for c3-oled lane counters, selectable via CFG `S` as
   `Tapstone:0`.
4. **CFG key `M` (house rules)**: cached + re-armed, value
   `deck:hand:bonus:life:from:pressure:stop:fall:return:v` — the order of `HouseRules::bytes()`,
   whose nine bytes genesis hashes (0029 added `fall` and `return`)
   ≤ 64 B, applied live in the lobby only; its hash is the `rules` field in LOBBY.
5. **App-level unicast by node id + per-frame RSSI to the app**: the roster has both; the app needs
   `send_to_id(id, frame)` and the RSSI of the frame it just received, for pairing order.
6. **Sub-second mesh clock (optional)**: `TIME` is seconds; a `ms` field (37 → 41 B, length-tolerant
   parse) would let transcripts pace replays without local-clock guesswork. Not on the critical
   path — ordering never uses it.
7. **A bulk uplink for non-crown boards**: either the s3-cyd HTTP client from spike-scry lifted into
   a shared `net::http` (it exists as a 63-line stub) or a chunked `UP2` payload above 256 B, so a
   transcript reaches HA from a room where only the crown has WiFi.
8. **MFRC522 presence duration** surfaced from the scry reader loop (tap vs hold ≥ 600 ms) and the
   FT6336U touch event routed to the app — they feed the tap/hold distinction and the touch
   confirmation (lane and target picks) that happen before a record exists.
9. **Card-set pinning**: expose the running image's SHA-256 (the OTA manifest already carries it) to
   the app as the `ruleset` id.
