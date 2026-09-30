// Where the ghost hand demonstrates (the lead's review of #198's stills: in hands mode it filled the
// lower-left quarter of the view, its forearm running back toward the eyes). The rule: the demo works
// where the move happens, from the reaching hand's side, at life size, and never covers what it
// teaches. Checked for every demo, from the heads a player uses, right- and left-handed, at every
// 20 ms of the loop. The control: the old staging (the arm toward the head) must fail the same checks.
// Run: node --test test/guide-staging.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAND, LOOP_MS, breaches, poseAt, stage } from '../src/guide/demo.js';
import { ALTAR, HAND as FAN, PAD, defaultHead } from '../src/logic/layout.js';

const DECK = { x: ALTAR.w / 2 + 0.03, y: 0.021, z: ALTAR.z };
const CASTLE = { x: -DECK.x, y: 0.002, z: ALTAR.z };
const pad = (lane) => ({ x: PAD.x[lane], y: ALTAR.h, z: ALTAR.z });
// The fan's cards (hand.js fan(): five cards, spread about the fan's centre), and the caption above it
// (play.js captionAt()).
const card = (k, n = 5, o = { x: 0, y: FAN.y, z: FAN.z }) => {
  const t = k / (n - 1) - 0.5;
  return { x: o.x + t * 2 * FAN.spread, y: o.y - Math.abs(t) * 0.02, z: o.z };
};
const captionAt = (o = { x: 0, y: FAN.y, z: FAN.z }) => ({ x: o.x, y: o.y + 0.1, z: Math.min(o.z, ALTAR.z + 0.08) });

// Board-local heads: standing (the default placement), seated (lower, nearer), leaning in (xr_capture's
// framing: 0.27 m over the middle pad, 0.28 m back), and each 12 cm to either side.
const d = defaultHead();
const LEAN = { x: 0, y: ALTAR.h + 0.27, z: ALTAR.z + 0.28 };
// Seated mode re-places the board from the head (logic/access.js), so a seated head is the standing
// one; 'slumped' sits lower and nearer than the placement allows for, as a stress case.
const HEADS = [
  ['standing', d], ['slumped', { x: 0, y: 0.36, z: 0.66 }], ['leaning', LEAN],
  ['standing-left', { ...d, x: -0.12 }], ['standing-right', { ...d, x: 0.12 }], ['leaning-left', { ...LEAN, x: -0.12 }], ['leaning-right', { ...LEAN, x: 0.12 }],
];
const DEMOS = [
  ['draw', 'draw', DECK, pad(1)],
  ['charge from the left card', 'charge', card(0), pad(0)],
  ['charge from the middle card', 'charge', card(2), pad(0)],
  ['cast from the right card', 'cast', card(4), pad(2)],
  ['cast from the left card to the right lane', 'cast', card(0), pad(2)],
  ['claim', 'claim', CASTLE, pad(1)],
  ['pass', 'pass', CASTLE, pad(1)],
];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
// Every breach for one demo from one head: demo.js breaches(), the same rule stage() stages by.
const breachesFor = (move, from, to, head, side, lat) => breaches(move, from, to, head, lat ?? stage(head, from, to, side, { move, caption: captionAt() }), { caption: captionAt() });

test('the hand model is life size: an adult palm and fingers, no forearm reaching for the eyes', () => {
  assert.ok(HAND.length >= 0.13 && HAND.length <= 0.2, `pinch to wrist ${HAND.length} m`);
  assert.ok(HAND.radius >= 0.06 && HAND.radius <= 0.1, `bounding radius ${HAND.radius} m`);
});

for (const side of [1, -1]) {
  test(`${side > 0 ? 'right' : 'left'}-handed: every demo, from every head, clear of the eyes, the pad, the caption and its card`, () => {
    const all = [];
    for (const [hn, head] of HEADS) for (const [dn, move, from, to] of DEMOS) {
      const lat = stage(head, from, to, side, { move, caption: captionAt() });
      // A floor on what was checked (docs/verification.md: a skip guard can skip everything): the
      // faded-out moments are skipped, the rest of the loop must be there.
      let seen = 0;
      for (let t = 0; t < LOOP_MS; t += 20) if (poseAt(move, from, to, t, { lat }).alpha >= 0.05) seen++;
      assert.ok(seen >= 120, `${hn} / ${dn}: only ${seen} moments checked`);
      assert.ok(lat.x * side > 0.4, `${hn} / ${dn}: the hand stays on the reaching side (${lat.x.toFixed(2)})`);
      for (const b of breachesFor(move, from, to, head, side, lat)) all.push(`${hn} / ${dn}: ${b}`);
    }
    assert.deepEqual(all.slice(0, 12), [], `${all.length} breaches`);
  });
}

test('the hand works from the reaching side: right of the line of sight right-handed, left of it left-handed', () => {
  const head = defaultHead();
  const r = stage(head, card(4), pad(2), 1, { caption: captionAt() }), l = stage(head, card(0), pad(0), -1, { caption: captionAt() });
  assert.ok(r.x > 0.5 && l.x < -0.5, `right ${JSON.stringify(r)}, left ${JSON.stringify(l)}`);
  assert.ok(r.z <= 0.05 && l.z <= 0.05, 'and never back toward the head');
});

test('it fades in as it reaches and out as it rises', () => {
  const lat = stage(defaultHead(), DECK, pad(1), 1);
  assert.equal(poseAt('draw', DECK, pad(1), 0, { lat }).alpha, 0, 'invisible at the start');
  const mid = poseAt('draw', DECK, pad(1), 1600, { lat });
  assert.equal(mid.alpha, 1, `fully there mid-demo (${mid.phase})`);
  let t = 0;
  for (const [n, ms] of [['reach', 500], ['down', 300], ['pinch', 250], ['lift', 300], ['carry', 900], ['touch', 300], ['release', 250]]) t += ms;
  assert.ok(poseAt('draw', DECK, pad(1), t + 399, { lat }).alpha < 0.05, 'gone by the end of the rise');
});

test('the control: the old staging (the arm running back toward the head) breaks the rule', () => {
  const head = { x: 0, y: ALTAR.h + 0.27, z: ALTAR.z + 0.28 };
  const f = sub(pad(0), head), n = Math.hypot(f.x, f.z);
  const towardHead = { x: -f.x / n, y: 0, z: -f.z / n };
  const b = breachesFor('charge', card(0), pad(0), head, 1, towardHead);
  assert.ok(b.length > 0, 'the checks see an arm between the eyes and the move');
});
