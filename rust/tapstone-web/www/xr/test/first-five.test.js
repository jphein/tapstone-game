// The first five minutes (spec 2026-09-25 §3.4): the beat table and its state machine.
// Run: node --test test/first-five.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { diffViews } from '../src/logic/effects.js';
import { BEATS, FIRST_MATCH, FirstFive, PAYOFF_MS, beatEvents, gestureOf } from '../src/logic/first-five.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../../tapstone-arena/web/fixtures/desk-seed11.jsonl');
const views = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SPEC = join(here, '../../../../../docs/superpowers/specs/2026-09-25-tapstone-vr-design.md');

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String((ms / 1000) % 60).padStart(2, '0')}`;

// Walk a fresh machine through every beat the way a person would: each beat's gesture as many
// times as it asks, then its payoff. Returns what the voice said, in order.
function walk(m, t0 = 0) {
  const said = [m.start(t0)];
  let t = t0;
  for (const b of BEATS) {
    t += 500;
    for (let k = 0; b.teaches && k < b.count; k++) said.push(m.gesture(b.teaches, (t += 200)));
    said.push(m.event(b.payoff, (t += 300)));
  }
  return said.filter(Boolean);
}

test('eight beats, in the spec table order, with its clocks', () => {
  // The table in §3.4 is the source; the beat table must say the same clocks in the same order.
  const spec = readFileSync(SPEC, 'utf8');
  const rows = [...spec.matchAll(/^\| (\d:\d\d)–(\d:\d\d) \| ([^|]+) \| ([^|]+) \|$/gm)];
  assert.equal(rows.length, 8, 'the §3.4 table has eight clock rows');
  assert.equal(BEATS.length, 8);
  BEATS.forEach((b, i) => {
    assert.equal(mmss(b.clock[0]), rows[i][1], `${b.id} start`);
    assert.equal(mmss(b.clock[1]), rows[i][2], `${b.id} end`);
    assert.equal(b.beat, rows[i][3].trim(), `${b.id} names the spec's beat`);
  });
  for (let i = 1; i < BEATS.length; i++) assert.equal(BEATS[i].clock[0], BEATS[i - 1].clock[1], 'the clocks tile');
});

test("the payoff window is the spec one: each paid off within N s", () => {
  // The other tests measure relative to PAYOFF_MS, so they move with it; only the spec can pin it.
  const m = readFileSync(SPEC, 'utf8').match(/each paid off within (\d+) s/);
  assert.ok(m, '§3.4 states the payoff window');
  assert.equal(PAYOFF_MS, Number(m[1]) * 1000);
});

test('one new gesture per beat: no beat teaches a gesture an earlier beat taught', () => {
  const taught = BEATS.map((b) => b.teaches).filter(Boolean);
  assert.equal(taught.length, 6, 'six beats teach, two (the bot, unguided) only watch');
  assert.equal(new Set(taught).size, taught.length, `${taught}`);
});

test('each beat speaks exactly one sentence, and no two beats share one', () => {
  for (const b of BEATS) {
    assert.equal(typeof b.say, 'string');
    // One sentence: ends in one full stop, with no other sentence break inside.
    assert.match(b.say, /^[A-Z][^.!?]*[.!?]$/, `${b.id}: "${b.say}"`);
  }
  assert.equal(new Set(BEATS.map((b) => b.say)).size, BEATS.length);
});

test('the voice says each beat in order as the person walks all eight', () => {
  const m = new FirstFive();
  const said = walk(m);
  assert.deepEqual(said, BEATS.map((b) => b.say));
  assert.equal(m.done, true);
  assert.equal(m.why, 'payoff');
});

test('why says how each beat started: on its payoff, the 3 s fallback, or its clock', () => {
  const m = new FirstFive();
  m.start(0);
  assert.equal(m.why, 'start');
  m.gesture('place', 1);
  m.poll(1 + PAYOFF_MS);
  assert.equal(m.why, 'fallback');
  m.event('commander', 3 + PAYOFF_MS);
  m.gesture('claim', 4 + PAYOFF_MS);
  assert.equal(m.why, 'payoff', 'a latched state is a payoff, not a fallback');
});

