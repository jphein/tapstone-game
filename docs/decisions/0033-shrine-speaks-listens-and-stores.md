# 0033 — The shrine speaks, listens, and keeps its data on an SD card
Date: 2026-09-23 · JP's ruling (speaker, mic and SD on the new shrine unit) · Amends 0025, 0032

JP's new shrine unit (2026-09-23) has the speaker fitted, the mic, and a MicroSD card, and **JP has
tested it** (his report, 2026-09-23; not yet driven by Tapstone or smol firmware from katana).
The shrine uses all three. **The voice band (0032) is spoken aloud as well as shown**, the player
can **answer by voice**, and sprites, paperdoll overlays and voice clips live on the **SD card**.

## A board fact that was wrong

smol's `targets/s3-cyd/BOARD.md:52` says *"SD card — does not exist on this board"*, and
`board-staging/board_es3c28p.rs:452` repeats it. The vendor schematic it claims as its first source
(`ember.realm.watch/docs/vendor/ES3C28P_Schematic.pdf`) contains a **"MicroSD card slot interface
circuit"** with `SD_CLK`, `SD_CMD` and `SD_D0`–`SD_D3` on 10K pull-ups. The doc was triple-sourced
from three references that probably all just never used the slot, and a slot nobody used reads as a
slot that isn't there. The exact GPIOs go into smol's board module from the schematic, not from this
file. Until the card is mounted by smol's own firmware, the pin map is a schematic claim. The slot itself is confirmed
by JP's test on the new unit.

## Storage (amends 0025)

- 0025's second reason, *"storage is the wall, not playback"*, lifts: a card holds gigabytes
  against a 3–4 MB partition. Everything the shrine draws or says from a set goes on the card as one
  **data pack** per set. Internal flash keeps a minimal fallback (idle face, text-only voice) so a
  shrine with no card still plays.
- **0025's verdict does not change.** Its other three reasons still hold. The SPI panel's frame
  budget is untouched by where bytes are stored (a full repaint is still 97% of it), a 32–48 px
  sprite downscaled from video is still mush, and the board is still combinatorial. The shrine stays
  on pixel sprites, and Veo stays on the arena and the phone.

## Speaking

- **Fixed lines are pre-rendered.** Every predictable sentence (prompts, refusals, "your commander
  returns next round", item and card names, level-up) is rendered at build time with Piper and
  shipped as clips in the data pack. That means no network, no latency, and the same voice every
  time.
- **Only the dynamic remainder is streamed** from the arena (Piper on the arena box, no cloud).
  Audio competes with `MATCH` frames on the mesh. The codec's BCLK-derived mode refuses rates below
  22,050 Hz (BOARD.md landmine L5), so raw 16-bit mono is ~353 kbit/s and 4-bit ADPCM ~88 kbit/s.
  The transport is a protocol-draft question to be settled **by a measurement**. The design keeps
  streamed speech rare enough that the answer is not load-bearing.
- **The voice band stays the source of truth.** Every spoken line is also shown. With the sound off
  the game loses nothing: 0009's glass-covered acceptance test gains a twin, *the game is playable
  muted*.

## Listening

- **Push-to-talk only.** The speaker sits inches from the mic and there is no echo cancellation
  (BOARD.md), so the shrine never listens while it speaks. Touching and holding the voice band mutes
  the amp and opens the mic, and releasing it closes the mic.
- **A closed grammar.** Captured audio goes to the arena's STT (a Parakeet/Wyoming stack like
  familiar's) and is matched against the **current prompt's answers only**: "cast", "charge", "lane
  two", "the Tidecaller", "pass". Anything else is a refusal in the voice band. Voice is another
  way to answer a prompt, never a new kind of action, so "one tap per action" holds and every voice
  answer still has a card path (0009).

## Open, and named

- The GPIO map and bus sharing of the SD slot come from the schematic into smol, then an on-glass
  mount. They do not come from this record.
- JP's hand test on the new unit is the positive control that the SD slot, speaker and mic work.
  What remains is smol's side: its own drivers mounting the card and playing and capturing audio on
  that unit, recorded in BOARD.md and PARITY.md with the firmware that did it.
- The streaming transport (mesh vs a WiFi link to the arena) is settled in the protocol draft.

## Correction 2026-09-23 — the uplink was not argued, and the wire rate was overstated

**The mic direction carries the load that speaking avoids.** Pre-rendering makes *downstream*
speech rare, but every voice answer *uploads* captured audio to the arena. A 1.5 s push-to-talk at
4-bit ADPCM is about 16 KB, which is some 80 frames at the mesh's ~200 B payload, per answer, in
the middle of a turn. "Not load-bearing" held for one direction only. **Consequence:** voice answers
most likely want a WiFi link to the arena rather than the mesh, or on-device resampling to 16 kHz,
or both. The protocol draft decides by measurement, and until then voice is a phase-2 stretch goal,
not a playtest-one requirement.

**The 22,050 Hz floor limits the codec, not the wire.** The shrine can capture at 22,050 Hz and
send at a lower rate after downsampling on the device (or upsample on playback), so the figures
above are upper bounds. The error overstates cost, which is the safe direction.
