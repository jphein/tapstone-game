// The world art's merge and bake (src/art/geo.js): parts become one geometry (one draw call), and
// baked lantern light falls off with distance and faces. Run: node --test test/art-geo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, PlaneGeometry } from 'three';
import { bake, hash, merge, mix, shade } from '../src/art/geo.js';

test('merge: every part in one geometry, placed and coloured', () => {
  const g = merge([
    { geo: new BoxGeometry(1, 1, 1), color: 0xff0000 },
    { geo: new BoxGeometry(1, 1, 1), color: 0x00ff00, at: [10, 0, 0] },
  ]);
  const pos = g.getAttribute('position'), col = g.getAttribute('color');
  assert.equal(pos.count, 72); // two boxes, 36 non-indexed vertices each
  assert.equal(g.getAttribute('normal').count, 72);
  assert.ok(g.getAttribute('uv'));
  let maxX = -Infinity;
  for (let i = 36; i < 72; i++) maxX = Math.max(maxX, pos.getX(i));
  assert.equal(maxX, 10.5);
  assert.deepEqual([col.getX(0), col.getY(0), col.getX(40), col.getY(40)], [1, 0, 0, 1]);
});

test('merge: a colour function sees each vertex where it lands', () => {
  const g = merge([{ geo: new PlaneGeometry(2, 2), at: [0, 5, 0], color: (x, y) => (y > 3.5 ? 0xffffff : 0x000000) }]);
  const col = g.getAttribute('color');
  for (let i = 0; i < col.count; i++) assert.equal(col.getX(i), 1);
});

test('bake: nearer and facing is brighter; unlit is the ambient', () => {
  const g = merge([
    { geo: new PlaneGeometry(0.1, 0.1), rot: [-Math.PI / 2, 0, 0], at: [0, 0, 0], color: 0xffffff },
    { geo: new PlaneGeometry(0.1, 0.1), rot: [-Math.PI / 2, 0, 0], at: [3, 0, 0], color: 0xffffff },
    { geo: new PlaneGeometry(0.1, 0.1), rot: [Math.PI / 2, 0, 0], at: [0, 0, 0.5], color: 0xffffff }, // facing down, away
  ]);
  bake(g, { lights: [{ at: [0, 1, 0], color: 0xffffff, intensity: 1, falloff: 1 }], ambient: 0x000000, wrap: 0 });
  const col = g.getAttribute('color');
  const near = col.getX(0), far = col.getX(6), away = col.getX(12);
  assert.ok(near > far * 3, `${near} vs ${far}`);
  assert.equal(away, 0);
  assert.ok(near <= 0.5 + 1e-6); // 1 / (1 + 1^2) at 1 m with falloff 1
});

test('bake: occlusion darkens, emissive adds', () => {
  const mk = () => merge([{ geo: new PlaneGeometry(1, 1), rot: [-Math.PI / 2, 0, 0], color: 0x808080 }]);
  const a = bake(mk(), { ambient: 0xffffff }).getAttribute('color').getX(0);
  const b = bake(mk(), { ambient: 0xffffff, occlude: () => 0.5 }).getAttribute('color').getX(0);
  const c = bake(mk(), { ambient: 0x000000, emissive: () => 1 }).getAttribute('color').getX(0);
  assert.ok(Math.abs(b - a / 2) < 1e-6);
  assert.ok(Math.abs(c - a) < 1e-6);
});

test('hash, shade and mix', () => {
  assert.equal(hash(1, 2, 3), hash(1, 2, 3));
  assert.ok(hash(1) >= 0 && hash(1) < 1);
  assert.equal(shade(0xffffff, 2), 0xffffff); // clamped (three mixes in linear light)
  assert.ok(shade(0x808080, 2) > 0x808080 && shade(0x808080, 0.5) < 0x808080);
  assert.equal(mix(0x000000, 0xffffff, 1), 0xffffff);
});
