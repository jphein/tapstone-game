// The world art under high contrast (src/art/contrast.js, the theme hook of src/theme.js): the
// standard theme is the art's own colours, used where the art paints them; a painted or baked part
// swaps to a flat contrast material and back; and the audit names anything left unthemed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setAccess } from '../src/access.js';
import { THEMES } from '../src/logic/theme.js';
import { ART } from '../src/art/palette.js';
import { audit, flatWhenContrast, isContrast, lookProblem, onArtTheme } from '../src/art/contrast.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '../src', f), 'utf8');

// role -> [ART key, the file that paints it with that key]
const USED = {
  'altar.stone': ['stone', 'art/stone.js'], 'altar.eye': ['eye', 'altar.js'], 'altar.eyeRefuse': ['eyeRefuse', 'altar.js'],
  pad: ['pad', 'art/stone.js'], deck: ['deckEdge', 'art/card-mesh.js'], 'deck.top': ['back', 'art/card-face.js'],
  'card.edge': ['cardEdge', 'art/card-mesh.js'], 'card.face': ['parchment', 'art/card-face.js'], 'card.ink': ['ink', 'art/card-face.js'],
  'board.base': ['boardBase', 'art/board-mat.js'], 'board.near': ['boardNear', 'art/board-mat.js'], 'board.far': ['boardFar', 'art/board-mat.js'],
  'label.bg': ['labelBg', 'art/plates.js'], 'label.fg': ['labelFg', 'art/plates.js'], 'label.refuse': ['labelRefuse', 'art/plates.js'],
  'door.frame': ['doorFrame', 'art/doors.js'],
};

test('standard is the art as painted: each role equals the art\'s colour, and the art uses it', () => {
  for (const [role, [key, file]] of Object.entries(USED)) {
    assert.equal(THEMES.standard[role], ART[key], `${role} vs ART.${key}`);
    assert.match(src(file), new RegExp(`ART\\.${key}\\b`), `${file} doesn't paint with ART.${key}`);
  }
});

test('a painted part swaps to its flat contrast material and back, and painters hear the switch', () => {
  setAccess('highContrast', false);
  const painted = { name: 'stone' };
  const mesh = { material: painted };
  flatWhenContrast(mesh, 'altar.stone', (c) => ({ flat: true, color: c }));
  assert.equal(mesh.material, painted);
  const heard = [];
  onArtTheme((on) => heard.push(on));
  setAccess('highContrast', true);
  assert.equal(isContrast(), true);
  assert.equal(mesh.material.flat, true);
  assert.equal(mesh.material.color, THEMES.contrast['altar.stone']);
  assert.equal(mesh.material.userData.contrastReady, true);
  setAccess('highContrast', false);
  assert.equal(mesh.material, painted);
  assert.deepEqual(heard, [true, false]);
});

test('the audit: a plain colour must be the theme\'s; a texture, bake or shader must be handled', () => {
  assert.equal(lookProblem({ name: 'pad', color: THEMES.contrast.pad }), null);
  assert.match(lookProblem({ name: 'pad', color: 0x3d2616 }), /pad: plain colour #3d2616/);
  assert.match(lookProblem({ name: 'mat', map: true }), /painted texture/);
  assert.equal(lookProblem({ name: 'mat', map: true, mapReady: true }), null);
  assert.match(lookProblem({ name: 'frame', vertexColors: true }), /baked/);
  assert.match(lookProblem({ name: 'card', shader: true }), /shader/);
  assert.equal(lookProblem({ name: 'card', shader: true, ready: true }), null);
  const colour = (hex) => ({ getHex: () => hex });
  const problems = audit([
    ['ok', { material: { color: colour(THEMES.contrast['label.bg']) } }],
    ['untagged pad', { material: { color: colour(ART.pad) } }],
    ['ready mat', { material: { map: { userData: { contrastReady: true } }, color: colour(0xffffff) } }],
  ]);
  assert.deepEqual(problems, ['untagged pad: plain colour #3d2616 is not from the contrast theme']);
});
