// The world art's type (src/art/type.js, src/art/labels.js): every in-scene label legible from the
// seated head, and fitText shrinking or wrapping a line but never going under the guard's floor.
// Run: node --test test/art-type.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP, MIN_DEG, MIN_PX, capDegrees, fitText, floorPx, illegible } from '../src/art/type.js';
import { LABELS, seen, specOf, minPxOf } from '../src/art/labels.js';

// A monospace stand-in for canvas measureText: each glyph 0.55 em wide.
const mono = (line, px) => line.length * px * 0.55;

test('every label is legible at its largest size and at its floor', () => {
  for (const name of Object.keys(LABELS)) {
    const s = specOf(name);
    assert.equal(illegible(s), null, `${name} at ${s.fontPx} px`);
    assert.ok(s.floor <= LABELS[name].maxPx, `${name}: floor ${s.floor} px over its max ${LABELS[name].maxPx}`);
    assert.equal(illegible({ ...s, fontPx: s.floor }), null, `${name} at its floor ${s.floor} px`);
    assert.equal(LABELS[name].canvas[1] >= s.floor * (LABELS[name].lines ?? 1), true, `${name}: its lines fit the canvas at the floor`);
  }
});

test('a plate keeps its canvas aspect, so its glyphs are not stretched', () => {
  for (const [name, l] of Object.entries(LABELS)) {
    const plate = l.plate[0] / l.plate[1], canvas = l.canvas[0] / l.canvas[1];
    assert.ok(Math.abs(plate / canvas - 1) < 0.08, `${name}: plate ${plate.toFixed(2)} vs canvas ${canvas.toFixed(2)}`);
  }
});

test('one px under the floor is refused, by angle or by canvas px', () => {
  for (const name of Object.keys(LABELS)) {
    const s = specOf(name);
    assert.notEqual(illegible({ ...s, fontPx: s.floor - 1 }), null, name);
  }
});

test('the guard: a plate seen edge-on or from afar is not legible', () => {
  const base = { plateH: 0.03, canvasH: 112, fontPx: 40, dist: 0.5 };
  assert.equal(illegible(base), null);
  assert.match(illegible({ ...base, dist: 3 }), /under 0.45°/);
  assert.match(illegible({ ...base, oblique: 85 }), /under 0.45°/);
  assert.match(illegible({ plateH: 0.03, canvasH: 20, fontPx: 16, dist: 0.05 }), new RegExp(`under ${MIN_PX}$`));
  assert.ok(Math.abs(capDegrees({ plateH: 1, canvasH: 1, fontPx: 1 / CAP, dist: 1 }) - 2 * Math.atan(0.5) * 180 / Math.PI) < 1e-9);
  assert.ok(floorPx(base) >= Math.ceil(MIN_PX / CAP));
});

test('seen: the voice strip faces the head, a door plaque is ~2 m off', () => {
  assert.ok(seen(LABELS.voice).oblique < 25, `${seen(LABELS.voice).oblique}`);
  assert.ok(seen(LABELS.doorName).dist > 1.8 && seen(LABELS.doorName).dist < 2.3);
  assert.ok(MIN_DEG > 0.3);
});

test('fitText: the largest size that fits, one line', () => {
  const r = fitText(mono, 'Pass', { maxW: 200, maxPx: 40, minPx: 20 });
  assert.deepEqual(r, { px: 40, lines: ['Pass'], fits: true });
  const s = fitText(mono, 'Touch your castle', { maxW: 200, maxPx: 40, minPx: 16 });
  assert.equal(s.lines.length, 1);
  assert.ok(mono(s.lines[0], s.px) <= 200 && mono(s.lines[0], s.px + 1) > 200);
});

test('fitText: a long line wraps at the floor instead of shrinking under it', () => {
  const text = 'Draw 1: touch the top card of your deck to the stone.';
  const r = fitText(mono, text, { maxW: 500, maxPx: 46, minPx: 30, maxLines: 2 });
  assert.equal(r.fits, true);
  assert.equal(r.lines.length, 2);
  assert.ok(r.px >= 30);
  for (const l of r.lines) assert.ok(mono(l, r.px) <= 500, l);
  assert.equal(r.lines.join(' '), text);
});

test('fitText: past two lines it says it does not fit, and stays at the floor', () => {
  const r = fitText(mono, 'a '.repeat(80).trim(), { maxW: 100, maxPx: 40, minPx: 30, maxLines: 2 });
  assert.equal(r.fits, false);
  assert.equal(r.px, 30);
  assert.equal(r.lines.length, 2);
});

test('the painters floor: minPxOf is the guard floor', () => {
  assert.equal(minPxOf('voice'), specOf('voice').floor);
});
