// Build metadata doesn't ship (tools/vite-no-dotfiles.mjs): vite copies all of public/, dotfiles
// included, and public/kws holds the tooling's .gitignore and .install stamp. The public deploy
// refuses any dotfile but .nojekyll (tools/pages_deploy.py). Real vite, on a tiny project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { ALLOWED_DOTFILES, dotfilesIn, noDotfiles } from '../tools/vite-no-dotfiles.mjs';

const XR = join(dirname(fileURLToPath(import.meta.url)), '..');

function project() {
  // realpath: a symlinked TMPDIR (familiar's /var/tmp/ftarget/tmp) makes vite see two paths for one file.
  const root = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'dotfiles-')));
  writeFileSync(join(root, 'index.html'), '<!doctype html><script type="module" src="./main.js"></script>');
  writeFileSync(join(root, 'main.js'), 'console.log(1);');
  mkdirSync(join(root, 'public/kws/.cache'), { recursive: true });
  writeFileSync(join(root, 'public/kws/.gitignore'), 'kws.wasm\n');
  writeFileSync(join(root, 'public/kws/.install'), '{"id":"x"}\n');
  writeFileSync(join(root, 'public/kws/.cache/blob'), 'x');
  writeFileSync(join(root, 'public/kws/keywords.txt'), 'DRAW\n');
  writeFileSync(join(root, 'public/.env'), 'DOTENV_FIXTURE=1\n'); // any dotfile, e.g. a stray .env
  writeFileSync(join(root, 'public/CREDITS.md'), '# credits\n');
  return root;
}
const viteBuild = (root, plugins) => build({ root, logLevel: 'silent', configFile: false, plugins, build: { outDir: 'dist', emptyOutDir: true } });

test('no dotfile is allowed in the page today', () => {
  assert.deepEqual([...ALLOWED_DOTFILES], []);
});

test('a real vite build with the plugin ships public/\'s files and none of its dotfiles', async () => {
  const root = project();
  try {
    await viteBuild(root, [noDotfiles()]);
    const dist = join(root, 'dist');
    assert.deepEqual(dotfilesIn(dist), []);
    assert.equal(readFileSync(join(dist, 'kws/keywords.txt'), 'utf8'), 'DRAW\n');
    assert.ok(existsSync(join(dist, 'CREDITS.md')));
    assert.ok(existsSync(join(root, 'public/kws/.install')), 'the tooling keeps its files in public/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the control: without the plugin, vite ships them (so the test above can see the difference)', async () => {
  const root = project();
  try {
    await viteBuild(root, []);
    assert.deepEqual(dotfilesIn(join(root, 'dist')), ['.env', 'kws/.cache', 'kws/.gitignore', 'kws/.install']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an allowed dotfile is kept, and only that one', async () => {
  const root = project();
  try {
    await viteBuild(root, [noDotfiles({ allow: new Set(['.install']) })]);
    assert.deepEqual(readdirSync(join(root, 'dist/kws')).sort(), ['.install', 'keywords.txt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the headset build uses it (vite.config.js)', () => {
  const cfg = readFileSync(join(XR, 'vite.config.js'), 'utf8');
  assert.match(cfg, /import \{ noDotfiles \} from '\.\/tools\/vite-no-dotfiles\.mjs'/);
  assert.match(cfg, /plugins: \[[^\]]*noDotfiles\(\)[^\]]*\]/);
});

test('the real dist/, when built, has no dotfile', { skip: existsSync(join(XR, 'dist')) ? false : 'no dist/ (run vite build)' }, () => {
  assert.deepEqual(dotfilesIn(join(XR, 'dist')), []);
});
