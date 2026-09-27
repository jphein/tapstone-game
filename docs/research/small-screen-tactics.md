---
title: "Tactical card games on tiny displays — sprite sizes, unit counts and animation budgets"
last_verified: 2026-09-20
sources:
  - https://help.play.date/developer/designing-for-playdate/  (400×240, 173 ppi, text ≥12 px, sprites ≥32 px, 30 fps / 20 fps)
  - https://github.com/pokemon-mini/pm-dev-docs/blob/master/Specs.md  (96×64, 16×16 sprites, 24 max, 8×8 tiles, 4 MHz)
  - https://en.wikipedia.org/wiki/Pok%C3%A9mon_Mini  and  https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Zany_Cards
  - https://feuniverse.us/t/gba-fe-sprites/8379  (GBA Fire Emblem map sprites: 16×16 standing 3 poses, 32×32 moving 4 frames)
  - https://gbadev.net/tonc/objbg.html  (GBA 240×160, 8×8 tiles, OBJ sizes)
  - https://en.wikipedia.org/wiki/Trade_&_Battle:_Card_Hero  (GBC: 4 monster slots per side, 15/20/30-card decks)
  - https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Trading_Card_Game_(video_game)  (GBC duel screen: one active card each side)
  - https://community.arduboy.com/t/wip-arduwars/5978  and  https://github.com/felipemanga/HelloCommander  (Arduboy 128×64 tactics)
  - https://www.mattgreer.dev/blog/squeezing-the-arduboy-for-every-byte/
  - https://itch.io/games/tag-card-game/tag-playdate  (Clash Cards, Battle Mons, Eldritch Soul, NeoTrick…)
  - smol targets/s3-cyd/BOARD.md  (ES3C28P, ILI9341V 2.8" 320×240)
---

# Tactical card games on tiny screens

The shrine is an ILI9341V **2.8-inch 320×240** panel (smol `s3-cyd`, ES3C28P). At 4:3 that is
2.24 × 1.68 inches, **≈143 ppi**. Everything below is scaled to that number.

## The precedents, by pixel

| Device | Screen | ppi | Game | How it laid out a card battle |
|---|---|---|---|---|
| **Pokémon Mini** (2001) | 96×64 1-bit (+ a flicker half-tone), 4 MHz | — | *Pokémon Zany Cards* (Denyusha, 2001): Wild Match, Special Seven, **Card Duel** (2-player, read the opponent's hidden card), Four Kings | Hardware: 8×8 tiles, **16×16 sprites, max 24 on screen**. A "card" is one 16×16 sprite plus a rank glyph; a duel shows one card per side. Multiplayer over IR between two Minis ≈ two shrines over ESP-NOW. |
| **Game Boy Color** (1998–2000) | 160×144, 4 colours/palette | ≈83 | *Pokémon TCG* (1998): duel screen shows **one active Pokémon card per side** with name, HP, energy count, plus deck and bench *counts*; everything else is a menu ("Check"). *Trade & Battle: Card Hero* (Nintendo/IS, 2000): **4 monster slots per side, 2 front / 2 back**, Masters with 5 HP (10 in Pro), 15-card decks on GBC (20/30 on paper). | The lesson is *counts not lists*: the field is 2–4 slots, the hand and deck are numbers, detail is a page you open. |
| **GBA** (2001) | 240×160 | ≈99 | *Fire Emblem* 6–8, *Advance Wars* | Standing map sprites **16×16** (16×32 / 32×32 for large classes), **3 poses cycled 1-2-3-2-1** for the idle bob; moving sprites **32×32, 4 frames** per direction. A 15×10 tile map holds 20–30 legible units at 16 px. Battle scenes cut to a big 248×160 animation of *two* units. |
| **Arduboy** (2015) | 128×64 1-bit | — | *Arduwars* (Advance Wars port: 3 maps, land/air/sea, AI + pass-the-device), *Hello Commander* | Coordinates are packed to an 8×4 grid to save bytes; units are 8×8 or 16×16; a screen shows a **~16×8 tile** window. Legible only because 1-bit contrast is absolute. |
| **Playdate** (2022) | 400×240 1-bit | 173 | *Clash Cards* ("card battling"), *Battle Mons* (CCG adventure), *Eldritch Soul*, *NeoTrick*, *Not quite Balatro* | Panic's own guide: **text ≥12 px (prefer 14) for dialog, ≥10 px HUD, 8 px only for rarely-read text, 2-px strokes; sprites "around 32×32" minimum; avoid 8×8 tiles; 30 fps target, 20 fps acceptable for chunky animation.** "Playing cards must be large enough to read comfortably." |

## Translating to 143 ppi, 320×240

Physical legibility is what matters; convert Panic's 173-ppi rules to the shrine:

| Playdate rule (173 ppi) | Physical | On the shrine (143 ppi) |
|---|---|---|
| Dialog text ≥12–14 px | 1.8–2.1 mm | **≥10–12 px** |
| HUD text ≥10 px | 1.5 mm | **≥8 px** (a 5×7 font is the floor for HP digits; 8×12 is comfortable) |
| Sprite ≥32×32 | 4.7 mm | **≥26 px → use 32 px**; 48 px is "big" |
| No 8×8 tiles | 1.2 mm | Agreed; 8 px is a detail, never a unit |

Colour helps: the ILI9341 has 65k colours and a backlight, so faction colour and a 1-px dark
outline do work that the 1-bit devices had to do with size. GBA's 16×16 units at 99 ppi are 4.1 mm
tall — on the shrine that is 23 px, so **GBA-scale units are 24 px, Playdate-scale are 32 px**.

**How many units fit legibly.** With a 24-px status band top and bottom (life totals, gold, turn
clock, sudden-death counter), the battlefield is 320×192. Three lanes × 4 cells → **80×64 px
cells**: a 48-px sprite with a 5×7 HP digit and room to breathe. Three lanes × 3 cells → 106×64.
Four lanes × 4 cells → 80×48 cells, forcing 32-px sprites. **12 cells with 48-px sprites is the
comfortable maximum**; GBA's 20–30 units per screen were only legible because nobody read stats off
the map. Mirror the C&C convention: the field shows sprites and HP digits; the card's text lives on
the *physical* card in the player's hand, which is the shrine's greatest advantage over every
handheld above — the hand is already printed at 300 dpi.

## Animation budgets that felt good

- **Idle**: Fire Emblem's 3-pose 1-2-3-2-1 bob at ~4–6 fps *reads as alive* and costs 3 frames per
  unit. Pokémon Mini did 2 frames. **Budget: 2–3 idle frames per unit.**
- **Attack**: GBA map sprites don't animate attacks — the game cuts to a battle scene. On the shrine
  the equivalent is a **lunge (move sprite 8–16 px toward the target and back, 4–6 frames)** plus a
  hit flash on the victim and a 2–3-frame slash/impact sprite reused across all units. One bespoke
  attack pose per unit is the brief's "one attack animation"; the lunge and flash are shared code.
- **Summon**: the moment C&C players love. Drop-in from above with a 1-frame squash, or a 4-frame
  materialise — 6 frames at 20 fps is 300 ms, which matches a tap's "click."
- **Frame rate**: Panic's 20 fps "chunky" floor is fine for a turn-based game; smol's `mipidsi`
  flush over SPI2 at 40 MHz can push a 320×240 RGB565 frame in ~31 ms in theory (150 KB at 5 MB/s),
  so **partial redraws** (dirty cells) are the way to hit 20–30 fps for local animations, as the GBA
  did with hardware OBJs. Never animate the whole board at once.
- **Text**: never animate text; scroll by 2-px multiples if anything scrolls (Panic's dither-flash
  rule is about 1-bit, but the ILI9341 tearing on SPI makes the same advice sensible).

## Design rules that fall out

1. **Sprite base 32 px, hero/large 48 px; HP digits in an 8×12 font; 24-px HUD bands.**
2. **≤12 cells on screen; 3 lanes is the sweet spot for 4:3.**
3. **Stats on the card, sprites on the screen** — the GBC "counts, not lists" rule.
4. **Three idle frames, one attack pose, shared lunge/flash/summon code**: for a 60-card set that is
   ~240 hand-drawn frames of 32–48 px, which is a weekend of cardpress cuts, not a studio.
5. **Both shrines animate the same event from the same tap**, like two Pokémon Minis over IR; the
   protocol carries the tap, never the frame.
