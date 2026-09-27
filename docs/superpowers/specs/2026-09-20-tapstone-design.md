# Tapstone — design spec

**Status:** approved by JP 2026-09-20 (brainstorm of the 2026-09-19 brief; twenty decision records
in `docs/decisions/`, research in `docs/research/`, protocol draft in `docs/protocol/`, screens in
`docs/design/shrine-ux.md`). Working title; trademark search owed (0001).

**Amended 2026-09-23 (0028–0033, JP's rulings):** the arena is the board and is required for a
match. The shrine screen is the player's station: the commander paperdoll, RPG stats and inventory,
the voice (spoken and shown), and small animations. Commanders fight on the board, level up for
breadth and looks, not power (0034), and wear loot and item cards, and the arena keeps the ledger. The new shrine unit
adds a speaker, a mic and an SD card. The sections below are edited in place, and the decision
records carry the reasons.

## 1. One sentence
A collectible card game whose NFC cards are tapped on a **shrine** — a smol-powered stone with a
screen and a pad — and whose battles play out on a central **arena** while each shrine shows its player's **commander**; every shrine is a peer on one radio mesh, players join and leave as their shrines
do, and nothing depends on a server off the table: the arena is on the table (0028).

## 2. The objects
- **Shrine** (0005, 0010, 0018): ES3C28P (ESP32-S3, 320×240, capacitive touch) in the ember stand
  grown into a wooden **apron** with an MFRC522 coil under an RF-transparent pad; brass and copper
  as edges beside the pad, crystals as LED lenses, a crystal eye at the top. One pad now; a three-pad
  (reader per lane) shrine is the two-point-oh experiment. Renders as a smol Framebuffer app.
- **Cards** (0003, 0014, 0017): CR80 PVC, painted faces on the realm-cards template, **NTAG 424 DNA**
  from the first real print (NTAG215 blanks for playtest one only). The tag carries a signed battle
  history; nothing that changes play lives on the card until a v2 balance pass, if ever.
- **Castle figurine** (0019): tag in the base, wood or resin top, brass ring, crystal. Set on the pad
  to claim seat and faction; lifted to leave. Its identity keys the player's commander in the
  arena ledger (0030).
- **Commander** (0029–0031, 0034): one per seat, a unit on the board at base 2/4. Levels 1–10 and
  gear from earned loot and physical **item cards** (weapon, armour, trinket) buy options and looks,
  never stats (0034). Gear is locked at genesis.
- **Arena** (Q18, Q20, 0006): a RealmOS box (`os.realm.watch`) with a smol gateway node on serial and
  LTSP thin-client **screen modules** over wired Ethernet, each a kiosk view (`/arena?view=…`):
  battlefield, castle close-ups, ring and leaderboard, lore, spectator. **Required for a match**
  (0028), because the battlefield is drawn only here. For playtest one, a laptop running the arena
  service with a gateway node on USB counts as the arena. It holds the commander ledger (0030) and
  the voice's STT and TTS (0033).

## 3. The system (0004 amended, 0006, 0016)
- **Transport:** the smol SMOLv1 ESP-NOW mesh, always. New `MATCH` frame family (protocol draft):
  lobby/pair, tap event (24-byte record: UID, seat, lane, intent, sequence, mesh time), state hash,
  ack/NAK replay, join + snapshot, pause/resume, result, arbiter claim/handover.
- **Authority:** one elected **arbiter** orders taps, resolves rounds and signs the chain. That is the
  arena, which is present at every match (0028). A shrine arbitrates only to recover when the arena
  drops. Departure triggers re-election and resume
  from the last agreed hash and snapshot. Leaderless consensus is ruled out.
- **Rules:** one `no_std` Rust crate, `tapstone-rules`, compiled into the shrine firmware and natively
  into the arena service; whichever node is arbiter runs it. Python (realmwatch plugins, HA, the web
  arena) consumes the event stream and never re-implements rules.
- **Integrity:** `h_n = SHA256(h_{n-1} ‖ record ‖ canonical_state)[..8]`; divergence halts and shows.
  The transcript (records + JSON) is posted by the arbiter over HTTP to scry-glass and, through
  realmwatch's `realm-engine` plugin, becomes player records, castle history and the Realm's map.
- **Identity:** design records (`game/cards/<set>/<id>.toml`), a copy registry keyed by tag UID bound
  with scry's imbue rite, decks as lists of designs with realm-sigil names (card-data-format.md).
  424 DNA SUN verification runs offline on the shrine; playtest stock is registry-trusted only.

## 4. The game (0007–0009, 0011–0013, 0015; rules v0 updated)
- **Board:** three lanes, three cells a side (back, mid, front), castles of 20 behind, drawn on the arena (0028):
  a battlefield view for Duel, and lanes between adjacent castles on the ring for Skirmish.
- **Decks:** 25 cards, one or two factions; opening hand 5 (6 for the second player, 0035); draw one a
  round. Set one: **Ember** (fast, burn, haste) and **Tide** (control, ranged, tricks) plus 10
  neutrals, 70 designs.
- **Mana — charge the shrine:** once a round, tap one card face-down to make one permanent mana.
  Mana equals cards charged; nothing carries over unspent. Same UID for cast and charge, so a tap
  prompts cast-or-charge.
- **A round:** draw; charge (optional); cast units into a lane's back cell and spells at targets;
  advance a lane (units move one cell forward if free); combat at the bell — front units fight the
  unit facing them or the castle, ranged units hit the nearest enemy in the lane, damage
  simultaneous; pass. Duel plays alternating turns for playtest one; the ring-and-rounds structure
  (simultaneous rounds on the shared clock) is the general form.
- **Ending:** pressure from round 8 (every castle −2 at round start), hard stop at 12 (higher castle
  wins; ties to more units, then second player). Six to nine minutes. Every engine number is a
  keyed-CFG house rule applied in the lobby. Commander base stats and progression are arena-side
  (0029, 0030).
- **Cards:** units (cost, attack, toughness, ≤1 keyword from Ranged, Shield 1, Haste, Rush, Taunt),
  spells (a closed effects table: damage, heal, destroy-by-toughness, shift lane, draw two),
  castles. No card depends on a fixed opponent count.
- **Commander** (0029, 0034): starts in the middle lane's back cell at 2/4, plus at most one
  keyword (Haste or Taunt) from gear. When it dies its castle loses 3, and it returns two rounds later. Genesis hashes its final
  stats, never the inventory.
- **Physical convention:** the arena's screen is the board (0028); tapped cards go to piles beside the shrine,
  face-up cast, face-down charged. No mat required.
- **Modes (Q19):** Duel (two castles); Skirmish (3–6 castles on the ring, join mid-session with
  reduced life, pressure scales with players); Siege (all versus the arena's scripted castle);
  the Realm (persistent territory across evenings on the arena).
- **Solo and testing:** a scripted seat emits taps over the same protocol — the test harness first,
  then practice and Siege's castle.

## 5. Screens, voice and touch (0009, 0010, 0028, 0032, 0033)
The shrine's screens are the idle commander; the lobby and loadout (paperdoll, three slots,
inventory grid, XP); the in-match station (live paperdoll, commander health and lane locator, castle
life, mana, hand count, round); the result (XP, level-up, loot); and dark/waiting. One **voice
band** owns every prompt, refusal and whisper. It is also spoken, mostly as pre-rendered Piper clips
from the SD data pack, with the rare dynamic line streamed from the arena. The player can answer
with push-to-talk, matched against the current prompt's closed grammar. Voice answers wait on a
transport measurement and are a phase-2 stretch goal, not a playtest-one requirement (0033). Touch and voice answer
prompts, and every prompt can also be completed with cards alone (5 s default countdown, second
tap = charge, castle tap = pass). The game is playable with the glass covered and with the sound
off. Motion runs at ~15 fps with one contiguous dirty rectangle per frame: idle breath (three
poses), struck, fall, return, equip, level-up and loot. The paperdoll is 0014's 48 px hero drawn at
2× with per-slot gear overlays. The arena's browser canvas carries the battlefield and the rich
animation.

## 6. Security posture (0003, 0016, tag-security.md)
Playtest: UID registry, honest about being cloneable. Product: 424 DNA SUN verified on-device; the
registry maps copy → design. Frames carry the mesh group MAC; results are signed by the arbiter.
State on the card is history only, signed; play-affecting state stays off the tag.

## 7. Error handling
Refused tap → reason on screen, one red pulse of the eye (rule, unregistered card, not your round,
no mana). Lost frame → ack/NAK replay. Arbiter gone → re-elect, resume from snapshot; if no
snapshot agrees, the match halts and shows both hashes. Shrine silent → dormant after N rounds,
withdrawn after M (house-rule knobs). Arena offline → a shrine holds the arbiter role from the last
agreed hash and snapshot, both shrines show "the arena is dark — the match waits", and play resumes
when an arena rejoins as board and arbiter and catches up (0028).

## 8. Testing
- `tapstone-rules` crate: property tests over random tap sequences (determinism: same list, same
  hash on both hosts), rule tables from rules v0, golden transcripts.
- Protocol: two scripted seats plus an arbiter in a host-side simulation; lost-frame and handover
  cases; the harness seat (0015) drives every game.
- Firmware: the smol target's bench runbook; tap-to-screen latency measured (< 300 ms target).
- Table: playtest one per `docs/playtest/plan-1.md` (two shrines plus a laptop arena, Duel,
  alternating turns).

## 9. Phasing
1. **Rules crate + harness** (host only): rules v0 as `no_std` Rust, scripted seats, golden hashes.
2. **Shrine firmware and arena board** (0028). In smol: the Framebuffer app with the station
   screens, MATCH frames, tap/touch routing, the SD data pack and spoken output (voice answers are a stretch goal, 0033). In this
   repo: the commander in the rules crate, and the arena service with its battlefield canvas and its
   local ledger (0030). Second shrine assembled. Playtest one.
3. **Tag work**: SUN verification on the spike; first NTAG 424 DNA print; history writes.
4. **The crafted arena**: the RealmOS box, LTSP screens, Skirmish and Siege, and ledger snapshots
   on figurines. Playtest two.
5. **Craft**: wooden apron, brass, crystal eye, castle figurines; the pitch photo.
6. **The Realm**: persistent territory via realmwatch plugins; HA and WLED room effects; the Bard.

## 10. Not in scope
A phone app, online play, trading or a marketplace, leaderless consensus, play-affecting state on
cards (v1), a fixed annual set treadmill.
