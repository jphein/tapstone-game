// One carry, one pad action (quill's #188 finding; root cause in tools/iwer-press-log.mjs's trace):
// a pinch that picks up a card both grabs it (the touch path) and presses it (the eyes-and-hands lift),
// and the carrying hand's own fingertip presses the pads it crosses and the pad it lands on, and again
// as it leaves. Each of those became a second action: a replay of the spent lift, or a bare "advance".
// Run: node --test test/carry.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CarryGate, LAND, SETTLE_MS, liftSpent, nearestHand, onPad } from '../src/logic/carry.js';

test('a pad press by the hand carrying a card is the carry, not a second action', () => {
  const g = new CarryGate();
  g.grab('deck', 'right', 1000);
  assert.equal(g.pad(1200, 'right', { source: 'deck' }), 'carry', 'even with a lift pending');
  assert.equal(g.pad(1300, 'right', null), 'carry', 'not an advance');
});

test('the other hand is free: hold a card in one hand, press a pad with the other', () => {
  const g = new CarryGate();
  g.grab('hand:2', 'left', 1000);
  assert.equal(g.pad(1500, 'right', { source: 'hand', slot: 2 }), 'lifted', 'the held card goes to that pad');
  assert.equal(g.pad(1600, 'right', null), 'advance');
});

test('the hand that let go is settling for SETTLE_MS; after that its press counts', () => {
  const g = new CarryGate();
  g.grab('deck', 'right', 1000);
  g.release('deck', 2000);
  // Measured in IWER: the leaving fingertip pressed the pad 258-284 ms after the release.
  for (const dt of [0, 258, 284, SETTLE_MS - 1]) assert.equal(g.pad(2000 + dt, 'right', null), 'settle', `+${dt} ms`);
  assert.equal(g.pad(2000 + SETTLE_MS, 'right', null), 'advance', 'a deliberate poke after the window');
  assert.equal(g.pad(2100, 'left', null), 'advance', 'the other hand is not settling');
});

test('a press whose hand is unknown is swallowed while any carry is live or settling, and not otherwise', () => {
  const g = new CarryGate();
  assert.equal(g.pad(0, null, null), 'advance');
  g.grab('castle', 'left', 100);
  assert.equal(g.pad(200, null, null), 'carry');
  g.release('castle', 300);
  assert.equal(g.pad(400, null, null), 'settle');
  assert.equal(g.pad(300 + SETTLE_MS, null, null), 'advance');
});

test('a carry whose hand was unknown settles every hand when it ends', () => {
  const g = new CarryGate();
  g.grab('deck', null, 1000);
  g.release('deck', 1400);
  assert.equal(g.pad(1400 + SETTLE_MS - 1, 'right', null), 'settle', 'it may have been this hand leaving');
  assert.equal(g.pad(1400 + SETTLE_MS - 1, 'left', null), 'settle');
  assert.equal(g.pad(1400 + SETTLE_MS, 'right', null), 'advance', 'and only for SETTLE_MS');
});

test('a deliberate second tap is never swallowed: two pokes, and the castle twice', () => {
  const g = new CarryGate();
  // Two bare pokes on a pad (advance a lane twice): no carry, so both count.
  assert.equal(g.pad(1000, 'right', null), 'advance');
  assert.equal(g.pad(1250, 'right', null), 'advance');
  // The castle's double-tap (a mulligan): two pinches, two grabs. Each grab's first castle tap counts.
  g.grab('castle', 'left', 2000);
  assert.equal(g.castleTap(2000), true, 'the first pinch taps');
  assert.equal(g.castleTap(2400), false, 'the same carry touching a pad does not tap again');
  g.release('castle', 2600);
  g.grab('castle', 'left', 3200);
  assert.equal(g.castleTap(3210), true, 'the second pinch, inside the 3 s window, taps');
});

test('a castle tap that arrives a frame before its grab is still that grab\'s tap', () => {
  const g = new CarryGate();
  assert.equal(g.castleTap(1000), true, 'the Pressed lands first');
  g.grab('castle', 'left', 1016);
  assert.equal(g.castleTap(1400), false, 'the touch path, same carry');
});

test('the touch path spends the lift made by the same pinch, and only that one', () => {
  assert.equal(liftSpent({ source: 'deck' }, 'deck'), true);
  assert.equal(liftSpent({ source: 'hand', slot: 1 }, 'hand', 1), true);
  assert.equal(liftSpent({ source: 'hand', slot: 1 }, 'hand', 2), false, 'another card stays lifted');
  assert.equal(liftSpent({ source: 'deck' }, 'hand', 0), false);
  assert.equal(liftSpent(null, 'deck'), false);
});

test('the pressing hand is the one whose fingertip is nearest, within reach', () => {
  assert.equal(nearestHand([{ hand: 'left', d: 0.27 }, { hand: 'right', d: 0.025 }]), 'right');
  assert.equal(nearestHand([{ hand: 'left', d: 0.07 }, { hand: 'right', d: 0.3 }]), 'left');
  assert.equal(nearestHand([]), null, 'no hands tracked');
  assert.equal(nearestHand([{ hand: 'left', d: 0.9 }, { hand: 'right', d: 0.8 }]), null, 'both far: a ray from somewhere, unknown');
});

test('on a pad: the card alone within 30 mm, or with the fingertip landing, within 60 mm', () => {
  for (const up of [0, 24, 27]) assert.equal(onPad({ flat: 0, up: up / 1000 }), true, `touch at ${up} mm`);
  for (const up of [31, 32, 33]) {
    assert.equal(onPad({ flat: 0, up: up / 1000 }), false, `no touch at ${up} mm (the IWER misses)`);
    assert.equal(onPad({ flat: 0, up: up / 1000 }, LAND), true, `a landing at ${up} mm places it`);
  }
  assert.equal(onPad({ flat: 0, up: 0.09 }, LAND), false, 'a hand passing 9 cm over a pad is not a landing');
  assert.equal(onPad({ flat: 0.05, up: 0.02 }, LAND), false, 'the card beside the pad');
  assert.equal(onPad({ flat: 0.016, up: 0.001 }), true, 'a card laid on the pad off-centre');
});
