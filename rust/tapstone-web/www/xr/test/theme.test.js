// The high-contrast theme (src/logic/theme.js): both themes cover every role, the standard theme is
// the look as built, and the contrast theme meets WCAG's ratios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PAIRS, ROLES, THEMES, contrast, css, luminance, themeFor } from '../src/logic/theme.js';

const here = dirname(fileURLToPath(import.meta.url));
const XR = join(here, '..');

test('both themes give every role a colour, and nothing else', () => {
  for (const [name, t] of Object.entries(THEMES)) assert.deepEqual(Object.keys(t).sort(), ROLES.slice().sort(), name);
});

test('the contrast ratio is WCAG\'s: black on white is 21, a colour on itself 1', () => {
  assert.ok(Math.abs(contrast(0x000000, 0xffffff) - 21) < 1e-9);
  assert.equal(contrast(0x777777, 0x777777), 1);
  assert.ok(Math.abs(luminance(0xffffff) - 1) < 1e-9);
  assert.ok(Math.abs(contrast(0x767676, 0xffffff) - 4.54) < 0.01, 'the classic AA grey');
});

test('high contrast: text at 7:1 (AAA), every surface against what it sits on at 3:1', () => {
  const t = THEMES.contrast;
  for (const [a, b, min] of PAIRS) {
    const r = contrast(t[a], t[b]);
    assert.ok(r >= min, `${a} on ${b}: ${r.toFixed(2)} < ${min}`);
  }
});

// Except two that trade ratio for meaning: a refusal's text (yellow, 14:1, not white, 21:1) and the
// focused pad (blue on the yellow pad, 3.9:1: still past 3:1, and the dwell ring marks focus too).
test('high contrast is higher contrast than standard for every pair', () => {
  for (const [a, b] of PAIRS.filter(([a]) => a !== 'label.refuse' && a !== 'pad.focus')) {
    assert.ok(contrast(THEMES.contrast[a], THEMES.contrast[b]) >= contrast(THEMES.standard[a], THEMES.standard[b]) - 1e-9, `${a} on ${b}`);
  }
});

test('standard is the look as built: the world art\'s colours, as the art paints them', () => {
  // Each role's standard colour is the art's (src/art/palette.js ART, whose use in the painting file
  // test/art-contrast.test.js checks), and the factions are board.js's FACTION.
  const s = THEMES.standard;
  const src = (f) => readFileSync(join(XR, 'src', f), 'utf8');
  const art = src('art/palette.js');
  const hex = (n) => `0x${n.toString(16).padStart(6, '0')}`;
  for (const role of ['altar.stone', 'pad', 'deck', 'card.edge', 'board.base', 'label.bg', 'label.fg', 'card.face', 'card.ink']) {
    assert.match(art, new RegExp(hex(s[role])), `${role}: ${hex(s[role])} is not one of the art's colours`);
  }
  assert.match(src('board.js'), new RegExp(`ember: 0x${s['faction.ember'].toString(16)}`));
  assert.match(src('board.js'), new RegExp(`tide: 0x${s['faction.tide'].toString(16)}`));
  assert.equal(css(s['card.face']), '#f7eed8');
});

test('the setting picks the theme', () => {
  assert.equal(themeFor({ highContrast: true }), 'contrast');
  assert.equal(themeFor({ highContrast: false }), 'standard');
  assert.equal(themeFor(undefined), 'standard');
});
