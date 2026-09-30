// Where the fan sits (JP: "you need to be able to place your hand wherever is best for you").
// Run: node --test test/hand-place.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAND_HOME, HAND_KEY, REACH, clampSpot, loadSpot, saveSpot } from '../src/logic/hand-place.js';
import { HAND } from '../src/logic/layout.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('home is where the fan always sat (layout HAND)', () => {
  assert.deepEqual(HAND_HOME, { x: 0, y: HAND.y, z: HAND.z });
  assert.deepEqual(loadSpot(memoryStorage(), false), HAND_HOME);
});

test('a spot is kept where it was let go, within reach, and clamped past it', () => {
  assert.deepEqual(clampSpot({ x: 0.3, y: 0.1, z: 0.6 }), { x: 0.3, y: 0.1, z: 0.6 });
  assert.deepEqual(clampSpot({ x: 2, y: -1, z: -3 }), { x: REACH.x[1], y: REACH.y[0], z: REACH.z[0] }, 'not out over the board or under the table');
  assert.deepEqual(clampSpot({ x: NaN, y: undefined }), HAND_HOME, 'garbage is home');
});

test('stored per page and per hand: the left-handed layout keeps its own spot', () => {
  const s = memoryStorage();
  saveSpot(s, false, { x: 0.25, y: 0.12, z: 0.55 });
  saveSpot(s, true, { x: -0.3, y: 0.2, z: 0.5 });
  assert.deepEqual(loadSpot(s, false), { x: 0.25, y: 0.12, z: 0.55 });
  assert.deepEqual(loadSpot(s, true), { x: -0.3, y: 0.2, z: 0.5 });
  s.setItem(HAND_KEY, '{broken');
  assert.deepEqual(loadSpot(s, false), HAND_HOME, 'an unreadable store is home, never an error');
  const tampered = memoryStorage();
  tampered.setItem(HAND_KEY, JSON.stringify({ right: { x: 9, y: 9, z: 9 } }));
  assert.deepEqual(loadSpot(tampered, false), clampSpot({ x: 9, y: 9, z: 9 }), 'a stored spot is clamped on the way in too');
});
