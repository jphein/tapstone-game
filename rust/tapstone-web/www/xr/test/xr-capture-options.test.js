// xr_capture's capture options, as pure functions: the stored settings a take starts with
// (install.mjs accessFor) and the head orientation a --pan turns to (page.js panOrientation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessFor } from '../tools/xr_capture/install.mjs';
import { installHands } from '../tools/xr_capture/page.js';

test('a returning player has answered the first-run offer; a first run has not', () => {
  assert.deepEqual(accessFor({}), { highContrast: false });
  assert.deepEqual(accessFor({ returning: true }), { highContrast: false, offered: true });
  assert.deepEqual(accessFor({ contrast: true, returning: true }), { highContrast: true, offered: true });
  assert.equal('offered' in accessFor({ returning: false }), false, 'a first run stores nothing about the offer');
});

test('a pan turns the yaw to the right and keeps the pitch', () => {
  delete globalThis.__xrHands;
  installHands();
  const H = globalThis.__xrHands;
  const ahead = { x: 0, y: 0, z: -1 };
  assert.deepEqual(H.panOrientation(ahead, 0), { pitch: 0, yaw: 0, roll: 0 });
  assert.equal(H.panOrientation(ahead, 30).yaw, -30); // IWER's yaw grows to the left
  const down = { x: 0, y: -Math.sin(Math.PI / 6), z: -Math.cos(Math.PI / 6) }; // 30° below ahead
  const o = H.panOrientation(down, 45);
  assert.equal(o.pitch, -30);
  assert.equal(o.yaw, -45);
  // looking along +x (the right) is yaw -90; a further 90° right faces behind (-180)
  assert.equal(H.panOrientation({ x: 1, y: 0, z: 0 }, 90).yaw, -180);
});
