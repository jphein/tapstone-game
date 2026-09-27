// The layout's FoV budget, on the numbers the scene builds with (spec 2026-09-25 §3.1, 0039).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, PAD, PROMPT, LANE_W, essentials, offGaze, cellCenter, padCenter, ALTAR, PLACE, defaultHead, DOORS, doorCenter } from '../src/logic/layout.js';

test('0039: the board stays within the lower-central ~50° (±26° yaw at the default placement)', () => {
  for (const [name, p] of Object.entries(essentials()).filter(([n]) => n.startsWith('board'))) {
    const a = offGaze(p);
    assert.ok(Math.abs(a.yaw) <= 26, `${name} at yaw ${a.yaw.toFixed(1)}`);
  }
});

test('every essential sits within ±32° yaw and ±30° pitch: inside a 70° device, with margin', () => {
  for (const [name, p] of Object.entries(essentials())) {
    const a = offGaze(p);
    assert.ok(Math.abs(a.yaw) <= 32 && Math.abs(a.pitch) <= 30, `${name} at yaw ${a.yaw.toFixed(1)}, pitch ${a.pitch.toFixed(1)}`);
  }
});

test('each pad sits under its own lane, left to right, and the altar is within a seated reach', () => {
  for (let l = 0; l < 3; l++) {
    const laneX = -BOARD.w / 2 + LANE_W * (l + 0.5);
    assert.ok(Math.abs(PAD.x[l] - laneX) < LANE_W / 2, `pad ${l} is under lane ${l}`);
  }
  assert.ok(PAD.x[0] < PAD.x[1] && PAD.x[1] < PAD.x[2]);
  const h = defaultHead();
  for (let l = 0; l < 3; l++) {
    const a = padCenter(l);
    const reach = Math.hypot(a.x - h.x, a.y - h.y, a.z - h.z);
    // The spike's touches worked at ~0.50 m (spec §3.2, after the spike: "within seated reach").
    assert.ok(reach <= 0.51, `pad ${l} is ${reach.toFixed(3)} m from the head`);
  }
  assert.ok(ALTAR.z > BOARD.d / 2, 'the altar is between the player and the board');
  assert.equal(PLACE.ahead, h.z);
});

test("the person's back row is nearest them; the other seat's back row is at the far edge", () => {
  const mine = cellCenter(0, 1, 0, 0), theirs = cellCenter(1, 1, 0, 0);
  assert.ok(mine.z > 0 && theirs.z < 0);
  assert.ok(cellCenter(0, 1, 2, 0).z < mine.z, "my front cell is further than my back cell");
});

test('0039: each door stands outside the play budget (|yaw| > 32°) but in the room (|yaw| < 80°)', () => {
  for (const d of DOORS) {
    const a = offGaze(doorCenter(d));
    assert.ok(Math.abs(a.yaw) > 32 && Math.abs(a.yaw) < 80, `${d.faction} door at yaw ${a.yaw.toFixed(1)}`);
  }
});

test('every touch target is at least 6 cm (spec §3.2, after the spike: sized for a fingertip)', () => {
  assert.ok(PAD.w >= 0.06 && PAD.d >= 0.06, `pads ${PAD.w} x ${PAD.d} m`);
  assert.ok(PROMPT.w / 3 - 0.006 >= 0.06 && PROMPT.h >= 0.06, `prompt tiles ${(PROMPT.w / 3 - 0.006).toFixed(3)} x ${PROMPT.h} m`);
});
