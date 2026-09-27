# Open questions — a decision matrix for the brainstorm
Date: 2026-09-20 · Status: proposals for JP to pick from; nothing here is decided.

Each question lists the options considered, what each buys and costs on a two-shrine table, and a
recommendation with its reason. The brainstorming pass turns picks into `docs/decisions/`.

## Q1 — Mana

| Option | How it plays | For | Against |
|---|---|---|---|
| **A. Fixed ramp** (1 mana turn 1, 2 on turn 2 … cap 6) | Hearthstone-style, no resource cards | zero dead cards, decks are all action, shrine tracks it for free | removes a whole axis of deck design; games feel same-shaped |
| **B. Resource cards** (land-like, tapped to the pad) | Magic-style | rich deckbuilding, the physical tap of a land is satisfying | mana screw on a 25-card deck is brutal; more cards to print |
| **C. Charge the shrine** (tap any card face-down to "sacrifice" it as mana, once per turn) | Duel Masters / Hearthstone hybrid | every card is a resource, real decisions, no dead draws | needs a way to mark a card as spent (flip it) and for the shrine to know a face-down tap (same UID — so the shrine asks "cast or charge?" via touch) |
| **D. Time as mana** (mana accrues in real time, both players act freely) | real-time tactics | novel, exciting on two screens | destroys the deliberate tap rhythm; hard to referee physically |

**Recommendation: A for the first playtest, C as the v1 candidate.** A gets a game on the table in
a week with no new card types. C is the interesting design and fits the shrine (a tap is a tap; the
touch prompt disambiguates), but it needs the "spent card" physical convention settled first (Q2).

## Q2 — How a card leaves the battlefield physically

| Option | For | Against |
|---|---|---|
| **A. Move it to a "grave" zone on the mat**; the shrine doesn't care | simplest; the screen is truth | mat clutter; nothing enforces it |
| **B. Re-tap to acknowledge death** | the shrine confirms the physical world matches | extra taps slow the game; a forgotten tap desyncs the table |
| **C. Pressure pads under lane cells** (c3 headless + IO registry) | physical placement *is* the state | hardware in the mat; v2 |
| **D. Don't place cards at all** — cards are tapped and set aside; the screen is the board | fastest, cleanest, zero desync | loses the "my card is on the table" feel; the mat is just a pad |

**Recommendation: D for playtest one, A as the default once the mat exists, C as the flagship
later.** Decide whether the table is a *board* or a *pad* early; it changes the mat design.

## Q3 — Solo mode

| Option | Note |
|---|---|
| **A. None in v1** | two shrines or nothing; keeps the engine honest |
| **B. The shrine plays the other seat** with a scripted AI over the same tap-event protocol | the AI emits taps; the engine can't tell. Great for testing the protocol, and the Bard could narrate it |
| **C. Puzzle mode** (fixed boards, find the winning taps) | cheap content, teaches rules |

**Recommendation: B, but as the *test harness first*, a player feature second.** A seat that emits
taps is exactly what protocol tests need anyway.

## Q4 — What the shrine shows when no game is running
The scry station's idle faces exist. Proposal: the castle face with the Familiar if it lives here,
the deck's sigil name, and a "tap a card" invitation. Between games in a session: last result.

## Q5 — Deck size, hand size, match length
Proposal: 25-card decks, 5-card opening hand, draw one per turn, sudden death from turn 8 (each
turn both castles lose 2), hard stop at turn 12. Target: 6–9 minutes. Tune in playtest; every knob
is a keyed-CFG house rule so tuning is a dashboard change, not a reflash.

## Q6 — Lanes and cells
Proposal: 3 lanes × 3 cells per side (front/mid/back), units advance one cell per turn unless
blocked; attack when adjacent or ranged. Cards and Castles used free movement on a larger grid; the
small screen argues for lanes (research lane will report on legibility).

## Q7 — Factions for the first set
Two factions, 30 cards each, mirrored roles (a fast faction, a heavy faction), plus 10 neutral
cards. Sixty designs is a printable first run and enough for two-faction decks per player.

## Q8 — Art
Options: cardpress paint scenes cut to sprites (pipeline exists), commissioned pixel art (best on
320×240), or AI-generated with a fixed style bible. Recommendation: pixel art for sprites, painted
scenes for card faces; the card's art and its sprite need not be the same image.

