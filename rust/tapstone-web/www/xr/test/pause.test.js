// Pause and resume (spec 2026-09-25 §3.5, contest rule "clean pause/resume"): the pure logic behind
// play.js's pause. A paused match must be indistinguishable from one whose pause lasted no time at
// all: the table does not advance, the timers (castle double-tap, target auto-pick, the first five's
// beats) see a frozen clock, and a gesture made while dark is held and played on return.
// Run: node --test test/pause.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PauseClock, FRAME_CAP_MS, pauseReasons } from '../src/logic/pause.js';
import { CastleTaps, TargetTimer } from '../src/logic/gestures.js';
import { tableFrom } from '../src/table.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = process.env.TAPSTONE_WASM ?? join(here, 'fixtures/tapstone_web.wasm');
const bytes = readFileSync(WASM);
const exportsOf = async () => (await WebAssembly.instantiate(bytes, {})).instance.exports;

test('the clock freezes while paused and never jumps on return', () => {
  const p = new PauseClock();
  assert.equal(p.now(1000), 1000);
  assert.equal(p.set('xr', true, 1000), 'paused');
  assert.equal(p.now(5000), 1000, 'frozen while paused');
  assert.equal(p.set('tab', true, 6000), null, 'a second reason is not a second pause');
  assert.equal(p.set('xr', false, 7000), null, 'still paused by the tab');
  assert.equal(p.now(8000), 1000);
  assert.equal(p.set('tab', false, 9000), 'resumed');
  assert.equal(p.now(9000), 1000, 'resumes where it stopped');
  assert.equal(p.now(9500), 1500);
  assert.equal(p.pauses, 1);
  assert.equal(p.pausedMs(9500), 8000);
});

test('frame time: nothing while paused, nothing on the first frame back, capped otherwise', () => {
  const p = new PauseClock();
  assert.equal(p.frameMs(16), 16);
  assert.equal(p.frameMs(5000), FRAME_CAP_MS);
  p.set('tab', true, 0);
  assert.equal(p.frameMs(16), 0);
  p.set('tab', false, 30000);
  assert.equal(p.frameMs(30000), 0, 'the hidden gap is not played');
  assert.equal(p.frameMs(16), 16);
});

test('gestures made while paused are held, in order, and released only on return', () => {
  const p = new PauseClock();
  p.set('xr', true, 0);
  p.hold('a');
  p.hold('b');
  assert.deepEqual(p.drain(), [], 'nothing leaves while paused');
  p.set('xr', false, 10);
  assert.deepEqual(p.drain(), ['a', 'b']);
  assert.deepEqual(p.drain(), []);
});

test('no timer race: a pending castle tap and a target prompt survive a long pause', () => {
  const p = new PauseClock(), castle = new CastleTaps(), target = new TargetTimer();
  let wall = 1000;
  assert.equal(castle.tap(p.now(wall), true), 'pending');
  target.start(p.now(wall), [{ index: 4, target: 1 }], 0);
  wall += 500;
  p.set('xr', true, wall);
  for (; wall < 61500; wall += 16) {
    assert.equal(castle.poll(p.now(wall)), null, `the castle window closed while paused at ${wall}`);
    assert.equal(target.poll(p.now(wall)), null, `the target auto-picked while paused at ${wall}`);
  }
  p.set('xr', false, wall);
  wall += 1000; // 1.5 s of play since the first tap: still inside the 3 s window
  assert.equal(castle.tap(p.now(wall), true), 'mulligan');
  assert.equal(target.poll(p.now(wall)), null);
  wall += 1600;
  assert.equal(target.poll(p.now(wall)), 4, 'the target times out on play time, not wall time');
});

