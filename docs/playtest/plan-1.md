# Playtest 1 — two shrines, one table (DRAFT)

> **2026-09-23 (0028):** the arena is required, and a laptop counts as the arena. The battlefield is drawn there, and the shrines show the commander station (0032).
Date: 2026-09-20 · Goal: find out whether tapping cards to summon into lanes on two synced screens is
fun for ten minutes, before any art, audio or polish exists.

## What has to exist
| Piece | Source | Status |
|---|---|---|
| Two shrines | one scry station exists (smol node 162). JP has **spare new ES3C28P boards and a second MFRC522** on hand (2026-09-20), so shrine two is a wiring session per `rc522-s3cyd-wiring.md`, a printed case (MakerWorld 2524848) and a flash of the scry spike to a new node id | 1 built, 1 to assemble, nothing to buy |
| Rules v0 engine on the shrine | new: a smol app in the fleet or GUI flavor (`docs/design/rules-v0.md`) | to build |
| Tap-event protocol over SMOLv1 | new: `docs/protocol/` draft → implementation | to build |
| Laptop arena | arena service + a smol gateway node on USB serial + a browser battlefield (rectangles and numbers, no sprites) | to build |
| Commander station screen | 0032, rendered first in `shrine-preview` | to build |
| 2 × 25 test cards | blank CR80 NTAG215 from the label kit stock, printed with name/cost/stats only via the realm-cards template; bound with the imbue rite | to print |
| Copy registry with 50 UIDs | `registry/copies.jsonl` | to bind |

## Parallel firmware task (not blocking the test): SUN on the spike
Per decision 0003 (amended): add ISO-DEP framing and NTAG 424 DNA SUN verification to the scry
spike's reader path before the first real print, so the switch from NTAG215 playtest stock to
authenticated cards is a flag. Also measure MFRC522 read range through a card sleeve on the real
unit; the research file only has a community figure.

## Session script (60 minutes)
1. Pair the shrines, play three matches with the same two decks. Note every moment a player looks
   at the *other* shrine or asks "what happened".
2. Swap decks, play two more.
3. Then break it: tap a card twice, tap an unregistered card, unplug a shrine mid-turn, tap during
   the opponent's turn. Record what each shrine shows.

## Measures
- Match length (target 6–9 min) and turn count at end.
- Taps per turn and time from tap to both screens showing the result (target < 300 ms).
- Number of rule refusals and whether the reason on screen was understood without asking.
- The "who's winning" test: at a random moment, cover both screens and ask each player; both
  should answer correctly from memory of the last state.
- Fun, one question each per match: "would you play another?"

## Decisions this test should settle
Q1 mana (does fixed ramp feel too flat?), Q2 physical cards (do people want to place them?),
Q6 lanes (3×3 legible and interesting?), Q5 length (sudden death at 8 right?).

## Feasibility facts from the UX study (2026-09-20)
- **No LED ring exists**: the board has one WS2812 on GPIO42. A pad ring is a strip on a spare GPIO
  plus a case revision — hardware, and not needed for this test.
- **Scry's idle faces are server-rendered frames streamed over WiFi.** A no-server table needs faces
  cached in flash or drawn locally: new code, not reuse. Playtest one uses a locally drawn orb.
- **Mesh-OTA receive is unsupported by construction on GUI flavors** (smol #495). Card-set updates
  over the mesh are roadmap; playtest shrines are flashed over USB.
- **Motion budget**: ~29 ms per full frame at 40 MHz SPI, partial windows slower per pixel → design
  at 15 fps, one contiguous animated band at a time, hard cuts between screens. No idle sprite loops.
- **Reader and panel share one main loop** (SPI3 vs SPI2): a 15 fps flush must interleave the
  MFRC522 poll or taps mid-animation are missed. Measure tap-to-screen latency explicitly.
- Two-finger pass is unverified on smol's touch path; speaker not installed; no battery cell. All
  deferred, none blocking.

## Out of scope for this test
Art, audio, LED ring, spectators, watch, Familiar, solo mode, tag security beyond the UID registry.
