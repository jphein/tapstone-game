// The payoff sounds (VR spec 2026-09-25 §8, M2: "the effects, built in beat order, with sound per
// beat"): which view-diff event makes which sound (src/logic/sfx.js), and that every sound is short,
// quiet enough and synthesized (no clip, so no licence). Run: node --test test/sfx.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { diffViews, DURATION } from '../src/logic/effects.js';
import { SOUNDS, SILENT, SOURCE, WAVES, soundFor, soundLength, soundPeak } from '../src/logic/sfx.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '../../../../tapstone-arena/web/fixtures/desk-seed11.jsonl');
const views = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// The payoffs the lane was asked for, by the name each sound carries.
const PAYOFFS = ['draw', 'charge', 'summon', 'clash', 'kill', 'keepChip', 'win', 'lose'];

// Every sound the real desk match makes, heard from `near`'s seat.
function heard(near) {
  const out = new Map();
  for (let i = 1; i < views.length; i++) {
    for (const e of diffViews(views[i - 1], views[i], near)) {
      const s = soundFor(e, near);
      if (s) out.set(s, (out.get(s) ?? 0) + 1);
    }
  }
  return out;
}

test('every payoff has a sound, and every sound is one of the payoffs', () => {
  assert.deepEqual(Object.keys(SOUNDS).sort(), [...PAYOFFS].sort());
});

test('every effect type either sounds or is named silent, never both (fails closed both ways)', () => {
  const probe = (type) => soundFor({ type, seat: 0, winner: 0 }, 0);
  for (const type of Object.keys(DURATION)) {
    const s = probe(type);
    if (SILENT.includes(type)) assert.equal(s, null, `${type} is listed silent but sounds (${s})`);
    else assert.ok(s, `${type} neither sounds nor is listed silent`);
  }
  for (const type of SILENT) assert.ok(type in DURATION, `${type} is listed silent but is no effect type`);
});

test('the event → sound mapping', () => {
  assert.equal(soundFor({ type: 'drawFlip', seat: 0, card: 3 }, 0), 'draw');
  assert.equal(soundFor({ type: 'chargeGem', seat: 1 }, 0), 'charge');
  assert.equal(soundFor({ type: 'summon', seat: 0, commander: true }, 0), 'summon');
  assert.equal(soundFor({ type: 'clash', lane: 1 }, 0), 'clash');
  assert.equal(soundFor({ type: 'death', seat: 1 }, 0), 'kill');
  assert.equal(soundFor({ type: 'keepChip', seat: 1, amount: 2 }, 0), 'keepChip');
  assert.equal(soundFor({ type: 'result', winner: 0 }, 0), 'win', 'my seat won');
  assert.equal(soundFor({ type: 'result', winner: 1 }, 0), 'lose', 'the other seat won');
  assert.equal(soundFor({ type: 'result', winner: 1 }, 1), 'win', 'heard from seat 1');
  assert.equal(soundFor({ type: 'result', winner: null }, 0), null, 'a void match is neither');
  assert.equal(soundFor({ type: 'advance', seat: 0 }, 0), null);
  assert.equal(soundFor(null, 0), null);
});

test('the real desk match (seed 11) sounds every payoff, from one seat or the other', () => {
  const a = heard(0), b = heard(1);
  for (const s of PAYOFFS) assert.ok((a.get(s) ?? 0) + (b.get(s) ?? 0) > 0, `${s} never sounds in the desk match`);
  assert.equal(a.get('win'), 1, 'seat 0 won the desk match, once');
  assert.equal(b.get('lose'), 1, 'and seat 1 heard it lost');
  // The same events sound from either seat; only the result's word differs.
  for (const s of PAYOFFS.filter((p) => p !== 'win' && p !== 'lose')) assert.equal(a.get(s), b.get(s), s);
});

test("each sound ends before its effect does, so one sound plays at a time (the queue's order)", () => {
  for (const [name, type] of Object.entries(SOURCE)) {
    assert.equal(soundFor({ type, seat: 0, winner: name === 'lose' ? 1 : 0 }, 0), name, `${name} is ${type}'s sound`);
    const len = soundLength(SOUNDS[name]) * 1000;
    assert.ok(len <= DURATION[type], `${name}: ${len} ms against ${type}'s ${DURATION[type]} ms`);
  }
});

test('headroom: the voices of one sound peak at most 0.8 together, so nothing clips', () => {
  for (const [name, s] of Object.entries(SOUNDS)) {
    assert.ok(soundPeak(s) <= 0.8, `${name} peaks at ${soundPeak(s)}`);
    assert.ok(soundPeak(s) >= 0.1, `${name} is audible (${soundPeak(s)})`);
  }
});

test('every voice is a synthesized wave in the audible band: no clips, no licensing', () => {
  for (const [name, s] of Object.entries(SOUNDS)) {
    assert.ok(s.voices.length >= 1, name);
    for (const v of s.voices) {
      assert.ok(WAVES.includes(v.wave), `${name}: wave ${v.wave}`);
      for (const f of [v.f0, v.f1 ?? v.f0]) assert.ok(f >= 60 && f <= 8000, `${name}: ${f} Hz`);
      assert.ok(v.at >= 0 && v.dur > 0, `${name}: timing`);
    }
  }
  // No two payoffs sound the same.
  const seen = new Set(Object.values(SOUNDS).map((s) => JSON.stringify(s)));
  assert.equal(seen.size, Object.keys(SOUNDS).length);
});

test('win rises and lose falls, so the result is legible without the words', () => {
  const pitch = (s) => s.voices.map((v) => [v.at, v.f0]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const w = pitch(SOUNDS.win), l = pitch(SOUNDS.lose);
  assert.ok(w[w.length - 1] > w[0], `win ${w}`);
  assert.ok(l[l.length - 1] < l[0], `lose ${l}`);
});
