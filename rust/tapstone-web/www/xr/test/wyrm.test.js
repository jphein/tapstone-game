// The whelp's body and its summon (src/summons/wyrm-pose.js, look.js soar): pure, so Node holds the
// flap, the fold, the breath's aim, and the sweep past the person's head to their numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pose, chain, wing, span, flapAngle, stretchAt, FRONT, BACK, FLAP, STRETCH, dist } from '../src/summons/wyrm-pose.js';
import { soar, soarSize, summonStyle, SOAR, LIGHT } from '../src/summons/look.js';
import { MODELS } from '../src/summons/creatures.js';
import { defaultHead, cellCenter, padCenter, offGaze } from '../src/logic/layout.js';

const MODES = ['perch', 'fly', 'glide'];
const times = Array.from({ length: 60 }, (_, i) => i * 0.137);

test('the spine keeps its length in every pose: only the angles move', () => {
  for (const m of MODES) for (const t of times) for (const o of [{}, { snap: 1 }, { breath: 1 }]) {
    const c = chain(pose(m, t, o));
    FRONT.forEach((L, i) => assert.ok(Math.abs(dist(c.front[i], c.front[i + 1]) - L) < 1e-9, `${m} front ${i}`));
    BACK.forEach((L, i) => assert.ok(Math.abs(dist(c.back[i], c.back[i + 1]) - L) < 1e-9, `${m} back ${i}`));
  }
});

test('a real flap: a fast, deep downstroke, a slower upstroke, and no jump at the cycle seam', () => {
  assert.ok(FLAP.down < 0.5, 'the downstroke is the shorter part of the cycle');
  assert.ok(flapAngle(0) >= 0.8 && flapAngle(FLAP.down) <= -0.6, 'wings from high above to well below');
  assert.ok(Math.abs(flapAngle(0) - flapAngle(1 - 1e-9)) < 1e-6, 'continuous across the seam');
  // Downstroke faster: the angle falls more per unit phase than it rises.
  const down = (flapAngle(0) - flapAngle(FLAP.down)) / FLAP.down, up = (flapAngle(1 - 1e-9) - flapAngle(FLAP.down)) / (1 - FLAP.down);
  assert.ok(down > up * 1.2, `down ${down.toFixed(2)}/cycle vs up ${up.toFixed(2)}`);
});

test('the wings spread wide in flight and fold along the flanks when perched', () => {
  const open = span(pose('glide', 0)), folded = Math.min(...times.map((t) => span(pose('perch', t))));
  assert.ok(open > 1.1, `a wide span (${open.toFixed(2)} nose-to-tail lengths)`);
  assert.ok(folded < open * 0.45, `folded ${folded.toFixed(2)} vs spread ${open.toFixed(2)}`);
  assert.equal(pose('fly', 0).tuck, 1, 'legs tucked in flight');
  assert.equal(pose('perch', 0).tuck, 0, 'standing on them perched');
  // The fingers fan back toward the tail, so the membrane between them is a real sail.
  const j = wing(pose('glide', 0), 1);
  assert.ok(j.fingers[0].z > j.fingers[1].z && j.fingers[1].z > j.fingers[2].z, 'first finger foremost, last toward the tail');
});

test('perched, it stays alive: it breathes, looks about, sways its tail, and now and then stretches its wings', () => {
  const chest = times.map((t) => pose('perch', t).chest);
  assert.ok(Math.max(...chest) - Math.min(...chest) > 0.04, 'breathing');
  const tailYaw = times.map((t) => chain(pose('perch', t)).back.at(-1).x);
  assert.ok(Math.max(...tailYaw) - Math.min(...tailYaw) > 0.05, 'the tail sways');
  const s = Array.from({ length: 700 }, (_, i) => stretchAt(i * 0.02));
  assert.ok(Math.max(...s) > 0.95, 'a full stretch');
  assert.ok(s.filter((x) => x > 0).length / s.length < 0.25, 'but only now and then');
  assert.ok(span(pose('perch', STRETCH.ms / 2000)) > span(pose('perch', STRETCH.every * 0.5)) * 1.5, 'the stretch opens the wings');
});

test('no pose pops: a frame later (90 Hz), nothing has moved far', () => {
  for (const m of MODES) for (const t of times) {
    const a = chain(pose(m, t)), b = chain(pose(m, t + 1 / 90));
    for (const k of ['front', 'back']) a[k].forEach((p, i) => assert.ok(dist(p, b[k][i]) < 0.02, `${m} ${k}${i} at ${t}`));
  }
});