test('a beat never advances on a gesture it did not teach', () => {
  const m = new FirstFive();
  m.start(0);
  assert.equal(m.beat.id, 'place');
  // Every other beat's gesture, in the place beat: nothing moves, nothing is said.
  for (const b of BEATS) if (b.teaches && b.teaches !== 'place') assert.equal(m.gesture(b.teaches, 100), null);
  assert.equal(m.beat.id, 'place');
  // The mechanism that could be wrong: a wrong gesture arming the payoff wait, so the payoff (or
  // its 3 s fallback) then advances a beat that was never taught. Deliver both and stay put.
  assert.equal(m.poll(100 + PAYOFF_MS), null);
  assert.equal(m.beat.id, 'place');
  m.gesture('place', 200);
  m.event('placed', 300);
  assert.equal(m.beat.id, 'claim');
  // Draws are owed after the claim, but a draw tap is not the claim beat's gesture.
  m.gesture('draw', 400);
  m.gesture('pass', 410);
  m.event('commander', 420);
  assert.equal(m.poll(410 + PAYOFF_MS), null);
  assert.equal(m.beat.id, 'claim');
});

test('the draw beat asks for five draws, not one', () => {
  const m = new FirstFive();
  m.start(0);
  m.gesture('place', 1);
  m.event('placed', 2);
  m.gesture('claim', 3);
  m.event('commander', 4);
  assert.equal(m.beat.id, 'draw');
  for (let k = 0; k < 4; k++) {
    m.gesture('draw', 10 + k);
    m.event('drawFlip', 11 + k);
  }
  assert.equal(m.beat.id, 'draw', 'four draws are not five');
  m.gesture('draw', 20);
  assert.equal(m.event('drawFlip', 21), BEATS[3].say);
  assert.equal(m.beat.id, 'flip');
});

test('a payoff before the gesture does not count; one within 3 s of it does', () => {
  const m = new FirstFive();
  m.start(0);
  m.gesture('place', 1);
  m.event('placed', 2);
  m.gesture('claim', 3);
  m.event('commander', 4);
  for (let k = 0; k < 5; k++) m.gesture('draw', 10);
  m.event('drawFlip', 11);
  assert.equal(m.beat.id, 'flip');
  // The bot's mana gem lights before the person has flipped anything: not this beat's payoff.
  m.event('chargeGem', 20);
  assert.equal(m.beat.id, 'flip');
  m.gesture('charge', 30);
  assert.equal(m.beat.id, 'flip', 'the gesture alone waits for its payoff');
  m.event('chargeGem', 30 + PAYOFF_MS - 1);
  assert.equal(m.beat.id, 'cast');
});

test('the commander (a state) pays off even when it formed before the castle tap', () => {
  const m = new FirstFive();
  m.start(0);
  m.gesture('place', 1);
  m.event('placed', 2);
  m.event('commander', 3); // the desk claims the seat by itself; the commander is already up
  assert.equal(m.beat.id, 'claim');
  assert.equal(m.gesture('claim', 4), BEATS[2].say);
  assert.equal(m.beat.id, 'draw');
});

// Found by the IWER run (2026-09-27): the page's table seats the person and forms the commander
// while the headset is still placing the board, so the commander lands during the PLACE beat.
test('a state payoff that lands during an earlier beat still pays off its own beat', () => {
  const m = new FirstFive();
  m.start(0);
  m.event('commander', 1); // the place beat is current
  m.gesture('place', 2);
  m.event('placed', 3);
  assert.equal(m.beat.id, 'claim');
  assert.equal(m.gesture('claim', 4), BEATS[2].say);
  assert.equal(m.why, 'payoff');
});

test('timeouts: a missing payoff moves on after 3 s, a missing gesture only repeats the line', () => {
  const m = new FirstFive();
  m.start(0);
  // No gesture: past the beat's own 15 s the voice repeats the same sentence, and stays.
  assert.equal(m.poll(14999), null);
  assert.equal(m.poll(15000), BEATS[0].say);
  assert.equal(m.poll(15001), null, 'one reminder, not one per frame');
  assert.equal(m.beat.id, 'place');
  // The gesture came but the payoff never did: 3 s later the next beat starts anyway.
  m.gesture('place', 20000);
  assert.equal(m.poll(20000 + PAYOFF_MS - 1), null);
  assert.equal(m.poll(20000 + PAYOFF_MS), BEATS[1].say);
  assert.equal(m.beat.id, 'claim');
});

