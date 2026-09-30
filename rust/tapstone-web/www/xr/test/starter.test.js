// No IWSDK starter content in the build: the starter's "Hello, Immersive Web!" welcome panel sat in
// the scene JSON and floated over the board in every capture (found by the capture lane,
// 2026-09-28). The scene holds only what the game adds. Run: node --test test/starter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scene = JSON.parse(readFileSync(join(root, 'public/scenes/main.iwsdk.scene.json'), 'utf8'));

test('the scene carries no starter nodes', () => {
  const ids = scene.nodes.map((n) => n.id);
  assert.deepEqual(ids.filter((id) => /welcome/i.test(id)), []);
  assert.deepEqual(scene.nodes.filter((n) => n.content?.type === 'asset'), [],
    'no scene node loads a starter asset; the game builds its own objects in its systems');
});

test('no starter panel text ships under public/', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const hits = walk(join(root, 'public'))
    .filter((f) => /\.(uikitml|json|html)$/u.test(f))
    .filter((f) => /Immersive Web/u.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});
