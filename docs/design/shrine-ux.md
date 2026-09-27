# Shrine UX — screens, motion, touch (DRAFT)

> **2026-09-23:** screens 4–7 (battlefield, targeting, combat, sudden death) moved to the arena (0028).
> The shrine's screens are now 0032's. The device table and motion budget here still apply, except
> that the new unit has the speaker fitted and an SD card (0033).

**Status:** draft, 2026-09-20, Luna. Not approved. Designs for the s3-cyd shrine exactly as it is
today (`~/Projects/smol/targets/s3-cyd/BOARD.md`, `DISPLAY-PACKAGE.md`, `PARITY.md`); every number
below cites where it came from. One decision is flagged **⚖ JP** for a ruling.

## The device, measured

| fact | value | source |
|---|---|---|
| Panel | ILI9341V 2.8" 320×240, driven landscape, RGB565, write-only SPI at 40 MHz | BOARD.md §Display, DISPLAY-PACKAGE §2 |
| Pixel pitch | 2.8" diagonal at 4:3 → 56.9 × 42.7 mm → **5.62 px/mm** (1 mm ≈ 5.6 px, 10 px ≈ 1.8 mm) | derived |
| Full-frame cost | rasterise ≈ 1.6 ms + wire ≈ 27 ms → **~29 ms per full 320×240 repaint**, ≈ 34 fps ceiling with nothing else running | DISPLAY-PACKAGE §4 (explore-ember measurement) |
| Partial-window cost | per-cell SPI windows are **2× slower** than a full-screen repaint — the penalty is **per window, not per pixel** (see below) | BOARD.md §Display, line 70 |
| Slint page flip, measured | 74–79 ms on the GUI flavor | PARITY.md row "Swipe navigation" |
| Framebuffer-game path | `kind: Framebuffer` apps draw via `embedded-graphics`, throttled 30 fps, half-res backing store on the C6; the S3 keeps two full RGB565 buffers in PSRAM | `c6-watch/src/drivers/framebuffer.rs`, `apps/flappy.rs`, `ui/cyd/PROPOSED-game-geometry.md` |
| Touch | FT6336U capacitive, I²C, taps + swipes + wake-on-tap verified on glass; 44 px minimum target rule | PARITY.md, `ui/cyd/shell.slint` house rules |
| LED | **one** WS2812 on GPIO42; GUI flavor has no driver (#491) | BOARD.md pin map, PARITY.md gap 5 |
| Audio | ES8311 + 3 W amp on board, I²S path electrically verified, **speaker not installed** (#477) | PARITY.md |
| Battery | ADC on GPIO9, no cell fitted on JP's unit | BOARD.md, PARITY.md gap 2 |
| Scry faces today | server-rendered raw frames streamed from scry-glass (`GET /screen-idle`: orb, starfield, two lines; IMBUED verdict face) | `spike-scry/src/scry.rs:221`, scry README |

Two of those rows reshape the design before a pixel is drawn: **Slint is not the animation layer**
(a 75 ms flip is 13 fps), and the shrine currently renders nothing locally — its faces come over
WiFi from a server the brief says will not be at the table.

## Layout decision — lanes match the mat

Two shrines face their owners across the mat; the physical cards sit between them in three lanes
running player→player. On a shrine facing its owner, "toward the enemy" is **up**. So lanes are
**three columns**, opponent's wall at the top, mine at the bottom, and each shrine mirrors the
shared state so "mine" is always the bottom row. A spectator shrine shows the arbiter's view
unmirrored with both names.

**⚖ JP #1 — lane depth is a screen decision as much as a rules decision.** The 192 px between the
two HUD bands holds two 12 px walls plus either **3 rows of 56 px** (48 px sprites, comfortable) or
**4 rows of 42 px** (36–40 px sprites, 1 px margins, stats must overlay the sprite). Horizontal lanes
(castles left/right) would give 4 cells of 56 px width — but rotate the board 90° from the mat.
Recommendation: **3 cells per lane, vertical**, 48 px sprites. Everything below assumes it.

## Screen inventory

Wireframes are 64×24 characters ≈ 5 px per column, 10 px per row.

### 1. Idle / castle face
The scry station's resting orb, cached in flash (one 153.6 KB RGB565 frame, or drawn locally from
the same recipe) so it needs no server. Faction crest of the last deck seen sits in the orb; two
lines say what this thing is. Breathing LED, 0.2 Hz.

```
┌──────────────────────────────────────────────────────────────┐
│ ·      ·           ·                  ·          ·           │
│            ·          ╭────────╮             ·               │
│    ·                 ╱  ✦ crest ╲        ·                   │
│                     │   of last  │                 ·         │
│        ·             ╲   deck   ╱                            │
│              ·        ╰────────╯      ·                      │
│                                                              │
│               D R A C O N I C   D O M I N I O N              │  26 px title
│            tap a card to summon · tap a deck to duel         │  14 px
│  ✎ mesh 3   ⚡ 73%                                  22:41    │  13 px status, corners
└──────────────────────────────────────────────────────────────┘
```

### 2. Pairing — finding the other shrine
Entered by tapping a **deck card** (the deck's banner card carries the list hash). The orb splits
into two; the far half brightens with RSSI (Marauder's Watch near/far). Only a shrine also in
pairing and *near* is offered. Confirm = the other player taps their deck card; both screens cut
to setup. Timeout 60 s back to idle.

```
┌──────────────────────────────────────────────────────────────┐
│                      SEEKING A RIVAL                         │  22 px
│                                                              │
│      ╭──────╮                              ╭ ─ ─ ─ ╮         │
│     │ ✦ me  │   ·  ·  ·  ·  ·  ·  ·  ·  · │ ? far  │        │  RSSI dots fill L→R
│      ╰──────╯                              ╰ ─ ─ ─ ╯         │
│                                                              │
│   Verdant Reach (1 m)  ▸ they must tap their deck to accept  │  14 px
│                                                              │
│  ruleset a91c ✓ same          [ cancel ]   (or lift the card)│  44 px button
└──────────────────────────────────────────────────────────────┘
```
The ruleset line shows both shrines' image/card-set hash agree (decision 0004); a mismatch is a
red line and no match.

### 3. Setup / mulligan
The shrine cannot see a hand, so the mulligan is physical. The screen shows the coin (hash of
both node ids and the synced time — no negotiation), who goes first, starting life and turn
limit from CFG, and a single prompt. Both players tap their **castle card** (or touch READY) to
start; the turn clock begins on the second tap.

```
┌──────────────────────────────────────────────────────────────┐
│  VERDANT REACH                     vs        DRACONIC DOMINION│  17 px
│  ✦ deck 7f3a · 24 cards                     ✦ deck b210 · 30 │  13 px
│                                                              │
│                     ◐  you go FIRST                          │  22 px
│         draw 5 · mulligan once · life 20 · sudden death T10  │  14 px
│                                                              │
│                   ┌─────────────────────────┐                │
│                   │ tap castle card = READY │  ◇ they: ready │  44 px
│                   └─────────────────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

### 4. Battlefield (the screen the match lives on)
```
┌──────────────────────────────────────────────────────────────┐
│ DRACONIC DOMINION      ♥ 14    ◆◆◆◇◇◇                T7 ⏱0:28│  y0–24 their HUD
├────────────────────┬────────────────────┬────────────────────┤
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  y24–36 their wall
│ ┌────────┐ ⚔3 ♥4   │                    │ ┌────────┐ ⚔2 ♥2   │  row A y36–92
│ │ sprite │ ▮▮▮▮░   │        · · ·       │ │ sprite │ ▮▮░░    │   48 px sprite,
│ └────────┘         │                    │ └────────┘ 💀 poison│   stats to its right
│ ┌────────┐ ⚔1 ♥1   │ ┌────────┐ ⚔5 ♥5   │                    │  row B y92–148
│ │ sprite │ ▮       │ │ sprite │ ▮▮▮▮▮   │        · · ·       │   (contested row)
│ └────────┘         │ └────────┘         │                    │
│ ┌────────┐ ⚔2 ♥3 ▲ │                    │ ┌────────┐ ⚔3 ♥2   │  row C y148–204
│ │ sprite │ ▮▮▮░    │        · · ·       │ │ sprite │ ▮▮░     │   ▲ = can attack
│ └────────┘         │                    │ └────────┘         │
│░░░░░░░░░░░░░░░░░░░░│░░░░░░░░░░░░░░░░░░░░│░░░░░░░░░░░░░░░░░░░░│  y204–216 my wall
├────────────────────┴────────────────────┴────────────────────┤
│ ♥ 20    ◆◆◆◆◇◇   YOUR TURN · tap a card, touch a lane to aim │  y216–240 my HUD /
└──────────────────────────────────────────────────────────────┘   prompt line
```
> **Superseded by the shipped rules.** This wireframe draws three rows per lane. `tapstone-rules`
> gives *each seat* its own three-cell track (`state.rs`, `cells[lane][cell]`, cell 0 = back;
> `rules.rs` resolves melee against `enemy[CELLS - 1]`), so a lane holds **six** cells and neither
> ⚖ JP #1 option can display the board. Candidate layouts are rendered from real engine states in
> `preview/` — see `preview/MANIFEST.md`. The geometry below is retained as the original intent.

Row A is theirs, row C mine, row B the contested middle where units meet; a unit advances one row
per turn if unblocked (rules TBD — the grid is what the screen commits to). Whose turn is told
three ways: the HUD band of the active player is tinted their faction colour, the LED shows it,
the prompt line says it. The timer counts down only in the last 30 s; before that it shows the
turn number.

### 5. Targeting prompt (touch)
When a tapped card has a choice, the legal targets pulse (rim brightens, 2 frames per second —
one small dirty band each) and everything else dims one palette step. The prompt line names the
choice and shows the countdown to the default.

```
├────────────────────┬────────────────────┬────────────────────┤
│  · · · dimmed · · ·│ ╔════════╗ ⚔5 ♥5   │ ╔════════╗ ⚔2 ♥2   │  legal targets:
│                    │ ║ sprite ║ ▮▮▮▮▮   │ ║ sprite ║ ▮▮░░    │  bright double rim
│                    │ ╚════════╝         │ ╚════════╝         │
├────────────────────┴────────────────────┴────────────────────┤
│ FIREBOLT ▸ touch a target        default: weakest in 5 s  ⏱5 │
```
A whole lane is a legal target too (the column highlights). Lifting the card cancels.

### 6. Combat resolution
Automatic at end of turn, one lane at a time left→right so the eye follows: attacker lunges,
defender flashes, numbers tick, the dead dissolve, the wall shakes if hit. No screen change —
this is the battlefield with a locked prompt line: `RESOLVING · lane 2` and touch ignored.

### 7. Sudden death
From the configured turn: both HUD bands turn the **warm** token (gold) with a thin hazard rule,
the timer is always visible, and each turn both walls lose 1 ♥ before combat. LED pulses gold at
1 Hz. Nothing else moves — the tint is the message.

### 8. Result
```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                      V I C T O R Y                           │  26 px (or DEFEAT / DRAW)
│                 Verdant Reach falls on turn 9                │  17 px
│                                                              │
│      ♥ 6 left · 11 taps · 4 m 12 s · replay sigil  e3-fern   │  14 px
│                                                              │
│   [ rematch: both tap deck ]        [ done: tap castle ]     │  44 px each
└──────────────────────────────────────────────────────────────┘
```
The replay sigil is the realm-sigil name of the tap-list hash — the match's title.

### 9. Spectator variant
A third shrine that pairs while a match is running gets the battlefield unmirrored (arbiter's
view), both names on both bands, no prompt line — replaced by a **narration line** (the Bard's
seat later; for v1 a rule-engine sentence: "Ember Drake strikes the wall for 3").

### 10. Low battery / disconnected
Both are **overlays on the bottom band**, never a screen change mid-match. Low battery: ⚡ glyph
plus percent in the HUD corner from 20 %, band tint `warn` from 10 %. Disconnected: after 3 s
without the peer's hash, the prompt line reads `rival lost · waiting 27 s` and taps are queued
locally, not refused; at 0 the match ends as a draw with the transcript saved. A **state-hash
mismatch** is its own red line (`shrines disagree · match void`) because it is a bug, not a
negotiation (decision 0004).

## Sprite and type budget

- **Sprite 48×48 px = 8.5 mm** on the glass. At arm's length (~60 cm) that subtends ~0.8° —
  a silhouette reads, a face does not. Design sprites as **silhouette + one accent colour + one
  readable prop**; no interior detail under 3 px (0.5 mm). 32 px sprites (5.7 mm) still read as
  shapes but the stats beside them do not, which is why 4 rows is the cramped option.
- **Units on screen:** 9 cells, so at most 9 units; a lane shows 3. One unit per cell, no stacking
  — a cell with two units is a rules smell, not a layout problem.
- **Type** — only sizes already in smol's glyph budget (`theme.slint` type tiers: 13/14/17/22/26/84):
  life **22 px** (`t-value`, 3.9 mm — legible across the table too), unit ⚔/♥ **14 px** with the
  health bar carrying the glance (pips ≤5, bar above), turn/timer 17 px, prompt 14 px, status
  13 px only for things you lean in for. Nothing gameplay-critical under 14 px.
- **Colour roles.** Ownership is *position* (my row is the bottom), never colour. Faction colour
  lives on the sprite rim, the wall, and the HUD tint. **v0 ships two factions plus neutral**
  (`tapstone_rules::cards::Faction`): **Ember** orange `#ff8a3d`, **Tide** cyan `#35c8e0`, and
  **Neutral** slate `#8b93a7` — deliberately desaturated and off the faction axis, so a neutral
  card reads as "belongs to neither" rather than as a third faction. **Grove** green `#7bd45a` and
  **Grave** violet `#b06cff` are *reserved*: the hues are chosen and held, but no card in the
  shipped set carries them, and nothing can draw them until a card does. All four faction hues are
  separated in both hue and luminance so any two survive a sunlit room (contrast) and a dim one
  (saturation), and none collides with the state colours: health green→amber→red, `warn` red
  `#ff5566` for lethal and errors, `warm` gold `#ffd166` for sudden death. Dark ground
  (`bg #000000`, panel `#101728`) as on the watch; the panel is a backlit LCD, so the light scheme
  is the backlight PWM (#482), not a palette swap.

## Motion budget

> **Read the 2× correctly.** It is the cost of *scattering many small windows*, one per cell —
> not a per-pixel penalty on a single contiguous region. `BOARD.md:70` states it inside a bullet
> contrasting contiguous `fill_contiguous` writes against per-pixel `draw_iter`, so one
> contiguous window is priced by its pixel count alone. That is why the 7 ms row below is right,
> and why "redraw the row, not the two cells in it" is correct advice rather than a rule of
> thumb. Two readers have taken the other reading from the old phrasing, and it changes every
> animation estimate in this document by a factor of two. Costed in `rust/shrine-preview/src/cost.rs`.

Full frame ≈ 29 ms and a contiguous partial window costs its pixel share, so the cheapest
animation is **one contiguous band** — a 56 px row is 23 % of the frame ≈ 7 ms; a 106 px column ≈ 10 ms. Design
cadence: **15 fps (66 ms)** for anything that moves, leaving half the budget for the engine, mesh
and touch poll; 30 fps only for a single-band flash. Never two scattered cells in one frame —
redraw the row that contains both.

| animation | frames @15 fps | dirty region | notes |
|---|---|---|---|
| Summon: drop from above, 2-frame squash | 6 (400 ms) | one cell + the cell above | the physical card lands as the sprite does |
| Attack lunge: 8 px toward target, snap back | 4 out + 2 back (400 ms) | the attacker's row **and** the target's cell → redraw the lane column | left→right per lane so lanes don't overlap in time |
| Hit flash: target rim + stats invert | 2 (133 ms) | one cell | palette, not pixels |
| Death: dissolve to faction colour, fall 8 px | 5 (333 ms) | one cell | ends with an empty cell; the player lifts the card |
| Wall hit: wall band shakes ±2 px, ♥ ticks | 4 (266 ms) | 12 px wall band + HUD band | two bands, sequential |
| Lethal: full-frame invert, then result cut | 2 full frames (60 ms) + hard cut | full | the one full-screen motion allowed, and it is two frames |
| Turn change | 0 | HUD band | tint + LED, no motion |
| Targeting pulse | 2 fps | rims of legal cells | palette toggle |
| Idle sprites | **none** | — | the brief's "one idle animation" is deferred; 9 idling sprites is 9 dirty cells a frame |

Fake with palette or the LED instead of pixels: turn ownership, sudden death, poison/status
(rim colour), mana gain (pip fill), low battery, disconnect. Page changes are hard cuts, exactly
as `ui/cyd/shell.slint` ruled for the same panel.

## Touch grammar

| gesture | meaning | card-only / purist equivalent |
|---|---|---|
| **tap card on pad** | summon / cast | — this *is* the game |
| **touch** a cell or lane | target / confirm | 5 s countdown to the rules' default (weakest, nearest, last-tapped lane); the prompt says which |
| **long-press** a friendly unit (500 ms) | activate its ability | re-tap the unit's card on the pad |
| **two fingers** anywhere | pass turn | tap the **castle card**; or the turn timer runs out |
| **lift card** during a prompt | cancel | — |

Touch targets are whole cells (106×56 px), never the 14 px stats. Purist mode is a CFG key
(`house rules` over the mesh): touch off, every prompt resolves by default-plus-countdown, pass by
castle card or timer. Every screen must be completable in purist mode; that is the test that
keeps touch optional. Two-finger detection is unverified on smol's touch path (PARITY.md verifies
taps and swipes only) — the castle card is the pass gesture until it is.

## Light and faces as language

The LED speaks the four states the eye should not need the screen for: **breathe** faction colour
in idle, **solid** active player's colour during their turn, **white flash** on any hit to me,
**red strobe** at lethal, **gold pulse** in sudden death, **blue blink** while disconnected. The
scry faces remain the idle vocabulary — the orb is the shrine's resting expression, the IMBUED
verdict face becomes the **summon-refused** face (card not legal now: same frame, one line
changed), and "present a blank card" becomes "present your deck".

## First playtest cut

**Build:** idle (cached orb), pairing, battlefield, targeting (lane and unit), combat resolution,
result, disconnected line. **Animate:** summon drop, attack lunge + hit flash, death dissolve,
lethal invert. **Light:** the single LED with turn colour + lethal strobe (if #491 lands; else
skip). **Defer:** setup/mulligan screen (say it aloud, tap castle cards), sudden-death visuals
beyond the HUD tint, spectator, low battery (no cell fitted), idle sprite animation, audio, the
Bard line, any two-finger gesture. Ship the playtest with pass = castle card and see if anyone
reaches for the glass.

## How this fits smol's GUI flavor

Slint scenes are compiled in by `build.rs` with absolute geometry and `visible:` gating; a page
flip measures 74–79 ms. That suits chrome, not combat. The battlefield should be a **`kind:
Framebuffer` app** — the six games already draw via `embedded-graphics` with Rust constants and
touch no `.slint` (`PROPOSED-game-geometry.md`), and on the S3 the PSRAM holds two full RGB565
frames, so a full-frame flush at 15 fps is inside budget. Card art is then **runtime data**
(palette-indexed sprite blobs in a flash partition), so a growing card set never recompiles a
scene; Slint keeps the launcher tile and the settings page. The gaps that path needs in smol:

- **#473 custom screens** — the GUI flavor must render fleet-style custom screens; Tapstone needs
  it for the idle/result faces authored by scry or HA and shown *offline* from a cached frame.
- **#491 LED** — no WS2812 driver in the GUI flavor; without it the light language is silent and
  the *ring* is external hardware regardless (below).
- **#477 audio** — the codec path is proven electrically; the speaker install is the gate, and
  unit sounds carry half the joy, so the first table test tells us how much we miss them.

## Feasibility red flags

1. **There is no LED ring.** The board has one WS2812 on GPIO42. A pad-ring is a WS2812 strip on
   a free GPIO inside the printed case — hardware and a case revision, not firmware.
2. **The faces live on a server.** spike-scry streams `GET /screen-idle` over WiFi; a no-server
   table needs faces cached or drawn locally. Cheap, but it is new code, not reuse.
3. **Mesh-OTA receive is unsupported by construction on GUI flavors** (PARITY.md, #495
   concluded 08-27). Card-set updates "signed over the mesh" are a roadmap line; playtest
   shrines update over USB.
4. **Slint is 13 fps here.** Anything animated must live in the framebuffer path; do not let the
   battlefield start as a `.slint` scene.
5. **Two-finger pass is unverified**; **audio has no speaker**; **battery has no cell.** All three
   are correctly deferred above, none blocks the playtest.
6. **One loop serves the panel and the pad.** spike-scry polls the MFRC522 (its own SPI3 bus,
   separate from the display's SPI2) from the same main loop that paints; a 15 fps flush loop
   must interleave the reader poll or a tap mid-animation is missed. Timing, not wiring — measure
   before trusting.
