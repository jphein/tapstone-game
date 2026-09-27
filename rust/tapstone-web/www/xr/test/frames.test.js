// The frame-time log (src/logic/frames.js) the M3 measurement reads: each frame's interval with the
// work that happened in it, percentiles, and the worst frames' causes. Run: node --test test/frames.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameLog, percentile } from '../src/logic/frames.js';

test('percentile: nearest rank, on a known set', () => {
  const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(percentile(xs, 50), 50);
  assert.equal(percentile(xs, 95), 95);
  assert.equal(percentile(xs, 99), 99);
  assert.equal(percentile(xs, 100), 100);
  assert.equal(percentile([7], 99), 7);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([3, 1, 2], 50), 2, 'unsorted input');
});

test('a frame is the interval from its start to the next, carrying the tags raised during it', () => {
  const f = new FrameLog();
  f.begin(0);
  f.tag('view');
  f.begin(16);
  f.begin(50);
  f.tag('effect:summon');
  f.tag('hand', 3);
  f.begin(66);
  const r = f.frames();
  assert.deepEqual(r.map((x) => x.ms), [16, 34, 16]);
  assert.deepEqual(r[0].tags, { view: 1 });
  assert.deepEqual(r[1].tags, {});
  assert.deepEqual(r[2].tags, { 'effect:summon': 1, hand: 3 });
  assert.equal(f.frames().length, 3, 'an open frame is not counted');
});

test('the report: percentiles, frames over budget, and the worst frames with their causes', () => {
  const f = new FrameLog();
  let t = 0;
  for (let i = 0; i < 200; i++) {
    f.begin(t);
    if (i === 50) f.tag('view'), f.tag('hand', 5);
    t += i === 50 ? 80 : i === 120 ? 40 : 16;
  }
  f.begin(t);
  const r = f.report({ budgetMs: 1000 / 60, worst: 2 });
  assert.equal(r.frames, 200);
  assert.equal(r.p50, 16);
  assert.equal(r.max, 80);
  assert.equal(r.over, 2, 'two frames over 16.7 ms');
  assert.deepEqual(r.worst.map((w) => w.ms), [80, 40]);
  assert.deepEqual(r.worst[0].tags, { view: 1, hand: 5 });
  assert.deepEqual(r.worst[1].tags, {}, 'a slow frame with no tag says so: the cause is not ours to name');
  assert.equal(r.worst[0].index, 50);
});

test('bounded: past the cap the oldest frames go, and the count says how many', () => {
  const f = new FrameLog({ cap: 10 });
  for (let i = 0; i <= 25; i++) f.begin(i * 16);
  assert.equal(f.frames().length, 10);
  assert.equal(f.report().dropped, 15);
});

test("byTag: each tag's frame count and median against the untagged baseline, so a cause is a comparison", () => {
  const f = new FrameLog();
  let t = 0;
  for (let i = 0; i < 30; i++) {
    f.begin(t);
    if (i % 10 === 0) f.tag('say'); // 3 frames: 0, 10, 20
    if (i === 5) f.tag('view'), f.tag('hand', 2);
    t += i % 10 === 0 ? 60 : i === 5 ? 90 : 20;
  }
  f.begin(t);
  const r = f.report();
  assert.deepEqual(r.byTag.say, { frames: 3, p50: 60 });
  assert.deepEqual(r.byTag.view, { frames: 1, p50: 90 });
  assert.deepEqual(r.byTag.hand, { frames: 1, p50: 90 }, 'a count tag counts its frame once');
  assert.deepEqual(r.byTag['(untagged)'], { frames: 26, p50: 20 });
});
