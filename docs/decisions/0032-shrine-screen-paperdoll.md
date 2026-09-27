# 0032 — The shrine screen: the paperdoll, the voice, the small motions
Date: 2026-09-23 · JP's ruling · Amends 0020 · 0025's budget stands · Supersedes shrine-ux.md screens 4–7

The shrine screen does three jobs and no others. It **shows your commander** as a paperdoll with
level, stats and gear. It **talks to you**: prompts, refusals, whispers and results. It **plays small
animations**. The battlefield is the arena's (0028).

## Screens

1. **Idle (amends 0020):** the last commander seen on this shrine, standing, with an idle breath.
   Its name, level and the shrine's sigil name appear, with "set your castle on the stone" as the
   invitation. With no commander yet it shows a hooded silhouette.
2. **Lobby / loadout:** the paperdoll with three slot sockets, the inventory as a grid of 12
   (3×4 of 48 px) beside it, and XP to next level. Touch an item to equip it; tap an item card to
   equip that card (0031). The 5-second default re-applies the last loadout.
3. **In match — the station:** the paperdoll, mirrored live from match state. Its toughness and
   damage appear as a bar, with its lane and cell as a small three-lane locator (a glyph, not a
   board). A "fallen, returns in N" state shows when it is dead (0029). Beside it, the glanceable
   state from the old personal panel: castle life, mana (charged/spent), hand count, round. The
   bottom band is **the voice**.
4. **Result:** win or loss, XP gained with a bar filling, level-up if earned, and the loot reveal.
5. **Dark / waiting:** the arena is gone (0028), the shrine is dormant, or the battery is low.

## The voice

