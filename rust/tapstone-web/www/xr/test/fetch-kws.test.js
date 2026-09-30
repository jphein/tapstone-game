// tools/fetch_kws.mjs: every byte of the keyword spotter is pinned; the derived encoder is built from
// pinned inputs with a pinned quantizer and checked against its own pin; every request times out; an
// offline --from copy is checked against the same pins; and the install is atomic, so a failure at
// any step (a wrong byte, a timeout, a full disk) leaves the installed files exactly as they were.
// Offline: fake sources, a fake fetch and a fake build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD, DIRS, KWS_FILES, SOURCES, STAMP, buildEncoder, check, cleanEnv, fetchAll, installProblems, stagingOf } from '../tools/fetch_kws.mjs';
import { execFileSync } from 'node:child_process';

const XR = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const temp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'kws-test-'));
const quiet = () => {};

// A world: two install dirs holding "old" files and a committed file, three sources (one a build
// input), and a fake build whose output is pinned.
function world() {
  const root = temp();
  const dirs = { kws: join(root, 'public/kws'), tools: join(root, 'tools/.kws') };
  mkdirSync(dirs.kws, { recursive: true });
  mkdirSync(dirs.tools, { recursive: true });
  writeFileSync(join(dirs.kws, 'a.bin'), 'old a');
  writeFileSync(join(dirs.kws, 'kws-worker.js'), 'committed');
  writeFileSync(join(dirs.tools, 'bpe.model'), 'old bpe');
  const bytes = { a: Buffer.from('new a'), bpe: Buffer.from('new bpe'), fp32: Buffer.from('fp32 weights') };
  const sources = [
    { url: 'https://example.test/r/a.bin', to: 'a.bin', sha256: sha(bytes.a) },
    { url: 'https://example.test/r/bpe.model', to: 'bpe.model', dir: 'tools', sha256: sha(bytes.bpe) },
    { url: 'https://example.test/r/enc.fp32', id: 'enc', sha256: sha(bytes.fp32) },
  ];
  const built = Buffer.from('built from fp32 weights');
  const build = { input: 'enc', to: 'encoder.int8.onnx', sha256: sha(built) };
  const buildImpl = (input, work) => {
    assert.equal(readFileSync(input).toString(), 'fp32 weights', 'the build gets the pinned input');
    writeFileSync(join(work, 'out.onnx'), built);
    return join(work, 'out.onnx');
  };
  const served = new Map(sources.map((s) => [s.url, s.url.endsWith('a.bin') ? bytes.a : s.url.endsWith('bpe.model') ? bytes.bpe : bytes.fp32]));
  const serve = (map = served) => async (url) => (map.has(url) ? { ok: true, arrayBuffer: async () => map.get(url) } : { ok: false, status: 404 });
  // The install stamp's content is its own test; here only whether it is there.
  const files = (d) => (existsSync(d) ? Object.fromEntries(readdirSync(d).sort().map((n) => [n, n === STAMP ? 'stamp' : readFileSync(join(d, n), 'utf8')])) : null);
  const state = () => ({
    kws: files(dirs.kws),
    tools: files(dirs.tools),
    leftovers: readdirSync(join(root, 'public')).concat(readdirSync(join(root, 'tools'))).filter((n) => /\.(new|old)-/.test(n))
      .concat(existsSync(join(root, '.kws-staging')) ? readdirSync(join(root, '.kws-staging')) : []),
  });
  const pins = { 'kws/a.bin': sha(bytes.a), 'tools/bpe.model': sha(bytes.bpe), 'kws/encoder.int8.onnx': sha(built) };
  return { root, dirs, sources, build, buildImpl, served, serve, state, pins, done: () => rmSync(root, { recursive: true, force: true }) };
}
const OLD = { kws: { 'a.bin': 'old a', 'kws-worker.js': 'committed' }, tools: { 'bpe.model': 'old bpe' }, leftovers: [] };