## Q9 — Lane geometry on the 320×240 panel (from `shrine-ux.md`)
3 vertical columns matching the mat (enemy up, mine down, mirrored per shrine) with 3 cells per
lane at 48 px sprites, **or** 4 cells per lane at 36–40 px sprites with 1 px margins (or rotate the
board 90° from the mat). **Recommendation: 3 vertical, 48 px.** This also fixes rules v0's "3×3".

## Q10 — Touch: on with fallbacks, or off at the first table test
Touch ON with card-only fallbacks everywhere (targeting = 5 s countdown to the rules' default, pass
= tap the castle card), or touch OFF at playtest one to see whether anyone reaches for the glass.
**Recommendation: touch on, fallbacks mandatory; acceptance test = every screen completable without
touch.**

## Q11 — Rendering home in smol
Battlefield as a smol `kind: Framebuffer` app (embedded-graphics, sprites as runtime data in a flash
partition) vs a Slint scene. Measured: Slint page flip 74–79 ms (~13 fps) on this panel; the
framebuffer path already runs the six games at 30 fps and needs no scene recompile when the card
set grows. **Recommendation: framebuffer app.** This decides where the firmware work lands.

## Q12 — Who orders the taps — **answered by decision 0006**: the arena when present, else the offering shrine; elected, with handover
The draft makes the **arbiter = seat 0 = the lower node id**, assigning the match sequence number;
not the mesh crown (its WiFi burst deafens it ~15 s on a single radio) and not timestamps (the TIME
frame is seconds-only). Cost: a follower's tap costs one round trip before it animates. Alternative:
the arbiter is the **offering shrine** (whoever touches first) — same frames, one line of spec.
**Recommendation: offering shrine.** It makes the first tap of the evening decide, which is a nicer
ritual than a node id, and it costs nothing.

## Q13 — One chained hash, or separate state and record hashes
Draft: `h_n = SHA256(h_{n-1} ‖ record ‖ canonical_state)[..8]`, so the last hash commits to the
whole transcript. Cost: a desync can't be diagnosed as "state differed" vs "record differed" without
the transcript, which is posted anyway. **Recommendation: keep the single chain for v1.**

## Q14 — How a match transcript leaves the table
Draft: the shrine's own HTTP POST to scry-glass (as the scry spike reports a tap today), not the
mesh uplink (relay messages cap at 256 B; a transcript is 2–3 KB). Rooms where only the crown has
WiFi are deferred to a smol issue. **Recommendation: accept; the table has WiFi at home.**

## Q15 — Evolving cards (the Malkyrs idea, done phonelessly)
Malkyrs (2019) let physical cards level up through play, but the state lived on its server, so the
cards died with the studio. Tapstone can keep the state **on the tag**: the scry inscribe rite
already writes NDEF while the card sits on the pad, and NTAG 424 DNA has 416 bytes of user memory
with key-authenticated writes.

| Option | For | Against |
|---|---|---|
| **A. No evolution**; cards are fixed designs | simplest; the registry stays the whole truth | loses the coolest thing Malkyrs had |
| **B. On-tag experience**: the shrine writes XP/level to the card after a match, signed with the shrine's AES key (424 DNA), so a forged level fails verification | a card *remembers its battles*; works on a table with no network; a veteran card is a real object with history | rules must define what levels do (small stat bumps, a title, an unlock — never raw power creep); write-back needs the card on the pad at match end; NTAG215 playtest stock can't sign, so v0 skips it |
| **C. On-tag history only** (last N matches, wins, the shrine sigils it fought on), no rules effect | all the flavour, zero balance risk; a card page on tapstone.realm.watch shows its saga | no gameplay hook |

**Recommendation: C for v1, B as the v2 headline.** History is free once 424 DNA is in; levels need
a balance pass. Either way the state is on the card and verified by the shrine, never in a server,
which is precisely the lesson from Malkyrs and DropMix.

