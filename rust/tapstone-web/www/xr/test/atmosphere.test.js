// The Tea House's atmosphere (src/logic/atmosphere.js): particle plans per room and setting, the
// flicker, the playable cards from the engine's menu, the chimes and the bed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBIENCE_DEFAULT, AMBIENCE_LEVELS, CHIME_SCALE, FULL, airPlan, ambienceName, bedFor, flicker, nextAmbience, nextChime, playableSlots, total } from '../src/logic/atmosphere.js';

test('full VR has the room and the doors; mixed reality only the doors', () => {
  const vr = airPlan('vr'), mr = airPlan('mr');
  assert.equal(total(vr.counts), total(FULL.room) + total(FULL.door));
  assert.equal(total(mr.counts), total(FULL.door) + total(FULL.table));
  assert.equal(mr.counts.dust, undefined, 'mixed reality: no room dust');
  assert.equal(vr.counts.motes, undefined, 'full VR: the room\'s dust, not the table motes');
  assert.ok(total(vr.counts) <= 360, `a particle budget: ${total(vr.counts)}`);
});

test('reduced motion: half the particles (rounded up), slower, no flicker, no twinkle', () => {
  const calm = airPlan('vr', { reducedMotion: true }), full = airPlan('vr');
  for (const [k, n] of Object.entries(full.counts)) assert.equal(calm.counts[k], Math.ceil(n / 2), k);
  assert.ok(calm.speed < full.speed);
  assert.equal(calm.flicker, 0);
  assert.equal(calm.twinkle, false);
  assert.equal(flicker(3.3, 1, calm.flicker), 1);
});

test('high contrast dims the air and never brightens it', () => {
  assert.ok(airPlan('vr', { highContrast: true }).dim < 1);
  assert.equal(airPlan('vr').dim, 1);
});

test('the flicker stays within 0.88..1.08 and moves', () => {
  let lo = 2, hi = 0;
  for (let t = 0; t < 60; t += 0.01) {
    const f = flicker(t, 2);
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  assert.ok(lo >= 0.88 && hi <= 1.08, `${lo}..${hi}`);
  assert.ok(hi - lo > 0.08, 'it visibly flickers');
});

test('playable: the hand slots whose card the menu can cast now, useful only', () => {
  const hand = [{ card: 2 }, { card: 5 }, { card: 2 }, { card: 9 }];
  const menu = [
    { kind: 'CastUnit', card: 2, useful: true },
    { kind: 'Charge', card: 5, useful: true },
    { kind: 'CastSpell', card: 9, useful: false },
    { kind: 'Draw', card: 0, useful: true },
  ];
  assert.deepEqual([...playableSlots(hand, menu)], [0, 2]);
  assert.deepEqual([...playableSlots(hand, [])], []);
  assert.deepEqual([...playableSlots(null, null)], []);
});

test('chimes: 2 to 5 strikes from the scale, rising in time, 6 to 14 s apart', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 50; k++) {
    const c = nextChime(rand);
    assert.ok(c.notes.length >= 2 && c.notes.length <= 5);
    assert.ok(c.wait >= 6 && c.wait <= 14);
    c.notes.forEach((n, i) => {
      assert.ok(CHIME_SCALE.includes(n.f));
      if (i) assert.ok(n.at > c.notes[i - 1].at);
    });
  }
});

test('the bed: mixed reality sounds only the doors; the volume cycles off, low, medium, high', () => {
  assert.deepEqual(bedFor('mr').map((v) => v.where), ['tide', 'ember', 'neutral', 'grounds']);
  assert.equal(bedFor('vr').length, 7);
  assert.equal(ambienceName(AMBIENCE_DEFAULT), 'medium');
  assert.equal(nextAmbience(1), 0);
  assert.deepEqual(AMBIENCE_LEVELS.map(ambienceName), ['off', 'low', 'medium', 'high']);
});

import { LANTERN_AT, MOOD, TABLE_KEY, hueDrift, lightAt } from '../src/logic/atmosphere.js';

test('the mood: the table is the brightest pool, with dimness between the lanterns', () => {
  const table = lightAt([0, -0.015, 0.1]); // the board's middle, on the table top
  const underLantern = lightAt([LANTERN_AT[0][0], -0.4, LANTERN_AT[0][2]]); // the floor under a lantern
  const between = lightAt([-2.6, -0.4, 0.1]); // the floor between the left lanterns and the wall
  const corner = lightAt([2.8, -0.4, 2.8]); // a far floor corner
  const wallBetween = lightAt([0, 0.8, -2.95], [0, 0, 1]); // the far wall between the pools
  assert.ok(table > underLantern, `table ${table.toFixed(2)} vs a lantern's pool ${underLantern.toFixed(2)}`);
  // The tuned mood measures 1.68 (the floor 1.4 m under a lantern is its pool's weakest edge); the
  // guard is that a brighter fill or wider lanterns can't flatten the room back into daylight.
  assert.ok(underLantern > 1.6 * between, `pool ${underLantern.toFixed(2)} vs between ${between.toFixed(2)}`);
  assert.ok(between > corner, 'the dimness deepens toward the corners');
  assert.ok(table > 1.7 * wallBetween, `table ${table.toFixed(2)} vs the wall between ${wallBetween.toFixed(2)}`);
  assert.ok(corner < 0.25, `a corner stays dim: ${corner.toFixed(2)}`);
  assert.ok(TABLE_KEY[1] > 0.5, 'the key hangs over the table');
  // The key is a spot on the table: the floor a step off the table's edge gets little of it.
  const offTable = lightAt([0.9, -0.4, 0.1]);
  assert.ok(table > 2 * offTable, `table ${table.toFixed(2)} vs the floor off its edge ${offTable.toFixed(2)}`);
  // The lanterns are capped: the ceiling over them is dimmer than the floor pool under them.
  assert.ok(lightAt([LANTERN_AT[0][0], 1.99, LANTERN_AT[0][2]], [0, -1, 0]) < underLantern, 'the ceiling stays dim');
});

test('the dimness is blue-violet, the dusk outside cooler than the lanterns', () => {
  const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const [ar, , ab] = rgb(MOOD.ambient), [fr, , fb] = rgb(MOOD.fog.color), [dr, , db] = rgb(MOOD.duskHigh);
  const [lr, , lb] = rgb(MOOD.lanterns.color);
  assert.ok(ab > ar && fb > fr && db > dr, 'ambient, fog and dusk lean blue');
  assert.ok(lr > lb, 'the lanterns lean warm');
  assert.ok(MOOD.fog.near >= 1.3, 'the fog starts past the board and the doors\' nearest edge');
});

test('the hue drift stays within 3% and stops when calm', () => {
  for (let t = 0; t < 140; t += 0.5) for (const c of hueDrift(t)) assert.ok(Math.abs(c - 1) <= 0.03 + 1e-9);
  assert.deepEqual(hueDrift(17, true), [1, 1, 1]);
  assert.notDeepEqual(hueDrift(17), [1, 1, 1]);
});
