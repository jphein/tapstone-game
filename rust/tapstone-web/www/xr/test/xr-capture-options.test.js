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

test('the board framing leans in past the altar over the board and looks at its centre; room sits back', async () => {
  const { FRAMES } = await import('../tools/xr_capture/start.mjs');
  const { ALTAR, BOARD } = await import('../src/logic/layout.js');
  const b = FRAMES.board, r = FRAMES.room;
  assert.ok(b.head[2] < ALTAR.z, 'the head leans in past the altar');
  assert.ok(b.head[2] >= BOARD.d / 2 - 0.05, 'but no further than the board\'s near edge');
  assert.ok(b.head[1] > 0.2, 'above the table');
  assert.ok(Math.abs(b.look[2]) < BOARD.d / 2 && Math.abs(b.look[0]) < BOARD.w / 2, 'it looks inside the board');
  const dist = (f) => Math.hypot(f.head[0] - f.look[0], f.head[1] - f.look[1], f.head[2] - f.look[2]);
  assert.ok(dist(b) < 0.45, `the board is close: ${dist(b).toFixed(2)} m`);
  assert.ok(r.head[2] > b.head[2] + 0.5, 'room sits well back from the board framing');
});
