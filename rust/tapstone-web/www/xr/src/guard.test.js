// guard.test.js: the hands-only guard (spec 2026-09-25 §3.2 after #128). Run: node --test src/guard.test.js
// On JP's Quest 2 hand tracking was off and the first spike run was all controller selects that
// nobody noticed; the contest build must be completable without a controller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handsGuard, PUT_DOWN } from './guard.js';

const hand = { hand: {} };
const pad = { hand: null, gamepad: {} };

test('hands only: nothing is blocked', () => {
  assert.deepEqual(handsGuard([hand, hand]), { blocked: false, message: null });
});

test('a controller blocks, with the put-it-down line', () => {
  assert.deepEqual(handsGuard([pad, pad]), { blocked: true, message: PUT_DOWN });
});

test('one hand and one controller (auto-switch half way) still blocks', () => {
  assert.equal(handsGuard([hand, pad]).blocked, true);
});

test('no sources (hands out of view for a moment, or no XR yet) does not block', () => {
  assert.deepEqual(handsGuard([]), { blocked: false, message: null });
  assert.deepEqual(handsGuard(undefined), { blocked: false, message: null });
});

test('the line tells the person what to do', () => {
  assert.match(PUT_DOWN, /controllers? down/i);
});