test('the watching beats advance on their payoff or their clock, with no gesture', () => {
  const m = new FirstFive();
  const t = walk(m).length; // walk the whole thing once, to prove it can finish
  assert.equal(t, 8);
  const n = new FirstFive();
  n.start(0);
  const upTo = (id) => {
    for (const b of BEATS) {
      if (b.id === id) return;
      if (b.teaches) for (let k = 0; k < b.count; k++) n.gesture(b.teaches, 1);
      n.event(b.payoff, 2);
    }
  };
  upTo('bot');
  assert.equal(n.beat.id, 'bot');
  // The bot's turn: the person's gestures don't move it...
  n.gesture('pass', 5);
  n.gesture('draw', 6);
  assert.equal(n.beat.id, 'bot');
  // ...its own clock does (60 s, from 2:30 to 3:30), when no kill comes.
  assert.equal(n.poll(2 + 60000 - 1), null);
  assert.equal(n.poll(2 + 60000), BEATS[7].say);
  assert.equal(n.beat.id, 'unguided');
  // Unguided play ends at 5:00 into it, or at the chip off the enemy keep.
  n.event('enemyKeepChip', 70000);
  assert.equal(n.done, true);
  assert.equal(n.poll(10 ** 7), null, 'a finished machine says nothing');
});

test('the match ending finishes the tutorial wherever it is', () => {
  const m = new FirstFive();
  m.start(0);
  m.event('over', 1);
  assert.equal(m.done, true);
  assert.equal(m.gesture('place', 2), null);
});

test('gestureOf names the gesture a committed menu item was', () => {
  assert.equal(gestureOf({ kind: 'Draw' }), 'draw');
  assert.equal(gestureOf({ kind: 'Charge' }), 'charge');
  assert.equal(gestureOf({ kind: 'CastUnit' }), 'cast');
  assert.equal(gestureOf({ kind: 'Pass' }), 'pass');
  assert.equal(gestureOf({ kind: 'Advance' }), 'advance');
  // Every beat's taught gesture is one the table can produce (from a move, or placement/claim).
  const made = new Set(['place', 'claim', ...['Draw', 'Charge', 'CastUnit', 'CastSpell', 'Advance', 'Pass', 'Mulligan'].map((k) => gestureOf({ kind: k }))]);
  for (const b of BEATS) if (b.teaches) assert.ok(made.has(b.teaches), b.teaches);
});

test('every payoff the table can see happens in the real desk match (seat 0)', () => {
  // Built from the same diffViews the scene animates, on the real fixture: a payoff name that no
  // view pair can produce would leave its beat waiting on the 3 s fallback forever.
  const seen = new Set();
  let prev = null;
  for (const v of views) {
    for (const e of beatEvents(prev, v, 0)) seen.add(e);
    prev = v;
  }
  for (const b of BEATS) {
    if (b.payoff === 'placed') continue; // placement's, not a view's (play.js autoPlace)
    assert.ok(seen.has(b.payoff), `${b.id}: ${b.payoff} never happened (${[...seen]})`);
  }
  assert.ok(seen.has('over'));
});

// A payoff is the person's own: the bot's summon or gem must not pay off the person's beat, and a
// chip off the person's own keep is not the enemy's. Controls from the real fixture: view pairs
// where only ONE seat did the thing, found from diffViews itself, not typed indexes.
test('payoffs belong to the right seat, on the real desk match', () => {
  const only = (type, seat, pred = () => true) => {
    for (let k = 1; k < views.length; k++) {
      const es = diffViews(views[k - 1], views[k], 0).filter((e) => e.type === type && pred(e));
      if (es.length && es.every((e) => e.seat === seat)) return k;
    }
    return -1;
  };
  const cases = [
    ['summon', 'summon', (e) => !e.commander],
    ['chargeGem', 'chargeGem'],
    ['drawFlip', 'drawFlip'],
  ];
  let checked = 0;
  for (const [type, payoff, pred] of cases) {
    for (const seat of [0, 1]) {
      const k = only(type, seat, pred);
      if (k < 0) continue;
      checked++;
      assert.ok(beatEvents(views[k - 1], views[k], seat).includes(payoff), `${type}@${seat} at ${k}: the doer's payoff`);
      assert.ok(!beatEvents(views[k - 1], views[k], 1 - seat).includes(payoff), `${type}@${seat} at ${k}: not the other seat's`);
    }
  }
  const chip = only('keepChip', 1);
  assert.ok(chip > 0, 'a chip off seat 1 alone');
  assert.ok(beatEvents(views[chip - 1], views[chip], 0).includes('enemyKeepChip'));
  assert.ok(!beatEvents(views[chip - 1], views[chip], 1).includes('enemyKeepChip'));
  checked++;
  assert.ok(checked >= 6, `only ${checked} one-seat cases in the fixture`);
});

