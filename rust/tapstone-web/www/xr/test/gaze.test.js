// Head-gaze dwell (src/logic/gaze.js): the dwell timer's rules against the "Midas touch", the
// eyes-only state machine, and a whole match played by dwell alone on the real in-page arena, as
// match.test.js plays one by hand: "gaze can play every move".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Dwell, PROMPT_TILES, gazeForItem, gazeStep, keyOf, lapsFor } from '../src/logic/gaze.js';
import { matchGesture } from '../src/logic/menu.js';
import { CastleTaps } from '../src/logic/gestures.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm');

const pad = (lane) => ({ kind: 'pad', lane });

test('a dwell fires once after its length, with progress on the way', () => {
  const d = new Dwell({ ms: 1000 });
  assert.equal(d.update(0, pad(1)).progress, 0);
  const half = d.update(500, pad(1));
  assert.ok(Math.abs(half.progress - 0.5) < 1e-9);
  assert.equal(half.fired, null);
  assert.deepEqual(d.update(1000, pad(1)).fired, pad(1));
  assert.equal(d.update(1100, pad(1)).fired, null, 'still looking: it does not fire again');
  assert.equal(d.update(5000, pad(1)).fired, null, 'however long the look');
});

test('a target must be left before it fires again; a short glance away keeps the progress', () => {
  const d = new Dwell({ ms: 1000, graceMs: 250 });
  d.update(0, pad(0));
  d.update(600, pad(0));
  d.update(700, null); // a 100 ms glance off
  assert.equal(d.update(800, pad(0)).fired, null);
  assert.deepEqual(d.update(1000, pad(0)).fired, pad(0), 'the glance kept the 600 ms');
  d.update(1100, null);
  d.update(1500, null); // left for 400 ms > grace
  assert.equal(d.update(1600, pad(0)).fired, null, 'back: a fresh dwell');
  assert.deepEqual(d.update(2600, pad(0)).fired, pad(0));
});

test('moving to another target restarts the dwell', () => {
  const d = new Dwell({ ms: 1000 });
  d.update(0, pad(0));
  d.update(900, pad(0));
  assert.equal(d.update(950, pad(1)).fired, null);
  assert.equal(d.update(1500, pad(1)).fired, null);
  assert.deepEqual(d.update(1950, pad(1)).fired, pad(1));
});

test('a bare pad (advance) takes two laps; with a card lifted, one', () => {
  assert.equal(lapsFor(pad(0), null), 2);
  assert.equal(lapsFor(pad(0), { source: 'deck' }), 1);
  assert.equal(lapsFor({ kind: 'hand', slot: 0 }, null), 1);
  const d = new Dwell({ ms: 1000 });
  d.update(0, pad(2), 2);
  assert.equal(d.update(1500, pad(2), 2).fired, null);
  assert.deepEqual(d.update(2000, pad(2), 2).fired, pad(2));
});

test('the dwell length is configurable', () => {
  const d = new Dwell({ ms: 2000 });
  d.update(0, pad(0));
  assert.equal(d.update(1999, pad(0)).fired, null);
  assert.ok(d.update(2000, pad(0)).fired);
});

test('the eyes-only steps mirror the eyes-and-hands path', () => {
  const hand = [{ card: 2, name: 'Cinder Whelp' }, { card: 5, name: 'Flare' }];
  let s = gazeStep(null, { kind: 'hand', slot: 0 }, hand);
  assert.deepEqual(s.lifted, { source: 'hand', slot: 0, face: 'up' });
  s = gazeStep(s.lifted, { kind: 'hand', slot: 0 }, hand);
  assert.equal(s.lifted.face, 'down', 'the same card again turns it over');
  s = gazeStep(s.lifted, pad(2), hand);
  assert.deepEqual(s, { lifted: null, gesture: { source: 'hand', card: 2, face: 'down', pad: 2 } });
  assert.deepEqual(gazeStep(null, pad(1), hand), { lifted: null, gesture: { source: 'lane', pad: 1 } });
  assert.deepEqual(gazeStep({ source: 'deck' }, pad(0), hand).gesture, { source: 'deck' });
  assert.equal(gazeStep(null, { kind: 'castle' }, hand).castle, true);
  assert.equal(gazeStep(null, { kind: 'prompt', option: 2 }, hand).prompt, 2);
  assert.equal(gazeStep(null, { kind: 'tile', key: 'highContrast' }, hand).tile, 'highContrast');
  assert.equal(keyOf({ kind: 'hand', slot: 0 }) === keyOf({ kind: 'hand', slot: 1 }), false);
});

// ---- a whole match by gaze, on the real arena ---------------------------------------------------

