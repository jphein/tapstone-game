// The ghost hand's demonstrations (guide v2): each move shown the way the table reads it.
// Run: node --test test/guide-demo.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOP_MS, PHASES, TOUCH_Y, pathPoints, phaseAt, poseAt } from '../src/guide/demo.js';

const DECK = { x: 0.18, y: 0.021, z: 0.4 }, PAD1 = { x: 0, y: 0.025, z: 0.4 }, CARD = { x: -0.05, y: 0.18, z: 0.5 };
const start = (name) => PHASES.slice(0, PHASES.findIndex(([n]) => n === name)).reduce((a, [, ms]) => a + ms, 0);
const sample = (move, from, to) => Array.from({ length: Math.ceil(LOOP_MS / 20) }, (_, i) => ({ t: i * 20, ...poseAt(move, from, to, i * 20) }));

test('the phases loop, in order', () => {
  assert.equal(phaseAt(0).name, 'reach');
  assert.equal(phaseAt(start('carry') + 1).name, 'carry');
  assert.equal(phaseAt(LOOP_MS + 1).name, 'reach', 'it loops');
});

test('a charge turns the card face down before it touches the stone, and is face down at the touch', () => {
  const s = sample('charge', CARD, PAD1);
  const touch = s.filter((p) => p.phase === 'touch');
  assert.ok(touch.length > 0);
  for (const p of touch) assert.equal(p.roll, 180, `palm over at ${p.t} ms`), assert.ok(p.faceDown);
  const carryEnd = s.filter((p) => p.phase === 'carry').at(-1);
  assert.equal(carryEnd.roll, 180, 'turned over by the end of the carry');
});

test('a cast and a draw stay face up the whole way', () => {
  for (const move of ['cast', 'draw', 'pass', 'claim']) for (const p of sample(move, CARD, PAD1)) assert.equal(p.faceDown, false, `${move} at ${p.t}`);
});

test('the card is in the fingers only between the pinch and the release, with the pinch closed', () => {
  const s = sample('draw', DECK, PAD1);
  for (const p of s) {
    if (['reach', 'down', 'rise', 'rest'].includes(p.phase)) assert.equal(p.carrying, false, `${p.phase} at ${p.t}`);
    if (['lift', 'carry', 'touch'].includes(p.phase)) assert.ok(p.carrying && p.pinch === 1, `${p.phase} at ${p.t}`);
  }
});

test('it starts at the source and touches down on the target', () => {
  const at = poseAt('draw', DECK, PAD1, start('pinch') + 1).pos;
  assert.ok(Math.hypot(at.x - DECK.x, at.z - DECK.z) < 1e-9 && at.y - DECK.y < 0.01, 'the pinch is at the deck');
  const land = poseAt('draw', DECK, PAD1, start('release') + 1).pos;
  assert.ok(Math.hypot(land.x - PAD1.x, land.z - PAD1.z) < 1e-9, 'over the pad');
  assert.ok(Math.abs(land.y - (PAD1.y + TOUCH_Y)) < 1e-9, 'just above the stone');
  // The carry stays above the altar's top (HOVER), bows out to the side the hand works from (the
  // default: the right), and never climbs toward the eyes (it used to arc 8 cm up: the lead's review).
  const carry = sample('draw', DECK, PAD1).filter((p) => p.phase === 'carry');
  assert.ok(Math.min(...carry.map((p) => p.pos.y)) >= Math.min(DECK.y, PAD1.y) + 0.02, 'above the stone, not through it');
  assert.ok(Math.max(...carry.map((p) => p.pos.y)) <= Math.max(DECK.y, PAD1.y) + 0.06, 'and not up toward the eyes');
  const mid = carry[Math.floor(carry.length / 2)].pos;
  assert.ok(mid.x > (DECK.x + PAD1.x) / 2 + 0.05, 'bowed out to the right');
  assert.equal(poseAt('draw', DECK, PAD1, start('rest') + 1).show, false, 'hidden while resting');
});

test('the path runs from above the source to above the target, bowed out as the carry is', () => {
  const lat = { x: -1, y: 0, z: 0 }; // a left hand's side
  const p = pathPoints(DECK, PAD1, 12, lat);
  assert.equal(p.length, 12);
  assert.ok(Math.abs(p[0].x - DECK.x) < 1e-9 && Math.abs(p.at(-1).x - PAD1.x) < 1e-9);
  assert.ok(p[6].x < (DECK.x + PAD1.x) / 2 - 0.05, 'bowed to the left');
  const carry = Array.from({ length: 45 }, (_, i) => poseAt('draw', DECK, PAD1, start('carry') + i * 20, { lat }).pos);
  assert.ok(Math.abs(carry[22].x - p[6].x) < 0.02, 'the dots trace the carry');
});
