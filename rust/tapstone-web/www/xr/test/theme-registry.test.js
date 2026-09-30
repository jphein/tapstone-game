// The theme hook (src/theme.js): a themed material keeps the colour the art gave it until high
// contrast is switched on, takes its role's contrast colour then, and gets its own back after; a
// colour the scene sets again per view (a unit's faction) is repainted over in high contrast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setAccess } from '../src/access.js';
import { themed, repaint, themeName, onTheme } from '../src/theme.js';
import { THEMES } from '../src/logic/theme.js';

const colour = (hex) => ({ hex, setHex(h) { this.hex = h; }, getHex() { return this.hex; } });
const material = (hex) => ({ color: colour(hex) });

test('themed keeps the art\'s colour, high contrast swaps in the role\'s, and back again', () => {
  setAccess('highContrast', false);
  const pad = themed(material(0x123456), 'pad');
  assert.equal(pad.color.hex, 0x123456, 'standard is whatever the art painted');
  let heard = null;
  onTheme((_, name) => (heard = name));
  setAccess('highContrast', true);
  assert.equal(themeName(), 'contrast');
  assert.equal(heard, 'contrast');
  assert.equal(pad.color.hex, THEMES.contrast.pad);
  setAccess('highContrast', false);
  assert.equal(pad.color.hex, 0x123456);
});

test('a colour the scene sets again is its new standard, and high contrast repaints over it', () => {
  setAccess('highContrast', false);
  const unit = themed(material(0xe0663a), 'faction.ember');
  unit.color.setHex(0x3a9be0); // the next view: a Tide unit in this pooled slot
  themed(unit, 'faction.tide');
  repaint(unit);
  assert.equal(unit.color.hex, 0x3a9be0);
  setAccess('highContrast', true);
  assert.equal(unit.color.hex, THEMES.contrast['faction.tide']);
  unit.color.setHex(0xe0663a); // a view in high contrast sets the faction colour...
  themed(unit, 'faction.ember');
  repaint(unit); // ...and the repaint puts the contrast colour back
  assert.equal(unit.color.hex, THEMES.contrast['faction.ember']);
  setAccess('highContrast', false);
  assert.equal(unit.color.hex, 0xe0663a, 'the standard is the colour the scene set last, even in high contrast');
});

test('an unknown role, or a material with no such colour, is left alone', () => {
  const m = material(0x111111);
  assert.equal(themed(m, 'no.such.role').color.hex, 0x111111);
  assert.equal(themed({}, 'pad').color, undefined);
});