test('the strike and the breath open the jaw; the breath aims forward and down, over the table', () => {
  assert.ok(pose('fly', 0, { snap: 1 }).jaw >= 0.5);
  assert.ok(pose('glide', 0, { breath: 1 }).jaw >= 0.6);
  const snout = (p) => {
    const c = chain(p).front;
    return (c.at(-1).y - c.at(-3).y) / Math.hypot(c.at(-1).z - c.at(-3).z, c.at(-1).y - c.at(-3).y);
  };
  assert.ok(snout(pose('glide', 0, { breath: 1 })) < snout(pose('glide', 0)), 'the snout dips to breathe');
});

// ---- the summon's sweep (look.js soar) --------------------------------------------------------------

const head = defaultHead();
const sweeps = [];
for (let lane = 0; lane < 3; lane++) for (let c = 0; c < 3; c++) {
  const p = padCenter(lane);
  const card = { x: p.x, y: p.y + 0.054, z: p.z - 0.07 };
  sweeps.push({ lane, c, card, cell: cellCenter(0, lane, c, 0), f: soar(card, cellCenter(0, lane, c, 0), head, lane === 0 ? -1 : 1) });
}
const K = Array.from({ length: 201 }, (_, i) => i / 200);

test('the sweep: from the card, big, past the head at eye line (never too near), and down to its cell', () => {
  for (const s of sweeps) {
    const a = s.f(0), b = s.f(1);
    assert.ok(dist(a, s.card) < 1e-9 && dist(b, s.cell) < 1e-9, 'card to cell');
    const d = K.map((k) => dist(s.f(k), head));
    const near = Math.min(...d), at = K[d.indexOf(near)];
    assert.ok(near >= SOAR.clear, `lane ${s.lane}: ${near.toFixed(3)} m from the head`);
    assert.ok(near <= 0.4, `lane ${s.lane}: it does come past (${near.toFixed(3)} m)`);
    assert.ok(Math.abs(s.f(at).y - head.y) < 0.15, 'near the eye line');
    assert.ok(soarSize(at) === SOAR.big, 'big as it passes');
    for (const k of K) assert.ok(s.f(k).y >= -0.001, 'never through the table');
    for (const k of K.filter((x) => x > 0.15 && x < 0.62)) {
      const g = offGaze(s.f(k), head);
      assert.ok(Math.hypot(g.yaw, g.pitch) <= SOAR.view, `in view while it passes (${Math.hypot(g.yaw, g.pitch).toFixed(0)}°)`);
    }
  }
});

test('big means 25–35 cm tip to tip, and it lands at board size', () => {
  const big = MODELS.wyrm.span * SOAR.big;
  assert.ok(big >= 0.25 && big <= 0.35, `${(big * 100).toFixed(0)} cm`);
  assert.equal(soarSize(1), 1);
});

test('the fire is breathed away from the person, down over the table', () => {
  for (const s of sweeps) {
    const p = s.f(SOAR.fire);
    const toHead = { x: head.x - p.x, y: head.y - p.y, z: head.z - p.z };
    const h = p.heading;
    assert.ok(h.x * toHead.x + h.y * toHead.y + h.z * toHead.z < 0, `lane ${s.lane}: heading away from the head`);
    assert.ok(p.z < head.z - 0.3, 'over the table, well ahead of the person');
    assert.ok(p.y < head.y, 'below the eyes');
  }
});

test('which summon: the whelp soars from my pad; reduced motion always forms calmly where it stands', () => {
  assert.equal(summonStyle({ soars: true, origin: 'pad' }), 'soar');
  assert.equal(summonStyle({ soars: true, origin: 'keep' }), 'flight');
  assert.equal(summonStyle({ soars: false, origin: 'pad' }), 'flight');
  for (const origin of ['pad', 'keep', 'here']) assert.equal(summonStyle({ soars: true, origin, reduced: true }), 'form');
  assert.equal(summonStyle({ origin: 'here' }), 'form');
});

test('light adds colour but never writes alpha, so sparks glow over the room in mixed reality', () => {
  // Blended alpha = src.a * alpha.src + dst.a * alpha.dst: it must stay dst.a.
  assert.deepEqual(LIGHT.alpha, { src: 'zero', dst: 'one' });
  assert.equal(LIGHT.rgb.dst, 'one', 'additive');
});
