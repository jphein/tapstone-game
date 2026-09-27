# Materials and light (DRAFT)
Date: 2026-09-20 · JP: "I love using brass and silver and copper and wood, and crystals as lenses
for NeoPixel LEDs."

## The palette
Wood body and pad, brass or copper for edges, rails and the lane markers, silver for the faction
of the cold side, crystal cabochons over the LEDs. It matches the realm's own look (parchment and
gilt by day, midnight and gilt by night in Grimoire's UI) and it makes a shrine feel like an object,
not a device.

## The one constraint: metal and the antenna
The MFRC522 reads by a 13.56 MHz magnetic field. **Any conductive sheet in or over the field kills
the read; a closed metal ring around the coil detunes it.** So:
- **Pad top: wood, resin or PLA**, 1.5–2 mm. Wood is RF-transparent and feels right under a card.
- **Brass and copper as accents beside the pad**, not across it: a lip, corner caps, the lane
  markers on the mat. An open ring (a gap in it) around the pad is usually fine; a closed one is a
  shorted turn. Test each metal accent with a card before glue.
- The CYD's shield, USB body and any battery are metal too; the apron keeps the coil clear of them.
- Silver and copper wire *inlay* on the pad surface works only as thin, open, non-looping lines;
  a filled inlay is a shield.

## Crystals as lenses
NeoPixels under quartz, amethyst, citrine or glass cabochons make the light diffuse and warm, and
the stone chooses the colour's character (amethyst cools a blue, citrine warms a red). Ideas that
fit the game:
- A **ring of cabochons around the pad**, one per lane or per phase; the active player's colour
  breathes, lethal flashes, a refused tap pulses red once.
- **Faction stones** on the castle card slots: the deck you tapped in lights its stone.
- A **single large crystal at the top of the stand** as the shrine's "eye": idle glow, pairing
  search, victory burst. The scry station's idle faces already have this vocabulary.
- Light pipes: a cabochon needs the LED close and centred; a small reflector cup printed in white
  behind it doubles the brightness.
smol gap: the s3-cyd GUI flavor has the LED pin only (#491); the fleet flavor drives WS2812 today.

## Build notes for the first shrines
- Playtest one: bare printed parts, no metal, no stones. Prove the game.
- Shrine two-point-oh: wood apron top, brass lip, one crystal eye. Photograph it; that image is the
  pitch.