test('the first-match ruleset is three HouseRules fields and nothing else', () => {
  assert.deepEqual(FIRST_MATCH, { castle_life: 10, pressure_from: 4, stop_round: 6 });
});

// Question 4 of the 2026-09-27 report: a beat holds every other voice line, so an unanswered beat
// held them for good. It holds for its own clock window (spec §3.4: the beat's length, from when it
// started), then hands the voice back; it stays the current beat, and its gesture still counts.
test('an unanswered beat holds the other voice lines for its clock window, then hands them back', () => {
  const m = new FirstFive();
  m.start(1000);
  const len = BEATS[0].clock[1] - BEATS[0].clock[0];
  assert.equal(m.holding(1000), true, 'a fresh beat holds');
  assert.equal(m.holding(1000 + len - 1), true, 'inside its window');
  assert.equal(m.holding(1000 + len), false, 'its window is over: the voice is handed back');
  assert.equal(m.poll(1000 + len), BEATS[0].say, 'the one reminder still comes');
  assert.equal(m.holding(1000 + len + 1), false, 'a reminder does not take the voice again');
  assert.equal(m.beat.id, 'place', 'still the current beat');
  assert.equal(m.gesture('place', 1000 + len + 5), null);
  assert.equal(m.holding(1000 + len + 5), true, 'answered: it holds while its payoff is owed');
  assert.equal(m.event('placed', 1000 + len + 5), BEATS[1].say, 'and its gesture still advances it');
  assert.equal(m.holding(1000 + len + 5), true, 'the next beat holds for its own window');
});

test('an answered beat holds until its payoff or the 3 s fallback, even past its window', () => {
  const m = new FirstFive();
  m.start(0);
  const len = BEATS[0].clock[1] - BEATS[0].clock[0];
  m.event('over', 0); // a finished tutorial holds nothing
  assert.equal(m.holding(0), false);
  const n = new FirstFive();
  n.start(0);
  n.gesture('claim', len - 10); // not this beat's gesture: no effect
  assert.equal(n.holding(len), false);
  const o = new FirstFive({ beats: [{ ...BEATS[2], count: 1, state: false }] });
  o.start(0);
  const dlen = BEATS[2].clock[1] - BEATS[2].clock[0];
  o.gesture('draw', dlen - 1); // answered just inside the window; the payoff is owed
  assert.equal(o.holding(dlen + PAYOFF_MS - 2), true, 'waiting for the payoff it asked for');
  assert.equal(o.poll(dlen - 1 + PAYOFF_MS), null, 'the fallback ends the (only) beat');
  assert.equal(o.holding(dlen + PAYOFF_MS), false);
});

test('release() reports the hand-back once, so the held line can be said then', () => {
  const m = new FirstFive();
  m.start(0);
  const len = BEATS[0].clock[1] - BEATS[0].clock[0];
  assert.equal(m.release(len - 1), false);
  assert.equal(m.release(len), true, 'the window just ended');
  assert.equal(m.release(len + 1), false, 'once, not every frame');
  m.gesture('place', len + 2);
  m.event('placed', len + 2); // the next beat takes the voice again...
  const len1 = BEATS[1].clock[1] - BEATS[1].clock[0];
  assert.equal(m.release(len + 3), false);
  assert.equal(m.release(len + 2 + len1), true, '...and hands it back at the end of its own window');
  m.event('over', len + 2 + len1 + 1);
  assert.equal(m.release(len + 2 + len1 + 2), false, 'already handed back');
});
