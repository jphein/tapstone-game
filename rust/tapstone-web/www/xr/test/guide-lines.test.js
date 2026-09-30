// The altar's one queue (guide v2): a line plays to its end; only the newest refusal waits; a status
// never queues behind anything. JP's Quest 2 run: the guard's "put down" cut the claim line off.
// Run: node --test test/guide-lines.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineQueue, READ, readMs } from '../src/guide/lines.js';

const CLAIM = 'Touch your castle card to the stone.';
const GUARD = 'Set your controllers down: this table is played with your hands.';

test("the guard's line waits for the claim line to finish instead of cutting it", () => {
  const q = new LineQueue();
  q.push(CLAIM, 'lesson');
  assert.equal(q.next(0).text, CLAIM);
  q.playing(0); // its clip is playing
  q.push(GUARD, 'guard');
  for (let t = 0; t < 3000; t += 100) assert.equal(q.next(t), null, `nothing cuts in at ${t} ms`);
  q.ended(); // the claim clip finished
  assert.equal(q.next(3000).text, GUARD);
});

test('only the newest refusal waits; lessons keep their order', () => {
  const q = new LineQueue();
  q.push('lesson one');
  q.next(0);
  q.push('Refused A', 'refusal');
  q.push('lesson two');
  q.push('Refused B', 'refusal');
  q.ended();
  assert.deepEqual([q.next(1).text, (q.ended(), q.next(2)).text, (q.ended(), q.next(3))], ['lesson two', 'Refused B', null]);
});

test('a refusal said twice is said twice (a second try is news); a lesson twice in a row is once', () => {
  const q = new LineQueue();
  q.push('same');
  q.push('same');
  assert.equal(q.waiting.length, 1);
  q.next(0);
  q.ended();
  q.push('No.', 'refusal');
  q.next(1);
  q.ended();
  q.push('No.', 'refusal');
  assert.equal(q.next(2).text, 'No.');
});

test('a status plays only into silence, and the newest replaces a waiting one', () => {
  const q = new LineQueue();
  q.push('a lesson');
  q.next(0);
  q.push('Your move.', 'status');
  q.push('The other seat is thinking…', 'status');
  q.push('another lesson');
  q.ended();
  assert.equal(q.next(1).text, 'another lesson', 'the lesson goes before any status');
  q.ended();
  assert.equal(q.next(2).text, 'The other seat is thinking…');
  assert.equal(q.waiting.length, 0);
});

test('a line with no clip (or a blocked one) ends after its reading time; a clip is capped', () => {
  const q = new LineQueue();
  q.push('short');
  q.push('next');
  q.next(0);
  assert.equal(q.next(READ.min - 1), null);
  assert.equal(q.next(READ.min).text, 'next', 'the reading time ended it');
  q.playing(READ.min); // a clip whose ended never arrives
  assert.equal(q.next(READ.min + READ.max + 1999), null);
  q.push('after');
  assert.equal(q.next(READ.min + READ.max + 2000).text, 'after', 'the cap ended it');
  assert.equal(readMs('x'.repeat(1000)), READ.max);
});

test('a clip that autoplay blocked ends at its reading time, not at the clip cap', () => {
  const q = new LineQueue();
  q.push('a lesson');
  q.push('the next');
  q.next(0);
  q.playing(0); // a clip was started...
  q.blocked(0); // ...and refused by the autoplay policy: no 'ended' will ever come
  assert.equal(q.next(readMs('a lesson') - 1), null);
  assert.equal(q.next(readMs('a lesson')).text, 'the next', 'the queue moves on (it stalled 9 s per line in headless IWER)');
});

test('a newer guide lesson supersedes a waiting older one; the line on air still finishes', () => {
  const q = new LineQueue();
  q.push('Touch your castle card to the stone.', 'lesson', { topic: 'guide' });
  assert.equal(q.next(0).text, 'Touch your castle card to the stone.');
  q.playing(0);
  for (const n of [5, 4, 3]) q.push(`Draw ${n}: touch the top card of your deck to the stone.`, 'lesson', { topic: 'guide' });
  q.push('Pass. Tap the castle again within 3 s to mulligan.', 'lesson'); // no topic: it keeps its place
  assert.equal(q.next(100), null, 'the claim line is not cut');
  q.ended();
  assert.deepEqual([q.next(200).text, (q.ended(), q.next(300)).text, (q.ended(), q.next(400))], ['Draw 3: touch the top card of your deck to the stone.', 'Pass. Tap the castle again within 3 s to mulligan.', null], 'only the newest draw count is said');
});