async function openTable(seed, human) {
  const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
  const x = instance.exports;
  const read = (n) => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.out_ptr(), n));
  x.table_new(BigInt(seed), human);
  return { x, read };
}

// Dwell the targets in order, as play.js's gaze path does, and answer the menu index picked.
// The castle goes through CastleTaps (logic/gestures.js): outside the mulligan window one tap
// passes; inside it, two taps within the window are a mulligan, one tap and a wait is a pass.
function dwelt(targets, menu, hand) {
  let lifted = null, offered = null, t = 0;
  const castle = new CastleTaps();
  const mulliganOpen = menu.some((m) => m.kind === 'Mulligan');
  let castleAction = null;
  for (const target of targets) {
    t += 1300; // a dwell, and the look from the last target
    const s = gazeStep(lifted, target, hand);
    lifted = s.lifted;
    if (s.castle) {
      const r = castle.tap(t, mulliganOpen);
      if (r !== 'pending') castleAction = r;
    }
    if (s.prompt !== undefined) return offered?.[s.prompt]?.index;
    // A unit (or the keep) on the board: TargetTimer.pick(target), the option with that byte.
    if (s.unit !== undefined) return offered?.find((o) => o.target === s.unit)?.index;
    if (s.gesture) {
      const m = matchGesture(menu, s.gesture);
      if (m.index !== undefined) return m.index;
      if (m.need === 'target') offered = m.options;
      else return undefined;
    }
  }
  if (castle.pending) castleAction = castle.poll(t + 5000);
  if (castleAction) return matchGesture(menu, { source: 'castle', action: castleAction }).index;
  return undefined;
}

// The same move. Every Draw is one move: the menu names the card each would draw, but a draw takes
// the deck's top card whichever item is picked (a hand touching the deck can't choose either).
const same = (a, b) => (a.kind === 'Draw' && b.kind === 'Draw') || ['kind', 'card', 'lane', 'target', 'aux'].every((f) => a[f] === b[f]);

// The dwell targets for item `m` of `menu`, the prompt option found as a person finds it: the pad
// alone opens the prompt, and the person looks at the tile that names the target.
function plan(m, menu, hand) {
  const first = gazeForItem(m, hand);
  if (m.kind !== 'CastSpell') return first;
  const s = gazeStep(gazeStep(null, first[0], hand).lifted, first[1], hand);
  const r = matchGesture(menu, s.gesture);
  if (r.need !== 'target') return first;
  return gazeForItem(m, hand, r.options);
}

test('gaze can play every move: a whole match by dwell, and every menu item at every step reachable', async () => {
  const { x, read } = await openTable(11, 0);
  let taps = 0, checked = 0, prompts = 0, units = 0, maxOptions = 0;
  const kinds = new Set();
  for (let s = 0n; s < 60000n; s++) {
    x.table_step(s * 10n);
    if (x.table_done()) break;
    const menu = JSON.parse(read(x.table_choices()));
    if (!menu.length) continue;
    const hand = JSON.parse(read(x.table_hand()));
    for (const m of menu) {
      const targets = plan(m, menu, hand);
      assert.ok(targets, `no gaze plan for ${m.kind}`);
      const p = targets.find((t) => t.kind === 'prompt');
      if (p) {
        prompts++;
        maxOptions = Math.max(maxOptions, p.option + 1);
        // The altar shows three prompt tiles (altar.js): a target past them can't be looked at.
        assert.ok(p.option < PROMPT_TILES, `${m.label}: prompt option ${p.option} has no tile`);
      }
      if (targets.some((t) => t.kind === 'unit')) units++;
      const k = dwelt(targets, menu, hand);
      assert.ok(k !== undefined && same(menu[k], m), `${m.label}: dwelling ${JSON.stringify(targets)} picked ${k === undefined ? 'nothing' : menu[k].label}`);
      checked++;
    }
    const i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i < 0) continue;
    const k = dwelt(plan(menu[i], menu, hand), menu, hand);
    assert.ok(x.table_propose(k, s * 10n), `${menu[k].label} was refused`);
    taps++;
    kinds.add(menu[k].kind);
  }
  assert.ok(x.table_done(), 'the match finished');
  assert.ok(taps >= 20, `taps ${taps}`);
  assert.ok(checked > taps * 3, `checked ${checked} items`);
  for (const k of ['Draw', 'Charge', 'CastUnit', 'Advance', 'Pass']) assert.ok(kinds.has(k), `${k} was played by gaze (${[...kinds]})`);
  console.log(`# gaze: ${taps} moves played, ${checked} items reached, ${prompts} via a prompt tile, ${units} via the unit on the board`);
  assert.ok(units > 0, 'the match needed a target past the tiles (else this path is untested)');
});