test('the pins: every page file, the built encoder, fixed revisions, no GigaSpeech, an exact quantizer', () => {
  for (const f of ['kws.wasm', 'kws-glue.js', 'kws-api.js', 'encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']) {
    assert.match(KWS_FILES[`kws/${f}`] ?? '', /^[0-9a-f]{64}$/, f);
  }
  assert.equal(KWS_FILES['kws/encoder.int8.onnx'], BUILD.sha256, 'the shipped encoder is the built one');
  assert.ok(SOURCES.filter((s) => !s.files).every((s) => /resolve\/[0-9a-f]{40}\//.test(s.url)), 'model files at fixed revisions');
  assert.ok(!JSON.stringify(SOURCES).includes('gigaspeech'), 'no GigaSpeech-trained weights (non-commercial terms)');
  assert.equal(SOURCES.find((s) => s.id === BUILD.input)?.url.endsWith('encoder-epoch-99-avg-1.onnx'), true, 'the build starts from the fp32 export');
  assert.equal(BUILD.recipe, 'matmul-table');
  const req = readFileSync(BUILD.requirements, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.ok(req.length >= 10);
  for (const l of req) assert.match(l, /^[a-z0-9-]+==[0-9][0-9a-z.]* --hash=sha256:[0-9a-f]{64}$/, l);
  for (const p of ['onnxruntime==1.23.2', 'onnx==1.19.1', 'numpy==2.3.3']) assert.ok(req.some((l) => l.startsWith(`${p} `)), p);
});

test('the committed token list is the pinned one (it must match the model)', () => {
  assert.equal(sha(readFileSync(join(XR, 'public/kws/tokens.txt'))), KWS_FILES['kws/tokens.txt']);
});

test('a good run installs the new files and the build, and keeps the directory\'s committed files', async () => {
  const w = world();
  try {
    await fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(), log: quiet });
    assert.deepEqual(w.state(), {
      kws: { [STAMP]: 'stamp', 'a.bin': 'new a', 'encoder.int8.onnx': 'built from fp32 weights', 'kws-worker.js': 'committed' },
      tools: { [STAMP]: 'stamp', 'bpe.model': 'new bpe' },
      leftovers: [],
    });
  } finally {
    w.done();
  }
});

test('one wrong byte anywhere installs nothing', async () => {
  const w = world();
  try {
    const bad = new Map(w.served);
    bad.set(w.sources[1].url, Buffer.from('new bpe, changed upstream'));
    await assert.rejects(fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(bad), log: quiet }), /sha256 .* pinned/);
    assert.deepEqual(w.state(), OLD);
  } finally {
    w.done();
  }
});

test('(b) a source that never answers times out, and installs nothing', { timeout: 5000 }, async () => {
  const w = world();
  try {
    const hang = async (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const t0 = Date.now();
    await assert.rejects(fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: hang, timeoutMs: 80, log: quiet }), /no complete answer within 80 ms/);
    assert.ok(Date.now() - t0 < 5000);
    assert.deepEqual(w.state(), OLD);
  } finally {
    w.done();
  }
});

test('(b) a body that stalls after the headers times out too', { timeout: 5000 }, async () => {
  const w = world();
  try {
    const stall = async (url, { signal }) => ({ ok: true, arrayBuffer: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
    await assert.rejects(fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: stall, timeoutMs: 80, log: quiet }), /no complete answer/);
    assert.deepEqual(w.state(), OLD);
  } finally {
    w.done();
  }
});

test('(c) a disk that fills up mid-install leaves the old directories whole, and no temp dirs', async () => {
  const w = world();
  try {
    let n = 0;
    const full = (from, to) => {
      if (++n === 3) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      copyFileSync(from, to);
    };
    await assert.rejects(fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(), copy: full, log: quiet }), /ENOSPC/);
    assert.deepEqual(w.state(), OLD);
  } finally {
    w.done();
  }
});

test('(a) --from: a local copy installs with no network, checked against the same pins', async () => {
  const w = world();
  const from = temp();
  try {
    for (const s of w.sources) writeFileSync(join(from, basename(s.url)), w.served.get(s.url));
    const noNetwork = async () => {
      throw new Error('the network was used');
    };
    await fetchAll({ dirs: w.dirs, from, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: noNetwork, log: quiet });
    assert.equal(w.state().kws['a.bin'], 'new a');
    // A copy with a wrong byte, or a missing file, installs nothing.
    writeFileSync(join(w.dirs.kws, 'a.bin'), 'old a');
    writeFileSync(join(from, 'a.bin'), 'tampered');
    await assert.rejects(fetchAll({ dirs: w.dirs, from, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: noNetwork, log: quiet }), /sha256 .* pinned/);
    assert.equal(w.state().kws['a.bin'], 'old a');
    rmSync(join(from, 'a.bin'));
    await assert.rejects(fetchAll({ dirs: w.dirs, from, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: noNetwork, log: quiet }), /not in the --from copy/);
  } finally {
    w.done();
    rmSync(from, { recursive: true, force: true });
  }
});

