// sparkle.js: the gentle sparkle on the cards the player can play right now (design note
// 2026-09-29-xr-atmosphere-design.md). The engine's own menu says which (logic/atmosphere.js
// playableSlots: a useful CastUnit or CastSpell for that card), so the sparkle never promises a move
// the table would refuse. It is ambient: aster's guide keeps its own ring for the lesson's target.
// Reduced motion: a steady rim, no twinkle. High contrast: a thick frame in the theme's dwell yellow,
// no stars (card-mesh.js).
import { playableSlots } from '../logic/atmosphere.js';
import { THEMES } from '../logic/theme.js';

// `cards`: hand.js's slots ({ mesh }), `hand`: table.hand(), `menu`: table.choices(). Returns the slots.
export function markPlayable(cards, hand, menu, a = {}) {
  const on = playableSlots(hand, menu);
  cards.forEach((c, slot) => {
    const u = c.mesh?.material?.uniforms;
    if (!u?.uPlayable) return;
    u.uPlayable.value = on.has(slot) ? 1 : 0;
    u.uTwinkle.value = a.reducedMotion ? 0 : 1;
    u.uMark.value.setHex(THEMES.contrast.dwell);
  });
  return on;
}
