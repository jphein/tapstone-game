# The guide v2, and a hand you can put anywhere: design (2026-09-28)

Branch `feat/xr-guide-v2`. Part of #129. The input is what JP hit on his Quest 2 on 2026-09-28:
- A resumed round-3 match restarted the guide at "claim", then "draw".
- He never learned to charge, so with 0 mana every card was refused with "You can't play that card now."
- The controller guard's "put down" line cut off the claim line.
- Lines spoken before XR entry were blocked by autoplay and never came back.
- He also said: "you need to be able to place your hand wherever is best for you".

## Goals
1. **The guide follows the match state, not a clock.**
   - On load, on resume and on every view, it derives what the person has already done: placed, seat
     claimed, hand drawn, charged, cast a unit, passed.
   - It jumps forward to the first beat not yet done, and never tells them to do what they've done.
   - A beat that teaches one of their moves waits for their turn.
   - The watching beats (the bot's turn, unguided play) still end on their payoff or their own window.
     That is the only clock left, and it never skips a lesson.
2. **Every move taught is shown, not just said.**
   - A translucent ghost hand plays the move: pinch the deck and touch it to the stone; pinch a card,
     turn the wrist face down and touch it to the stone; pinch a card and touch it face up to the lane's
     pad; pinch the castle and touch it to the stone (the claim and the pass).
   - The target glows and a dotted path shows the route.
   - A caption over the demo carries the same sentence the voice says.
3. **Refusals say why and what to do, from the engine's own numbers.**
   - Card costs come from `table.hand()`, and mana is `charged - spent` from the view.
   - Example: "Hearth Warden needs 2 mana — you have 0. Charge a card: flip it face down and touch it
     to the stone."
   - The other refusals map from the rules' `Refusal` enum: the entry cell taken, a charge already this
     round, a lane already advanced this turn, not your move.
4. **Lines never cut each other off mid-lesson.**
   - One queue: a lesson line plays to its end; only the newest refusal is kept, played after the
     current line; status lines ("Your move.") are dropped rather than queued.
   - The controller guard's line waits its turn like any other.
   - On XR entry the current beat's line is said again, since anything said before entry was blocked
     by autoplay.
5. **The fan can be put anywhere reachable.**
   - Pinch the grip bar under the hand of cards and move it; it stays where it was let go.
   - The spot is clamped to reach and remembered per page in localStorage, once per handedness.
   - It is a child of the board, so seated mode's re-placing carries it along.

## Approach (files)
- `src/guide/lesson.js` (pure):
  - `factsFrom(view, near, history)`, where the history is the kinds of the journal's tap keys
    (`d/`, `c/`, `u/`, `s/`, `a/`, `p`, `m`) plus live gestures;
  - `lessonFor(beat, view, near, menu, hand)`, which gives the sentence and the demo (source and target)
    for this moment;
  - `contradicts(lesson, view, near, menu)`, the check the IWER runs apply to every line said.
- `src/guide/lines.js` (pure): `LineQueue`, with the priorities above. Each line ends on its clip's
  `ended`, or on a reading-time estimate when it has no clip.
- `src/guide/demo.js` (pure): the keyframes for each demo (hand position, pinch, wrist roll over
  time), so node can check that a flip rolls 180° before it touches, and so on.
- `src/guide/ghost.js` (three): the ghost hand, the path dots, the glow ring and the caption.
- `src/logic/first-five.js`: `sync(facts, now)` jumps forward to the first undone beat. The clock no
  longer starts teaching beats; a resumed match no longer skips the whole guide.
- `src/logic/menu.js`: `explainRefusal(gesture, menu, ctx)`, beside `matchGesture` (its answers are
  unchanged when no context is given).
- `src/hand.js`: the fan's origin, the grip entity, the clamp. `src/access.js` stores the spot.
- `src/voice.js`: the speaker reports when a clip ends, and whether one was blocked, for the queue.
- `src/play.js` wiring, kept minimal: facts, sync, the queue in place of direct `altar.say`, and the
  ghost's update.

## Budget (Quest 2: hold 72 fps; measured 90/90 on the plain scene)
- **Ghost:** a merged palm-and-three-fingers mesh plus a thumb and an index finger (3 draws), path
  dots as one InstancedMesh (1), a glow ring (1), a caption plane (1). That's at most 6 draws and
  about 2k triangles, shown only while a demo runs.
- **Grip:** 1 draw.
- **Textures:** one 512×96 caption canvas (0.2 MB), nothing fetched, 0 bytes added to the download.
- Measured before and after with `__tapstone.render()` in IWER on the B60, with the ghost showing
  and hidden.

## Voice
New sentences have no rendered clip, so they are drawn and not spoken. 0033 allows this: the band is
the source of truth. Existing beat sentences are reused word for word, so their clips still play. The
new sentences are listed in the lane log as a render request for the lead
(`tools/voice_lines.py`, Azure Speech; not run by this lane).

## Proof
- Node tests: facts, lesson, contradiction, the queue, the demo keyframes, the refusal texts, the
  fan's clamp and storage.
- IWER: a fresh match, and a match resumed in round 3, in which no line said contradicts the state
  (checked by `contradicts`).
- A perturbation: the guide ignoring the state (the old script) makes the resumed run red.
- Ghost-hand stills for the lead: the draw, the flip, the cast and the pass.

## As built (2026-09-28)
**Changed from the plan:**
- **Draw calls and triangles.** Measured in IWER (`tools/iwer-guide-budget.mjs`, `renderer.info`,
  median of 20 frames; the XR camera renders two views): the ghost demo plus the grip add **20 draw
  calls and 5,756 triangles a frame** (10 and about 2.9k per eye), only while a demo plays. Guide
  hidden: 112 calls and 19,020 triangles; demo shown: 132 and 24,776. The dot and palm tessellation
  were trimmed from +8,620 triangles.
- **Textures:** +0.44 MB (the 1024×112 caption canvas); +0 bytes downloaded.
- **Voice.** `test/voice.test.js` requires a rendered clip for every fixed sentence the headset says.
  - Refusals with nothing to add keep their plain, voiced text.
  - The composed ones carry a card's name, a cost, a count or a lane, so they are drawn and not
    spoken (0033).
  - Nothing new needs rendering.
- **The grip** is a 2.8 cm lantern-gold knob at the fan's outer end, mirrored for left-handed play.
  At 1.4 cm, IWER's pinch aimed at it didn't take hold (the hand's position is the wrist; the pinch
  point sits about 5 cm off it), and hand tracking wobbles by about a centimetre.
- **Guide lessons supersede waiting ones** (topic `guide`), so "Draw 4" is never said after
  "Draw 3" is true.
- **A clip blocked by autoplay** ends its line at the reading time; it had stalled the queue 9 s per
  line.
- **Status lines are held while the guide teaches a move**, so "Draw 5" isn't said while it teaches
  the claim.

**Evidence** (details in the lane log):
- IWER fresh match: 0 contradictions, 0 refused, lessons in order.
- JP's round-3 resume: lessons go place, flip, cast, never back to claim or draw, with 0
  contradictions. With the guide ignoring the state (the perturbation) it says claim and draw, with
  2 contradictions.
- xr_capture on the B60 (82 s, paced by the voice): 24 lines played, 0 cut, 0 refused.

## With #199 (world art) and #200 (accessibility): rebased 2026-09-29 onto 4498765
- **Order.** #200's first-run offer comes first. Until it is answered, the guide says nothing and
  moves no beat (`Guide.tick` with `ready: access.offered`), and status lines wait too. Then the guide
  starts from the match state, as before.
- **Each way of playing is taught its own way** (`src/guide/modes.js`, from #200's own mappings):
  - *Head gaze:* a dwell ring (the live ring's shader, moved to `src/dwell-ring.js` so both use one)
    fills on each of `gazeForItem`'s targets in turn, captioned "Look at Cinder Whelp twice, then at
    the middle pad."
  - *Voice:* the phrase `voiceForItem` plays, on the caption band: "Say “charge Cinder Whelp”."
  - Neither shows the hand. The mana detour keeps its numbers and ends with the mode's own way to
    charge, and so do the refusals.
- **Themed** (#200's hook): in high contrast the ghost takes the reticle's white; the path, rings and
  grip take the dwell and pad yellow. The caption is #199's engraved plate, which redraws itself for
  high contrast.
- **The fan** keeps #199's card mesh and its `-π/3` tilt (5ec0958's revert); only the origin moves.
- **`assist.js`,** minimally: the offer's answer and its refusals go through the line queue, and its
  dwell-ring shader now comes from `dwell-ring.js`.
- **Budget** (B60, `renderer.info`, two views). The demo's materials are single-pass: three drew them
  twice, as transparent and double-sided.

  | mode | draw calls | triangles |
  |---|---|---|
  | hands | 94 → 110 (+16) | 25,724 → 29,208 (+3,484) |
  | gaze | 96 → 108 (+12) | 25,884 → 27,352 (+1,468) |

  Only while a demo shows; the caption canvas adds 0.44 MB; the download adds 0.
- **Evidence** (`tools/iwer-guide-b60.mjs`, the B60):

  | run | taps | refused | fallbacks | contradictions |
  |---|---|---|---|---|
  | hands fresh | 26 | 0 | 0 | 0 |
  | gaze fresh (50 dwells) | 26 | 0 | 0 | 0 |
  | hands, JP's round-3 resume | 18 | 0 | 1 | 0 |
  | gaze, JP's round-3 resume (34 dwells) | 18 | 0 | 0 | 0 |

  - Voice lines cut: 0; requests after "loaded": 0; the guide was silent before the offer in all four.
  - The resumes go place, flip, cast, never back to claim or draw.
  - The one fallback (the emulated hand's cast of Hearth Warden to lane 0) repeats with the ghost and
    grip out of play (`--bare`), so it is the carry's, not the guide's.