**Tension to resolve in the brainstorm:** `research/nfc-card-games.md` says "never store game state
on the card" because Skylanders and Infinity wrote XP to figures and paid for it (cloned figures,
rolled-back saves, support load). The answer here is narrower than "never": rules-affecting state
only if it is signed by a shrine key on a 424 DNA tag and bounded (a level cap, no raw stats), and
flavour history is harmless. If that discipline feels fragile, pick A or C and keep levels off the
card for good.

## Q16 — One pad, or a reader per lane (the DropMix idea)
DropMix (Harmonix/Hasbro, 2017–2022) had an NFC reader under each of five slots: the slot you dropped
a card into *was* the command. It died because the board was deaf without the phone app. A shrine
with **three pads, one per lane**, makes lane choice physical and removes the touch-targeting prompt
for the most common action.

| Option | For | Against |
|---|---|---|
| **A. One pad on the apron** (the current decision 0005) | one MFRC522, the scry wiring as-is, smallest case | every summon needs a lane choice on the glass or a default |
| **B. Three pads in a row, one per lane** | tap *into* the lane; the physical layout mirrors the screen; no targeting for summons; two players' pads face each other across the mat and the screens sit behind | three MFRC522 modules per shrine on one SPI bus with separate CS lines, and adjacent 13.56 MHz coils couple — spacing or time-multiplexed polling (read one at a time, ~30 ms each) is required; the apron becomes a bar as wide as three cards |
| **C. One pad plus a physical lane selector** (three buttons or a slider) | one reader, still no glass | an extra control to explain |

**Recommendation: A for playtest one (the hardware exists), B as the shrine two-point-oh
experiment**, because "drop the card in the lane" is the kind of physical grammar that made DropMix
feel like magic, and the mesh protocol doesn't care which pad produced the tap event (`lane` is
already a field in the event record).

## Q17 — The castle as a figurine (the amiibo idea)
amiibo survived every other NFC toy line because the reader is in the console, the figure works
across games, and the figure itself stores a little state (NTAG215, writable). Two things to take:

1. **The castle needn't be a card.** A small figurine on a base with the tag in the base — printed,
   or turned in wood with a brass ring and a crystal on top — is the seat token: set it on the pad to
   claim your seat and pick your faction. It is the object people will photograph, and it sits on the
   table for the whole match as your side's marker. Cards stay cards.
2. **The figure can carry the player.** Name, sigil, win count, favourite deck: the figurine is the
   save file (Q15's on-tag state), so a player brings *themselves* to a friend's shrines.

| Option | For | Against |
|---|---|---|
| **A. Castle card** | cheap, prints with the set | one more card that looks like every other card |
| **B. Castle figurine with tag in the base** | the collectible, the seat token, the save file; brass/wood/crystal craft | a second production path (print or turn), tag-in-base needs a flat pad area |

**Recommendation: B**, starting with a printed base and a resin or wood top; the first two are the
pitch photo together with shrine two-point-oh.

## Q18 — Topology: two shrines, or two shrines plus a central arena screen (JP, 2026-09-20)
JP's proposal: when the other player taps a card on their shrine, **you see that card on yours**, and
a **central screen animates the battlefield** for both players (and anyone watching).

| Option | What each screen does | For | Against |
|---|---|---|---|
| **A. Two shrines only** (the brief so far) | each shrine draws the whole battlefield mirrored | no third device | two 2.8" boards each squeeze a full board; players look down at their own screen, not at each other |
| **B. Two shrines + a central arena** | shrine: your mana, life, hand count, *the card the opponent just tapped* (image + text), your whispers/prompts, targeting; arena: the battlefield, animations, life totals, timer, result | the battlefield gets a canvas big enough to watch together; the shrine becomes a personal panel and the private-information problem (what may the opponent see?) resolves itself; spectators watch the arena; the arena node is the natural **neutral arbiter** (Q12) since it belongs to neither seat | a third node to own and power; the arena needs a bigger display than a CYD to be watched from two seats |
| **C. Pads + arena** | the "shrine" shrinks to a reader pad with an LED ring and a tiny OLED (c3-oled, ~$3 + reader); everything visual is on the arena | cheapest per player by far, decks could ship with a pad; the arena carries all the rendering budget | no private screen at all; targeting needs buttons or the arena's touch; loses the shrine-as-object feel unless the pad is the crafted piece |

**What the arena can be**
1. A third s3-cyd in a stand — same firmware family, mesh-native, but 2.8" is small for a shared board.
2. A **smol gateway node driving a web page** on any screen (a tablet propped between the players, a
   TV, a laptop): the mesh node relays match state over MQTT/WebSocket and a browser renders the
   battlefield with real animation headroom. This reuses Grimoire's companion stack (FastAPI + SSE
   + vanilla JS) almost verbatim, and it makes the arena as big as whatever screen is on the table.
