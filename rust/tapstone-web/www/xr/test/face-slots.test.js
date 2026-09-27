// The hand's card faces (src/logic/face-slots.js): one canvas and one texture per hand slot, made
// once and repainted in place, so a repaint never leaves a texture behind on the GPU (hand.js used to
// make a new CanvasTexture per face and never dispose the one it replaced). Run: node --test test/face-slots.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceSlots } from '../src/logic/face-slots.js';

// A counting fake of three's CanvasTexture: setting needsUpdate = true bumps `version` (as three
// does), dispose() is counted, and `live` is how many were made and not yet disposed.
function factory() {
  const made = [];
  const make = () => {
    const texture = {
      version: 0,
      disposed: 0,
      set needsUpdate(v) {
        if (v) this.version++;
      },
      dispose() {
        this.disposed++;
      },
    };
    const face = { canvas: { id: made.length }, texture };
    made.push(face);
    return face;
  };
  const live = () => made.filter((f) => f.texture.disposed === 0).length;
  return { make, made, live };
}

const card = (id, name = `card ${id}`) => ({ card: id, name });

test('a repaint reuses its slot\'s texture: no texture is made, none is left behind', () => {
  const f = factory();
  const slots = new FaceSlots(3, f.make);
  assert.equal(f.made.length, 3, 'one face per slot, made up front');
  const tex = slots.texture(1);
  const drawn = [];
  const draw = (canvas, c) => drawn.push([canvas.id, c.card]);
  for (const id of [10, 11, 12, 13, 14]) assert.equal(slots.show(1, card(id), draw), true);
  assert.equal(f.made.length, 3, 'five repaints made no new texture');
  assert.equal(f.live(), 3, 'live textures stay one per slot');
  assert.equal(slots.texture(1), tex, 'the same texture object');
  assert.equal(tex.version, 5, 'each repaint marks it for upload once');
  assert.deepEqual(drawn, [[1, 10], [1, 11], [1, 12], [1, 13], [1, 14]], 'painted into the slot\'s own canvas');
  assert.equal(f.made.reduce((n, x) => n + x.texture.disposed, 0), 0, 'nothing disposed while in use');
});

test('the same card again is not repainted (the frame log counts only real paints)', () => {
  const f = factory();
  const slots = new FaceSlots(2, f.make);
  let paints = 0;
  const draw = () => paints++;
  assert.equal(slots.show(0, card(7), draw), true);
  assert.equal(slots.show(0, card(7), draw), false);
  assert.equal(slots.show(0, card(7, 'renamed'), draw), true, 'a changed name repaints');
  assert.equal(paints, 2);
  assert.equal(slots.texture(0).version, 2);
});

test('dispose frees every slot\'s texture exactly once', () => {
  const f = factory();
  const slots = new FaceSlots(4, f.make);
  slots.show(2, card(1), () => {});
  slots.dispose();
  slots.dispose();
  assert.deepEqual(f.made.map((x) => x.texture.disposed), [1, 1, 1, 1]);
  assert.equal(f.live(), 0);
});
