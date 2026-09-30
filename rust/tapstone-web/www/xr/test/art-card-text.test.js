// A hand card's words (src/art/card-text.js), from tapstone-web's HandCard Debug names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectText, keywordText, rulesText } from '../src/art/card-text.js';

test('effects read as sentences, with the numbers the rules crate gives', () => {
  assert.equal(effectText('Damage { amount: 3, castle_ok: true }'), 'Deal 3 damage to a unit or a castle.');
  assert.equal(effectText('Damage { amount: 2, castle_ok: false }'), 'Deal 2 damage to a unit.');
  assert.equal(effectText('Heal { amount: 2 }'), 'Heal 2.');
  assert.equal(effectText('Destroy { max_toughness: 2 }'), 'Destroy a unit with toughness 2 or less.');
  assert.equal(effectText('Shift'), 'Move a unit one lane.');
  assert.equal(effectText('Draw { count: 1 }'), 'Draw a card.');
  assert.equal(effectText('Draw { count: 2 }'), 'Draw 2 cards.');
  assert.equal(effectText('Unknown'), 'Unknown');
});

test('keywords and kinds', () => {
  assert.equal(keywordText('Shield1'), 'Shield');
  assert.equal(keywordText(null), '');
  assert.equal(rulesText({ kind: 'unit', keyword: 'Rush' }), 'Rush');
  assert.equal(rulesText({ kind: 'spell', effect: 'Heal { amount: 2 }' }), 'Heal 2.');
  assert.equal(rulesText({ kind: 'castle' }), 'Your castle');
});
