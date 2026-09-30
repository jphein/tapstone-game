// The two ways in (0039: "the judged build offers both"): mixed reality, where the player's room is
// the Tea House and only the doors appear, and full VR, the lantern-lit interior. Mixed reality is
// the default (judges score "passthrough should be purposeful"); full VR is the second choice; a
// device with only one mode still gets that one.
// Run: node --test test/entry.test.js from rust/tapstone-web/www/xr (Node 20+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MR, VR, entryPlan, roomFor, supportedModes } from '../src/logic/entry.js';

test('both modes: mixed reality is offered and listed first, full VR second', () => {
  const p = entryPlan({ ar: true, vr: true });
  assert.equal(p.offer, MR, 'the browser offers mixed reality');
  assert.deepEqual(p.entries.map((e) => e.mode), [MR, VR]);
  assert.equal(p.entries[0].primary, true);
  assert.equal(p.entries[1].primary, false);
  for (const e of p.entries) assert.ok(e.label && e.hint, `${e.mode} is labelled`);
});

test('no immersive-ar: full VR is offered and is the only entry', () => {
  const p = entryPlan({ ar: false, vr: true });
  assert.equal(p.offer, VR);
  assert.deepEqual(p.entries.map((e) => e.mode), [VR]);
  assert.equal(p.entries[0].primary, true);
});

test('no immersive-vr: mixed reality alone', () => {
  const p = entryPlan({ ar: true, vr: false });
  assert.equal(p.offer, MR);
  assert.deepEqual(p.entries.map((e) => e.mode), [MR]);
});

test('neither: nothing offered, nothing listed', () => {
  const p = entryPlan({ ar: false, vr: false });
  assert.equal(p.offer, null);
  assert.deepEqual(p.entries, []);
});

test('the room follows the session the person is in, by its blend mode', () => {
  assert.equal(roomFor({ environmentBlendMode: 'opaque' }), 'interior');
  assert.equal(roomFor({ environmentBlendMode: 'alpha-blend' }), 'doors');
  assert.equal(roomFor({ environmentBlendMode: 'additive' }), 'doors');
  assert.equal(roomFor(null), null, 'no session, no room');
});

test('support is asked of navigator.xr for each mode, and a failure counts as unsupported', async () => {
  const asked = [];
  const xr = { isSessionSupported: async (m) => (asked.push(m), m === VR) };
  assert.deepEqual(await supportedModes(xr), { ar: false, vr: true });
  assert.deepEqual(asked.sort(), [MR, VR].sort());
  const broken = { isSessionSupported: async () => { throw new Error('SecurityError'); } };
  assert.deepEqual(await supportedModes(broken), { ar: false, vr: false });
  assert.deepEqual(await supportedModes(undefined), { ar: false, vr: false }, 'no WebXR at all');
});
