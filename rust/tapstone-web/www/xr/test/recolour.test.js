// The bake's recolours (tools/recolour.mjs): each faction's people change their cloth, never their skin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOLOUR, hsl, rgbOf, isSkin } from '../tools/recolour.mjs';

const close = (a, b, e = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < e);
// Linear-light samples of the outfits' own palettes (taken from the baked models).
const SKIN = [[0.55, 0.3, 0.2], [0.35, 0.18, 0.1], [0.72, 0.48, 0.36]];
const GREEN_CLOTH = [0.12, 0.28, 0.08];
const BROWN_LEATHER = [0.25, 0.12, 0.05];
const STEEL = [0.5, 0.5, 0.52];

test('hsl and back is the identity', () => {
  for (const c of [...SKIN, GREEN_CLOTH, BROWN_LEATHER, STEEL, [0.9, 0.1, 0.4]]) assert.ok(close(rgbOf(hsl(c)), c, 1e-9), String(c));
});

test('skin keeps its colour in both factions', () => {
  for (const c of SKIN) {
    assert.ok(isSkin(hsl(c)), `${c} reads as skin`);
    for (const f of ['deeps', 'forge-people']) assert.ok(close(RECOLOUR[f](c), c), `${f} keeps ${c}`);
  }
});

test('the Deep Tides dress in blue and pearl; the Forge Peaks in ember and soot', () => {
  const [hd] = hsl(RECOLOUR.deeps(GREEN_CLOTH));
  assert.ok(hd > 180 && hd < 230, `deeps cloth hue ${hd.toFixed(0)}`);
  const [hs, ss, ls] = hsl(RECOLOUR.deeps(STEEL));
  assert.ok(ls >= hsl(STEEL)[2] && ss < 0.3, 'deeps metal goes pearl: lighter, soft');
  const [hf] = hsl(RECOLOUR['forge-people'](GREEN_CLOTH));
  assert.ok(hf < 20 || hf > 340, `forge cloth hue ${hf.toFixed(0)} is ember red`);
  const [, , lf] = hsl(RECOLOUR['forge-people'](STEEL));
  assert.ok(lf < hsl(STEEL)[2], 'forge metal goes dark iron');
});

test('the Slag Brute goes basalt, its bright parts ember', () => {
  const [, s, l] = hsl(RECOLOUR.slag([0.4, 0.25, 0.18]));
  assert.ok(l < 0.15 && s < 0.2, 'dark, grey-warm rock');
  const [h2, , l2] = hsl(RECOLOUR.slag([0.9, 0.4, 0.6]));
  assert.ok(l2 >= 0.45 && h2 < 40, 'the pink nose and bright eyes glow ember');
});
