// The committed engine fixture (tapstone_web.wasm) carries no build machine's home path: rebuild it with
// --remap-path-prefix (tools/freeze_contest.py's flags, and $HOME=/home/user), because the repo is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test('the wasm fixture names no real home directory', () => {
  const text = readFileSync(join(here, 'fixtures/tapstone_web.wasm')).toString('latin1');
  const homes = [...new Set([...text.matchAll(/\/home\/([a-z0-9_-]+)\//g)].map((m) => m[1]))];
  assert.ok(text.length > 100_000, 'the fixture is a real engine build');
  assert.deepEqual(homes.filter((h) => h !== 'user'), [], `home paths in the fixture: ${homes.join(', ')}`);
});