A single message band that owns every sentence the shrine says to its player: the prompt
(cast-or-charge, lane, target), the reason for a refusal (with 0007's red eye pulse), and whispers
("your commander returns next round", "the Tide castle is at 4"). **One line, one message, newest
wins**, and a message stays until it is answered or superseded. The band is the only text surface
in a match, so the player always knows where to look. This is 0009's prompt surface given a name
and a single home. It is also spoken aloud and can be answered by voice (0033), but the band stays
the source of truth.

## Motion

Small, and all inside 0025's budget: one contiguous dirty rectangle per frame, ~15 fps, never a
per-cell redraw.

- **Idle breath:** the paperdoll cycles 0014's three idle poses (1-2-3-2-1). The rectangle is the
  figure's own bounding box, which is smaller than the lane column 0025 costed at 40%.
- **Struck / heals / falls / returns:** a flash, a stagger, a fade, and a rise, driven by the
  diff of consecutive states (0027's amendment rule: state that only the view needs is computed by
  the view).
- **Equip:** the item drops into its socket. **Level-up:** a column of light over the figure.
  **Loot:** a chest opening in the inventory's first free cell.
- At most one animation plays at a time, and the voice band never animates.

## Paperdoll art

0014's hero sprite is 48 px. The paperdoll draws it at **2× (96 px)**, where the pixel art stays
crisp. Gear is layered as per-slot overlay sprites at the same base, so an item needs one 48 px
overlay, not a redrawn commander. Every overlay is runtime data in the set's data pack on the SD
card (0033), and only a minimal fallback stays in flash. Storage stopped being the constraint here
the moment the card appeared. The frame budget is still one.

## How this will be checked

The screens are rendered in `rust/shrine-preview` at 320×240 RGB565 through `embedded-graphics`
from real engine and ledger state, the way 0027 was decided, before any firmware is written. A
wireframe decides nothing (0027: a monospace grid hid three geometry failures).

## Proposed amendment 2026-09-23 — what the render found (awaiting JP)

Rendered in `rust/shrine-preview` (`preview/station-screens.png`, `preview/station/`) from engine
state at seed 21, round 5, with placeholder commander, items and art. Each point is either a
contradiction the render surfaced or a gap it could not be drawn across. Nothing here changes the
screens' purpose.

1. **The inventory is 3 wide × 4 tall, and the header moves into the left column.** "3×4 of 48 px"
   fits only one way. At 4 wide, the 96 px paperdoll plus a 48 px socket column needs 144 px of the
   128 left over. At 3 wide by 4 tall, the grid uses 192 of the 196 px above the push-to-talk strip
   (item 2), so there is no room for a header above it. Name, level and XP go under the figure.
   These are `const` asserts in `station.rs`, and breaking either one stops the firmware build.
2. **The voice band's touch target is 44 px, even though it is drawn at 24.** 0033 makes "touch
   and hold the voice band" push-to-talk, and the band sits under the 44 px touch floor. The hit
   area is therefore y 196–240, and **no other touch target may enter that strip on any screen**.
   Every screen here keeps it free, and a test holds it. Voice answers are now a phase-2 stretch
   goal (0033's correction), so the affordance is drawn but **optional**. The strip is reserved
   anyway, because adding it later would move touch targets.
3. **A drop into a full grid melts into 1 XP** (**lead's call**, 2026-09-23; reversible, and JP can
   overrule it). "The inventory's first free cell" does not exist at 12 distinct items, and 0031
   melts only duplicates. The ruling extends the duplicate rule: the chest opens over the last cell,
   shows the item, and the item melts into 1 XP. The borrowed cell is then restored, and nothing is
   ever discarded silently. Rendered as `motion-lootfull.png`, and a test holds that the grid is
   unchanged and the XP rises by exactly 1.
4. **"0007's red eye pulse" cites the wrong decision.** 0007 is mana and has no eye. The pulse is
   the design spec's §7 ("one red pulse of the eye"). Because the eye is the LED, the refusal needs
   no band animation, which is consistent with "the voice band never animates". The band marks a
   refusal with colour: a red rule and red text.
5. **"The band is the only text surface in a match" needs to say *sentences*.** The station also
   draws readouts (castle life, mana, hand, round, "returns in 2", "FALLEN"). The rule the render
   supports is that **every sentence is in the band and nothing outside it is a sentence**.
6. **A state change that touches the figure and the band takes two frames.** They are about 90 px
   apart, so one push would be either two windows or one window over most of the panel. The band
   is drawn once, on its own frame, after the motion. It still never animates.
7. **A level that opens a socket needs a frame of its own.** The trinket socket at level 7 lies
   outside the level-up column. The first render unlocked it inside the column's frame (the render
   showed it unlocked, then locked, then unlocked again), and the frame-diff test failed on it.
8. **XP to next level** comes from 0030's ruling after review (flat, 5 XP a level). The bar
   draws against that figure, and at level 10 it shows "max level".
9. **An overlay is only a weak icon for small gear.** A trinket's overlay is a few pixels at the
   throat. The inventory draws each overlay cropped to its measured extent at up to 3×, so no
   second asset is needed. Art direction should still give trinkets at least an ~8 px overlay, or
   they will read as specks in the grid.

10. **Prompts quote 0009's defaults.** A unit asks for a lane ("fewest of yours"), and a spell asks
    for a target ("default: nearest"). The first render asked a *unit* to pick a *target* and gave
    the default as "weakest", which is in no decision.
11. **The station must not show impossible states.** The review of the first render found four,
    and each now has a test with a planted counterexample:
    - The band's sentence must agree with the readout beside it. A refusal read "you have 1"
      beside "4 of 4" mana. The refusal is now the engine's own, from a real mid-turn state.
    - A fall costs the castle 3 (0029), on its own frame.
    - A commander whose back cell is occupied **waits**, derived with saturating arithmetic
      because the engine's return round is then in the past.
    - A bar never reads "5/5 at Lv6" (under a flat 5 per level that is already Lv7). It reads
      "level up!" instead.

12. **Stats follow 0034.** The paperdoll's numbers are 2/4 at every level with any gear. A worn
    Haste or Taunt item shows as a keyword chip on the figure, and a level-up announces what it
    unlocks: the third slot at 7, or a new look at 3, 5 and 10. **Looks need distinct overlays**,
    because two weapons that draw alike are two items the player cannot tell apart. The
    placeholder axe, spear and blade each have their own silhouette, and a test holds that.

13. **The station reads the engine's commander, and one record can change five things.** Attack,
    toughness, keyword, presence and the fall/return rules come from the seat (#49); the lobby
    shows the claim built on the engine's own `LEVEL_1`, and the fixture game is played with that
    claim, so the two cannot disagree. Driving the fall and the return from real engine records
    (seed 11) showed what a synthetic fixture never did: **a death in end-of-turn combat, and a
    return at the turn start, arrive with the round change** — castle (the penalty *plus* combat
    damage, tallied together per 0029), mana refresh, a drawn card and the round all move in the
    same record. Merged, the wells are 204×184 px, larger than a lane column, so **each changed
    well settles on its own frame** after the figure's motion, and then the band. Worst frame is
    unchanged at 35 %.

**Motion budget, as rendered** (worst pushed frame, pessimistic end, 33.3 ms draw budget): breath
26 %, struck and heal 30 %, fall and return 35 %, equip and level-up 36 %, loot and the full-grid melt 24 %, XP fill 17 %.
Every one is one window per frame and stays under half the budget. The breath's rectangle is the
figure's 96×96 box, which confirms this decision's claim that it is smaller than the 40 % lane
column. The figures are pinned in `preview/MANIFEST.md` by a test.

## Proposed amendment 2026-09-23 — draws are taps on the station (0036), awaiting ruling

0036 makes every draw a tap: while a seat owes draws it can do nothing else. This amendment is the
station's side of that. It is rendered as a mock in `preview/station-draws.png` (`d*.png`, and
`motion-draw.png`, `motion-drawlast.png`, `motion-mulligan.png`). Every state is one the engine
reached: since #63 the engine owes draws itself, so the owed count (`Seat::owed_draws`), the
opening-hand size, the mulligan window, and the hand, mana, round and castle are all read from it.
An earlier draft stood the owed count in by hand; that stand-in is gone.

1. **The band states the debt and where to pay it.** The four lines, all under the 49-character
   budget, are:
   - "opening hand: draw N - tap each on the stone" after the claims. N is `rules.hand` plus 0035's
     bonus for seat 1, derived the way the engine deals it, so a table with a different hand shows
     its own number.
   - "draw 1 - tap it on the stone" at each turn start.
   - "<spell>: draw N - tap on the stone" for a spell that draws.
   - "mulligan: draw N - tap each on the stone" after a mulligan.

   Any other tap while draws are owed is refused by the engine (`DrawOwed`, #63), and the band says
   so in the engine's words ("refused: draw first - tap the card", with the eye pulse). An exhausted deck owes nothing and says so once ("your deck is
   empty - nothing to draw").
2. **The paperdoll shows the debt.** While draws are owed, the commander raises its free hand
   (the left; the right keeps the weapon, so no gear is hidden) holding a face-down card, and **the
   count is written on the card** (1–9). The HAND well shows the owed count beside the hand count
   ("3 +2"). The first mock put a "draw N" chip at the figure's feet, where it collided with a boot;
   the card was the better place anyway. When nothing is owed, the hand comes down.
3. **Each draw is acknowledged in about 250 ms, inside the budget.** The held card turns face-up
   in the drawn card's faction colour, and then the figure settles: the next face-down card with
   the count one lower, or the arm down after the last one. Then the HAND well ticks, and then the
   band says **"drew <card>"**, which is also spoken from its pre-rendered clip (0033: card names
   are fixed lines). That is four frames, one rectangle each, with a worst frame of 26 % of the
   draw budget. The name is a whisper: once spoken, the band returns to the standing prompt (the
   next draw, or the mulligan offer after the last opening card).
   **An owed draw owns the band.** The engine refuses everything else while a draw is owed, so no
   whisper may sit in the band over it. The real engine fall at a round turn put "your commander
   returns next round" over an owed turn-start draw; the return is spoken, and the band shows the
   draw. `voice_agrees` holds this for every static screen.
4. **The opening hand and the mulligan.** After the claims, each seat owes its opening hand. Once
   it is drawn, the mulligan window is the engine's own: the seat is active, has not acted and has
   not mulliganed.
   - The band offers "keep: play a card. mulligan: castle twice". Keeping is simply playing: the
     first action closes the window.
   - **The castle during the mulligan window (the lead's call, 2026-09-23).** 0009 makes a castle
     tap pass *immediately*, so "castle twice" as first written was impossible. The first tap
     would commit a Pass and close the window, and the second would arrive as NotYourTurn.
     - **Inside the window only**, a castle tap opens a **3 s prompt**, the same idiom as 0009's
       cast-or-charge. The band says "pass - tap the castle again to mulligan 3s".
     - A second castle tap within the 3 s is the **mulligan**. If the 3 s expire, the seat **keeps
       and passes**.
     - **Nothing is sent until the prompt resolves** (the protocol's "ambiguity is resolved before
       the frame exists"), so no record ever has to be taken back.
     - Outside the window, a castle tap passes immediately, exactly as 0009 says.
     - A castle tap that opens the prompt and is followed within the 3 s by any other action
       (a charge, a cast) still expires to **Pass**: the action closes the window, so no mulligan
       remains to choose, which is what the prompt says: "pass - tap the castle again to mulligan".
     - A test drives the station's input resolver with castle taps alone and reaches the mulligan.
       Its control, the same taps under the immediate-pass rule, cannot.
   - The touch path is the **HAND half of the hand/round well**, outlined while the window is
     open. It is 96×44 px, clear of the push-to-talk strip, and stops short of the ROUND label
     (the first render ran the outline through the "R").
   - After a mulligan the hand empties, and the seat owes as many draws as the hand it returned
     (point 5).
5. **How many a mulligan owes, now settled.** Building this flow found that 0036's first wording
   ("a fresh opening hand") and v0's engine (redraw the hand's current size) differ by one card for
   seat 1, which has drawn at its turn start by then. 0036 was clarified on 2026-09-23 (#61): a
   mulligan owes **as many draws as the hand it returned**. The mock follows that, and a test holds
   it for a hand larger than the opening hand.
6. **A defect the instrument caught in the mock.** embedded-graphics centres a stroke on its
   rectangle's edge, so the 2 px mulligan outline painted 1 px *outside* the HAND well: 240 pixels
   outside the rectangle a draw frame pushes, which would stay stale on the glass. The frame-diff
   test failed before any picture showed it. The outline is now stroked inside, and any future
   2 px outline on a pushed boundary needs the same.

The engine side landed in #63: the per-seat owed-draws count, which `Station::from_game` reads,
and the `DrawOwed` refusal, which the band speaks. The mulligan count is settled (point 5), so
nothing more is owed from the engine for this flow.

## Amendment 2026-09-23 — when the battery speaks (the lead's call)

Building the voice-clip manifest (0033, `game/voice/clips.tsv`) found that nothing said when the
battery is announced. "Battery N%" at every level was 101 of 327 clips. **Ruling:** the battery
is announced at **20 %, 10 % and 5 %** only, and 5 % adds "the shrine will sleep soon". Each
threshold speaks **once per crossing**, not repeatedly while the battery stays below it, and
charging back lets it speak again — but only once the reading reaches **the threshold plus 2 %**
(hysteresis, the lead's call), so ADC jitter between 20 % and 21 % never repeats "battery 20%". A
drop past several thresholds at once speaks only the most urgent. That is 3 clips, not 101.
`voice::BatteryAnnouncer` implements it. Tests hold the manifest to exactly the thresholds, the
announcer to once-per-crossing and re-arm-at-+2 %, and a jitter sequence to one announcement,
with a no-hysteresis control that repeats it.

## Amendment 2026-09-23 — equipping is not level-gated (the lead's ruling)

An item's `min_level` (progression's item table, #65) is a **loot-table** rule: the level at which
the item can drop. **Equipping is not gated by level.** The only level gate is the third slot, at
`THIRD_SLOT_AT` (7). Under 0034, gear is Haste, Taunt or a look, so a level gate would protect no
balance. A station-only gate would also refuse in the lobby what ClaimSeat accepts, which is two
sources disagreeing. The lobby's equip legality is therefore exactly progression's
`derive_commander`, and a test holds the two equal for every item at every level. Its control, a
planted station-side min-level gate, is caught disagreeing.