test('--save keeps every source under its own name, ready for --from', async () => {
  const w = world();
  const save = temp();
  try {
    await fetchAll({ dirs: w.dirs, save, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(), log: quiet });
    assert.deepEqual(readdirSync(save).sort(), ['a.bin', 'bpe.model', 'enc.fp32']);
  } finally {
    w.done();
    rmSync(save, { recursive: true, force: true });
  }
});

test('the build refuses another interpreter, and refuses output that misses its pin', () => {
  const work = temp();
  try {
    const build = { ...BUILD, sha256: sha(Buffer.from('the pinned bytes')) };
    const runs = [];
    const fake = (py, version) => (cmd, args, opts) => {
      const a = args.filter((x) => x !== '-I'); // every Python is run isolated
      assert.equal(args[0], '-I', `${cmd} ${args.join(' ')}: not isolated`);
      assert.equal(opts.env.PIP_CONFIG_FILE, '/dev/null');
      runs.push([cmd, a[0]]);
      if (a[0] === '-c') return `${version} linux-x86_64\n`;
      if (a[0] === build.script) writeFileSync(a[2], 'other bytes');
      return '';
    };
    assert.throws(() => buildEncoder('in.onnx', work, { build, run: fake('python3', '3.13'), log: quiet }), /pinned to CPython 3.12/);
    assert.throws(() => buildEncoder('in.onnx', work, { build, run: fake('python3', '3.12'), log: quiet }), /sha256 .* pinned .* different quantizer/);
    assert.ok(runs.some(([, a]) => a === build.script), 'the quantizer ran');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});


// ---- the Oracle's #205 findings ------------------------------------------------------------------

test('1. the build environment drops every PYTHON* and PIP_* variable, and pip reads no config', () => {
  const env = cleanEnv({ PATH: '/usr/bin', HOME: '/h', PYTHONPATH: '/poison', PYTHONHOME: '/x', PYTHONSTARTUP: '/s.py', PYTHONINSPECT: '1', PIP_INDEX_URL: 'https://evil.test/simple', PIP_CONFIG_FILE: '/home/me/pip.conf', TMPDIR: '/t' });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/h', TMPDIR: '/t', PIP_CONFIG_FILE: '/dev/null', PYTHONNOUSERSITE: '1' });
});

// A real Python, poisoned the way the Oracle did it: PYTHONPATH at a directory with a sitecustomize
// (which Python runs at startup) and a fake onnx. The build's Python steps must not run either. The
// build then stops at pip (an empty --from copy has no wheels), after the probe and the venv ran.
test('1. a PYTHONPATH poison (sitecustomize, a fake onnx) is ignored by the build\'s Python', () => {
  const root = temp();
  const saved = process.env.PYTHONPATH;
  try {
    const poison = join(root, 'poison');
    const marker = join(root, 'POISON-RAN');
    mkdirSync(join(poison, 'onnx'), { recursive: true });
    const code = `open(${JSON.stringify(marker)}, 'a').write('ran\\n')\n`;
    writeFileSync(join(poison, 'sitecustomize.py'), code);
    writeFileSync(join(poison, 'onnx/__init__.py'), code);
    // Positive control: the poison does run for a plain python3 with this PYTHONPATH.
    execFileSync('python3', ['-c', 'import onnx'], { env: { ...process.env, PYTHONPATH: poison } });
    assert.ok(existsSync(marker), 'control: the poison runs when not isolated');
    rmSync(marker);
    const [version, platform] = execFileSync('python3', ['-I', '-c', 'import sys, sysconfig; print("%d.%d" % sys.version_info[:2], sysconfig.get_platform())'], { encoding: 'utf8' }).trim().split(' ');
    const from = join(root, 'from');
    mkdirSync(join(from, 'wheels'), { recursive: true });
    process.env.PYTHONPATH = poison;
    assert.throws(() => buildEncoder('in.onnx', join(root, 'work'), { from, build: { ...BUILD, python: { version, platform } }, log: quiet, timeoutMs: 60000 }));
    assert.ok(!existsSync(marker), 'the poison ran inside the build');
  } finally {
    if (saved === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = saved;
    rmSync(root, { recursive: true, force: true });
  }
});

// A pip that hangs (a fake interpreter whose venv python sleeps 30 s on "-m pip download"): killed at
// the build timeout, and the build throws. (execFileSync blocks, so without a timeout this test
// can't be cut short by its own: it fails at ~30 s on the elapsed-time and error checks instead.)
test('2. a hung pip download is killed at the timeout, and the build fails closed', () => {
  const root = temp();
  const saved = process.env.KWS_PYTHON;
  try {
    const pidFile = join(root, 'pip.pid');
    const fake = join(root, 'python3');
    writeFileSync(fake, `#!/bin/sh
case "$*" in
  *-c*) echo "3.12 linux-x86_64" ;;
  *"-m venv"*) d="$4"; mkdir -p "$d/bin"; printf '#!/bin/sh\\ncase "$*" in *download*) echo $$ > ${pidFile}; exec sleep 30 ;; esac\\nexit 1\\n' > "$d/bin/python"; chmod +x "$d/bin/python" ;;
esac
`, { mode: 0o755 });
    process.env.KWS_PYTHON = fake;
    const t0 = Date.now();
    assert.throws(() => buildEncoder('in.onnx', join(root, 'work'), { build: { ...BUILD, python: { version: '3.12', platform: 'linux-x86_64' } }, log: quiet, timeoutMs: 500 }), (e) => e.code === 'ETIMEDOUT' || /ETIMEDOUT|SIGKILL/.test(String(e)));
    assert.ok(Date.now() - t0 < 10000, 'killed near the timeout');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the hung pip is gone');
  } finally {
    if (saved === undefined) delete process.env.KWS_PYTHON;
    else process.env.KWS_PYTHON = saved;
    rmSync(root, { recursive: true, force: true });
  }
});

test('3. staging lives beside public/, never inside it (vite copies all of public/)', () => {
  const pub = dirname(DIRS.kws);
  assert.ok(!stagingOf(DIRS).startsWith(pub + '/'), stagingOf(DIRS));
  assert.equal(dirname(stagingOf(DIRS)), dirname(pub), 'same parent as public/: the same filesystem, so a rename');
});

test('3. tools/.kws is swapped first; both get the same stamp, and a later install replaces it', async () => {
  const w = world();
  try {
    const order = [];
    await fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(), afterRename: (d, step) => order.push(`${d}:${step}`), log: quiet });
    assert.deepEqual(order, ['tools:aside', 'tools:in', 'kws:aside', 'kws:in']);
    const k = readFileSync(join(w.dirs.kws, STAMP), 'utf8');
    assert.equal(k, readFileSync(join(w.dirs.tools, STAMP), 'utf8'));
    assert.deepEqual(JSON.parse(k).pins, w.pins);
    assert.deepEqual(installProblems(w.dirs, { strict: true }), []);
  } finally {
    w.done();
  }
});

