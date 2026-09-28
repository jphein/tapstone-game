// lore.test.js: the Tea House's names come from JP's canon, and nothing else passes as canon (0039).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANON_REALMS, DOOR_LORE, TEAHOUSE_KEEPER, TEAHOUSE_NAME } from '../src/logic/lore.js';
import { DOORS } from '../src/logic/layout.js';

test('lore: the canon names, the ruled pairing, and every non-canon look marked PROPOSAL', () => {
  // bible Part II: The Realms, all six; 0039's ruling pairs Tide, Ember and neutral with three of them.
  assert.deepEqual(CANON_REALMS, ['The Hearthlands', 'The Deep Tides', 'The Forge Peaks', 'The Wandering Courts', 'The Star Fields', 'The Dreaming']);
  assert.equal(DOOR_LORE.tide.name, 'The Deep Tides');
  assert.equal(DOOR_LORE.ember.name, 'The Forge Peaks');
  assert.equal(DOOR_LORE.neutral.name, 'The Hearthlands', 'neutral = the Hearthlands (JP, 2026-09-27)');
  assert.equal(TEAHOUSE_NAME, 'The Tea House');
  let proposals = 0;
  for (const d of DOORS) {
    const lore = DOOR_LORE[d.faction];
    assert.ok(lore, `${d.faction}: a door with no lore`);
    assert.ok(CANON_REALMS.includes(lore.name), `${d.faction}: ${lore.name} isn't a canon realm`);
    assert.ok(!/LORE:/.test(JSON.stringify(lore)), `${d.faction}: an unfilled LORE slot`);
    const { look } = lore;
    assert.equal(typeof look.frame, 'number', `${d.faction}: the look has a frame colour to draw`);
    // Exactly one of the two marks: a cited bible section, or PROPOSAL for JP.
    const cited = typeof look.source === 'string' && /^bible /.test(look.source);
    assert.ok(cited !== (look.proposal === true), `${d.faction}: its look is neither cited canon nor marked PROPOSAL (or both)`);
    if (look.proposal) proposals += 1;
  }
  // The bible states the Deep Tides' door (blue, water motifs) but not the Forge Peaks' door.
  assert.equal(DOOR_LORE.tide.look.proposal, undefined, 'the Deep Tides door is canon');
  assert.equal(DOOR_LORE.ember.look.proposal, true, 'the Forge Peaks door is a proposal');
  assert.equal(DOOR_LORE.neutral.look.proposal, true, 'the Hearthlands door is a proposal');
  assert.equal(proposals, 2, 'proposals counted');
  // The keeper: the bible names none; the house's own awareness keeps it, and the lintel names no one.
  assert.equal(TEAHOUSE_KEEPER.named, null);
  assert.equal(TEAHOUSE_KEEPER.onLintel, false);
  assert.match(TEAHOUSE_KEEPER.source, /^bible /);
});