// A page-shaped loop: frames of wall time; each frame advances the table by pause.frameMs, then the
// person (the web gate's chooser: the first useful non-mulligan item) gestures once per clock value.
// `pauses` is [[live, frames]]: the page goes dark after its `live`-th lit frame's advance and before
// its gesture (the worst moment), and stays dark for `frames` frames of `gapMs` each.
async function play({ pauses = [], gapMs = 16, store = null } = {}) {
  const x = await exportsOf();
  const t = tableFrom(x, 11, 0, store);
  const pause = new PauseClock();
  let wall = 0, acted = -1, held = 0, views = 0, dark = null, live = 0;
  const gesture = () => {
    const menu = t.choices();
    const i = menu.findIndex((m) => m.useful && m.kind !== 'Mulligan');
    if (i >= 0) assert.ok(t.propose(i), `${menu[i].label} was refused`);
  };
  for (let frame = 0; frame < 100000 && !t.done(); frame++) {
    const gap = dark ? gapMs : 16;
    wall += gap;
    t.advance(pause.frameMs(gap), () => views++);
    const start = !dark && pauses.find(([f]) => f === live);
    if (!dark) live++;
    if (start) {
      dark = { until: frame + start[1] };
      pause.set('xr', true, wall);
    }
    if (dark && frame >= dark.until) {
      dark = null;
      pause.set('xr', false, wall);
      for (const g of pause.drain()) g();
    }
    if (t.now() !== acted) {
      acted = t.now();
      if (pause.paused) pause.hold(gesture), held++;
      else gesture();
    }
  }
  return { done: t.done(), journal: t.journal, views, held, pauses: pause.pauses };
}

test('a match paused mid-play (dark for minutes, at the worst moment) ends with the same chain', async () => {
  const base = await play();
  assert.ok(base.done, 'the uninterrupted match finished');
  assert.ok(base.journal.final, 'the uninterrupted match has a final head');
  // The chooser finishes seed 11 in ~50 lit frames (measured). Pause at eight points across it,
  // 20 s to 2.5 min of wall time each, in 1 s frames while dark.
  const pauses = [2, 7, 13, 19, 26, 32, 39, 44].map((f, k) => [f, 20 + k * 20]);
  const paused = await play({ pauses, gapMs: 1000 });
  assert.ok(paused.done, 'the paused match finished');
  assert.equal(paused.pauses, pauses.length, 'every pause happened');
  assert.ok(paused.held >= 3, `gestures were made while dark (${paused.held})`);
  assert.equal(paused.journal.taps.length, base.journal.taps.length, 'no tap lost, none doubled');
  assert.deepEqual(paused.journal.taps, base.journal.taps, 'every tap at the same play time');
  assert.equal(paused.journal.final, base.journal.final, 'the same final head');
  assert.equal(paused.views, base.views, 'the same views');
});

// The reasons come from state, not from pairs of events (a real Quest 2, 2026-09-28: the match stayed
// paused in the headset with 'tab' and 'blur' set, and six placings waited in the held queue).
test('in XR, the 2D page being hidden or unfocused never pauses the match', () => {
  const r = pauseReasons({ presenting: true, sessionVisibility: 'visible', docHidden: true, hadSession: true });
  assert.deepEqual(r, { tab: false, blur: false, xr: false });
});

test('in XR, only the current session hiding or blurring pauses', () => {
  for (const v of ['hidden', 'visible-blurred']) {
    assert.deepEqual(pauseReasons({ presenting: true, sessionVisibility: v, docHidden: false, hadSession: true }), { tab: false, blur: true, xr: false }, v);
  }
});

test('outside XR: a hidden tab pauses, and so does a session that ended with none since', () => {
  assert.deepEqual(pauseReasons({ presenting: false, docHidden: true, hadSession: false }), { tab: true, blur: false, xr: false });
  assert.deepEqual(pauseReasons({ presenting: false, docHidden: false, hadSession: true }), { tab: false, blur: false, xr: true });
  assert.deepEqual(pauseReasons({ presenting: false, docHidden: false, hadSession: false }), { tab: false, blur: false, xr: false }, 'before any session: the page plays');
});

test('a clock driven by the derived reasons resumes once the state is right, whatever events were missed', () => {
  const c = new PauseClock();
  const apply = (s, wall) => { for (const [k, on] of Object.entries(pauseReasons(s))) c.set(k, on, wall); };
  apply({ presenting: false, docHidden: true, hadSession: true }, 0); // the Quest menu: tab and xr
  assert.equal(c.paused, true);
  c.hold('placing');
  apply({ presenting: true, sessionVisibility: 'visible', docHidden: true, hadSession: true }, 500); // back in XR
  assert.equal(c.paused, false);
  assert.deepEqual(c.drain(), ['placing']);
});