test('3. a kill between renames: a missing public/kws is refused, and its old copy is not under public/', async () => {
  const w = world();
  try {
    const kill = (d, step) => {
      if (d === 'kws' && step === 'aside') throw new Error('SIGKILL');
    };
    await assert.rejects(fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(), afterRename: kill, log: quiet }), /SIGKILL/);
    assert.equal(existsSync(w.dirs.kws), false);
    assert.deepEqual(readdirSync(join(w.root, 'public')), [], 'nothing under public/ for vite to ship');
    const bad = installProblems(w.dirs).join(' | ');
    assert.match(bad, /lost its committed files/);
    assert.match(bad, /interrupted install/);
  } finally {
    w.done();
  }
});

test('3. a kill after tools/.kws but before public/kws: the mixed install is refused', async () => {
  const w = world();
  try {
    await fetchAll({ dirs: w.dirs, sources: w.sources, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(), log: quiet });
    // A second install with a different model, killed once tools/.kws is in.
    const other = w.sources.map((s) => ({ ...s }));
    const bpe2 = Buffer.from('newer bpe');
    other[1].sha256 = sha(bpe2);
    const served = new Map(w.served);
    served.set(other[1].url, bpe2);
    const kill = (d, step) => {
      if (d === 'tools' && step === 'in') throw new Error('SIGKILL');
    };
    await assert.rejects(fetchAll({ dirs: w.dirs, sources: other, build: w.build, buildImpl: w.buildImpl, fetchImpl: w.serve(served), afterRename: kill, log: quiet }), /SIGKILL/);
    // (The staging dir still holds the unswapped public/kws; clear it to see the mixed stamp alone.)
    rmSync(join(w.root, '.kws-staging'), { recursive: true, force: true });
    assert.deepEqual(installProblems(w.dirs), ['public/kws and tools/.kws are from different installs']);
  } finally {
    w.done();
  }
});

test('3. check() refuses a legacy public/kws.old-* left by the #205 layout (it would ship)', () => {
  const w = world();
  try {
    mkdirSync(join(w.root, 'public/kws.old-123'));
    assert.match(installProblems(w.dirs).join(' | '), /kws\.old-123: a leftover inside public\//);
    assert.ok(check(w.dirs).length > 0);
  } finally {
    w.done();
  }
});
