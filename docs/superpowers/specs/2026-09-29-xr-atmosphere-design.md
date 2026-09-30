# The headset's magic atmosphere: air, light and sound in the Tea House (design)
Date: 2026-09-29 · Lane: Luna · Branch `feat/xr-atmosphere` · Canon: 0039 · Builds on #199 (the world art)

JP, on his Quest 2 in Full VR (before #199's art): "it still doesn't have a nice magic atmosphere".
The room is now built and lit (#199); this note is what makes it feel alive: moving air, living light
and a sound bed. Full VR comes first; mixed reality gets the doors' share of it (the player's own room
stays the Tea House, and passthrough stays purposeful).

## Goals

1. **Air.** Motes drifting in the lantern light and embers rising round the lanterns; incense curling
   from a censer and steam off the teapot and cups; and at each door its realm breathing out:
   the Forge Peaks' sparks and heat shimmer, the Deep Tides' bubbles and caustics thrown on the floor,
   the Hearthlands' fireflies, the red door's slow violet wisps (the Dueling Grounds).
2. **Light.** The lanterns flicker (the halos and, faintly, the baked room itself); soft god-rays
   fall through the shoji; every door spills its light on the floor (caustics, heat, dappled leaf
   light). A gentle sparkle runs over the cards the player can play right now, read from the
   engine's own menu (its legal moves), never guessed.
3. **Sound.** A spatialised ambient bed: room tone, a lantern's crackle and hush, wind chimes, water
   at the Deep Tides door, a low forge rumble at the Forge Peaks door, crickets at the Hearthlands
   door, a low hum at the red door. In mixed reality only the doors sound (it is the player's room).
   No autoplay: the bed starts inside the XR session, which a gesture opened, and waits for the
   context to run. A volume setting (off, low, medium, high) in the access panel and the settings tiles.
4. **Access.** Reduced motion: half the particles, slower, no flicker, no twinkle (the sparkle is a
   steady rim). High contrast: the air and rays are dimmed (never over anything a person must read),
   and a playable card gets a yellow edge instead of a sparkle.

## PROPOSAL marks (the bible is silent)

The incense and its censer, the god-rays' moonlight through the shoji, each door's breath (sparks,
bubbles, fireflies, wisps) and its floor light, the chimes, and every sound's character. The canon is
0039's "lantern light, magical tea" and the planes behind the doors.

## Approach and budget

- **All procedural: no new asset files.** Particles are GPU point sprites (one draw per cloud), the
  floor light is one merged mesh with a shader, the rays are one additive mesh. The sound is
  synthesized in WebAudio (noise, filters, oscillators, HRTF panners), so the audio download is
  0 MB and nothing goes into CREDITS.md. Freesound CC0 needs an account to download, and synthesis
  keeps net afterLoad at 0 with no licence question.
- Draw calls: +1 door air (both modes), +1 floor light (both), +1 rays (VR); the interior's glow
  cloud grows but stays one draw. Particles: about 200 in the room, about 160 at the doors (half with
  reduced motion). No post-processing bloom, no shadows, no new textures beyond one 64 px sprite.
- CPU per frame: uniforms only (time, flicker, the listener pose); the particles move in the shader.
- Measured in IWER on the B60: draw calls, triangles, texture MB and fps, before and after.

## Files

- New: `src/logic/atmosphere.js` (pure: particle plans per mode, the flicker, playable cards from
  the menu, the chime scale and schedule, the volume levels), `src/art/air.js` (the clouds, floor
  light and rays), `src/art/ambience.js` (the sound bed), `test/atmosphere.test.js`.
- Touched minimally: `src/art/interior.js` (the glow cloud's new kinds), `src/art/card-mesh.js` (the
  playable sparkle), `src/teahouse.js` (builds and ticks it), `play.js` (one line: the menu to the
  sparkle), `logic/access.js`, `src/access.js`, `index.html` and `assist.js` (the volume setting).