3. A **WLED matrix via smol Cast** for the room: pixels, not a UI; a spectator wall, not the arena.

**Recommendation: B, with the arena as a mesh node plus a browser canvas (option 2), and the arena
as arbiter.** The shrines keep the ritual (tap the stone, see the opponent's card appear on yours,
feel the LED), the battlefield gets room to be beautiful, and the protocol already has the pieces:
spectator JOIN + SNAP becomes the arena's join, and "arbiter = the arena" is one line in Q12.
Playtest one can still run as A (two shrines, mirrored) because the arena is additive — the same
tap events, one more subscriber.

**Consequences if chosen**
- The shrine UX study's battlefield screen becomes the *arena* screen; the shrine screen shrinks to
  a personal panel (life, mana, hand count, opponent's last card, prompts). Sprites move to the
  browser, which relaxes the 15 fps / 48 px budget considerably.
- Rules v0 unchanged; protocol gains a `role` (seat / arena / spectator) on JOIN.
- Card reveal rule: the arena shows every tap; a shrine shows the opponent's *tapped* cards only, never
  their hand. Nothing hidden ever crosses the mesh, so nothing hidden can leak.

## Q19 — Multiplayer that mirrors the mesh: join and leave at will (JP, 2026-09-20)
smol's mesh is a fleet where boards appear, elect, sync and vanish without ceremony; the World Snake
already runs a shared world that peers enter and leave. JP wants the *game* to feel the same: a
shrine that joins the mesh joins the table; one that leaves, leaves — no lobby gate, no fixed player
count, no "waiting for player 2".

### What has to change for that to be true
| Fixed 1v1 assumption | Mesh-shaped replacement |
|---|---|
| Two seats, mirrored | **A ring of castles** around the arena; each shrine that joins claims a castle slot (as many as the mode allows), lanes run between *adjacent* castles |
| Alternating turns | **Simultaneous rounds on a shared clock** (mesh time-sync): everyone acts during the round, the arena resolves at the bell. Turn order can't survive players arriving mid-game; rounds can |
| Match starts and ends | **A session that persists on the arena**; players enter with their castle and leave when they like; a castle whose shrine goes dark is *dormant* after N rounds (units hold, no actions) and *withdrawn* after M (units fade, slot frees) |
| Win = other castle at 0 | **Objectives per mode** (below); a player who leaves early keeps their record, nobody is held hostage |
| Sudden death at turn 8 | **Pressure that scales with players**: the arena tightens the ring or raises attrition every K rounds so sessions still end |

### Modes (one rule set, different objectives)
- **Duel** — two castles, lanes between them, the current rules v0 with rounds instead of turns. Playtest one.
- **Skirmish** — 3–6 castles on the ring, free-for-all; lanes link neighbours; last castle standing, or most damage dealt when the pressure ends it. Join mid-session and you spawn with reduced life to keep it fair.
- **Siege** — everyone versus the arena's own castle (the shrine plays a seat; Q3-B); co-op, drop-in.
- **The Realm** — persistent: the arena keeps a map across sessions (the World Snake pattern); castles hold territory between evenings; shrines that come by contribute. The mode that makes the mesh the point.

### Consequences
- **Protocol**: JOIN already exists (spectator snapshot); it gains `role=seat` with a castle-slot claim, a LEAVE/withdraw frame, and dormancy driven by the RSSI roster (Marauder's Watch) — a shrine that stops answering is dormant, not disconnected. The arena arbiter (Q18) resolves rounds; simultaneous taps within a round are ordered by arrival at the arbiter, which is fine because rounds resolve together.
- **Rules**: v0's turn structure becomes round structure; everything else holds. The arena's ring layout replaces "three lanes, mirrored" — for two players the ring degenerates to exactly that.
- **Shrine screen**: unchanged (personal panel); the arena shows the ring.
- **Card design**: no card may depend on a fixed opponent count ("each opponent" scales, "your opponent" doesn't).
- **Not compromised**: determinism — one arbiter, one ordered event list, one hash chain; joiners get SNAP, leavers are events.

**Recommendation: adopt as a principle now, ship Duel first.** Writing the rules as rounds-on-a-ring
from the start costs little and means Skirmish and the Realm are configuration, not a rewrite. The
brief's "not in scope: more than two players" becomes "in scope by design; Duel is the first mode".

## Q20 — The arena as a RealmOS box with LTSP screen modules over wired Ethernet (JP, 2026-09-20)
JP's shape: the central screen runs **RealmOS** (`os.realm.watch`, the realm's Linux desktop layer),
and **additional screen modules** are LTSP thin clients netbooted over wired Ethernet — any old
laptop, Pi or thin client becomes another view of the arena with zero per-device setup.

### Two networks, one table
- **Shrines ↔ arena**: the smol ESP-NOW mesh. The arena gets a **smol gateway node** (a c3 on USB
  serial to the box, or the crown's WiFi/MQTT burst) that forwards MATCH frames both ways. Serial is
  the low-latency path (< 5 ms); MQTT via the gateway is the fallback and is what HA already speaks.
- **Arena ↔ screens**: wired Ethernet. The RealmOS box serves the arena page; LTSP boots each screen
  module into a kiosk browser pointed at `/arena?view=<name>`. Views: the battlefield, a castle
  close-up per seat, the ring/leaderboard for Skirmish and the Realm, a lore/Bard panel, a spectator
  feed. Wired means deterministic frame timing and no WiFi contention with the mesh.
- LTSP (the 2019+ rewrite) netboots from a single server image over PXE; katana already has
  netboot.xyz history in the palace, so the plumbing is familiar.

### The fork this opens: where does the rules engine run?
| Option | Shape | For | Against |
|---|---|---|---|
| **A. Engine on the shrines** (decision 0004 as written); arena only renders | firmware is the truth | works with no arena (Duel anywhere) | join/leave, rings and rounds are much harder to keep deterministic across N tiny nodes; the arena is a mirror, not an arbiter |
| **B. Engine on the arena**; shrines are terminals (tap in, panel out) | Linux, Python or Rust, unlimited room; realmwatch's `realm-engine` plugin (events, entities, players in SQLite) is a ready persistence layer for the Realm mode | simplest to build and to change; one authority | no game without an arena box on the table; two shrines alone go back to being scry stations |
| **C. One `tapstone-rules` Rust crate, two hosts** | `no_std` core compiled into the shrine firmware *and* natively into the arena service; the arena is authoritative when present, the shrines run the same crate for Duel without one | one rules implementation, no divergence by construction; Duel works with two shrines, everything bigger needs the arena | the crate must be written `no_std` from day one; the arena service is Rust or a thin FFI |

**Recommendation: C.** It keeps 0004's promise (the rules are in the shrine) and JP's new shape (the
arena runs the table). Amend 0004 to: *the rules are one crate; whichever node is arbiter runs it.*
The Python side (realmwatch plugins, HA, the web arena) consumes the arbiter's event stream and
never re-implements rules.

### What RealmOS gives for free
- The realm's look and glue: theme watcher, GNOME session, realm-sigil naming, status.realm.watch
  registration for `tapstone.realm.watch`.
- realmwatch's game-server plugins — `realm-engine` (events/entities/players), `progression`,
  `quests`, `combat-ward` — as the persistence and meta-progression layer: player records, castle
  history, the Realm mode's territory between evenings, quests that reward cards.
- HA is already on the bus: table lamps dim at sudden death, the room's WLED wall mirrors the ring.

### Consequences for what exists
- Q18's "arena as a mesh node plus browser canvas" becomes "arena as a RealmOS box with a gateway
  node and N browser screens". Same events.
- Playtest one is unchanged (two shrines, Duel, no arena). Playtest two adds the box and one screen.
- Protocol: MATCH frames unchanged; add the gateway's serial framing and a `view` registry for
  screens (which screen shows what) — arena-side, not on the mesh.
