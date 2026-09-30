// fetch_kws.mjs: vendor the on-device keyword spotter into public/kws/ (voice commands; design notes
// docs/superpowers/specs/2026-09-28-xr-accessibility-design.md, 2026-09-29-xr-kws-permissive-design.md,
// 2026-09-29-xr-kws-slim-design.md). Run once per clone, like copying tapstone_web.wasm (rust/README.md):
//
//   node tools/fetch_kws.mjs                 fetch, build, check every sha256, install public/kws/
//   node tools/fetch_kws.mjs --save <dir>    the same, and keep every source and wheel in <dir>
//   node tools/fetch_kws.mjs --from <dir>    the same with NO network: every source and wheel from a
//                                            --save copy, checked against the same pins
//   node tools/fetch_kws.mjs --check         only check what is installed (exit 1 if anything is wrong)
//
// Why fetched and not committed: the engine is 15 MB of wasm and the model 36 MB, and a binary in git
// history is there for good. They are still VENDORED: served from the page's own origin and fetched
// during load, so the page makes no request after "loaded" (net.js).
//
// Fails closed, three ways (the Oracle's #202 findings):
//   every source and every built file is pinned by sha256;
//   every request has a timeout (KWS_FETCH_TIMEOUT_MS, default 120 s) covering the whole body;
//   the install is staged: complete new directories are assembled and checked in xr/.kws-staging/,
//   then each is renamed into place (installAtomic says exactly what that guarantees);
//   the quantizer runs isolated (python -I, a cleaned environment, pip --only-binary :all:), with a
//   timeout on every step (the Oracle's #205 findings).
//
// Sources (public/CREDITS.md, public/licenses/):
//   sherpa-onnx 1.13.8 (npm, Apache-2.0): its prebuilt WebAssembly (the "nodejs" build, whose glue
//     runs in a browser worker through kws-node-shim.js) and the keyword spotter's JS API.
//   sherpa-onnx-streaming-zipformer-en-20M-2023-02-17 (Hugging Face csukuangfj, revision d42f2d9,
//     Apache-2.0): a streaming transducer exported from desh2608's
//     icefall-asr-librispeech-pruned-transducer-stateless7-streaming-small (revision be162ec,
//     Apache-2.0), trained on LibriSpeech 960 h (CC BY 4.0) with MUSAN noise (CC BY 4.0).
//   The ENCODER is our derived build (Apache-2.0 §4(b): modified; public/licenses/NOTICE-kws-model.txt):
//     the upstream fp32 export requantized by tools/kws_quantize.py (recipe matmul-table), under the
//     quantizer pinned by tools/kws-quantize-requirements.txt, and checked against its own pin. The
//     decoder, joiner and tokens are upstream's int8 files, unmodified.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const XR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIRS = { kws: join(XR, 'public/kws'), tools: join(XR, 'tools/.kws') };
// Where new and old directories wait during an install: beside public/, never inside it (vite copies
// all of public/, so a leftover there would ship), and on the same filesystem, so a rename is a rename.
export const stagingOf = (dirs) => dirs.staging ?? join(dirname(dirname(dirs.kws)), '.kws-staging');
export const STAMP = '.install';
const HF = 'https://huggingface.co';
const EXPORT = `${HF}/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/resolve/d42f2d9f7ca24806fb667456a18a9f1b60f70d16`;
const TRAINED = `${HF}/desh2608/icefall-asr-librispeech-pruned-transducer-stateless7-streaming-small/resolve/be162ecc09bade73063a671fad9d18220149d25b`;

// A source is an archive (`tar` and the members to take) or a single file. `dir` says which install
// directory a file goes to; a file with no `to` is an input to the build and isn't installed.
export const SOURCES = [
  {
    url: 'https://registry.npmjs.org/sherpa-onnx/-/sherpa-onnx-1.13.8.tgz',
    sha256: '15dc53065cc6bbc73ddbb1b216bccb5660233b7626460d7c62baf78e7f3c3f43',
    tar: ['xzf'],
    files: {
      'package/sherpa-onnx-wasm-nodejs.wasm': ['kws.wasm', 'a802c2e20151126789e24792b76cfc3ab9d9bda60bcd5c6a514f06eb35131a1a'],
      'package/sherpa-onnx-wasm-nodejs.js': ['kws-glue.js', '2c34f48ed8906a63cbdc24496b539e655f9383b3c49b3bda70b461d7157f2106'],
      'package/sherpa-onnx-kws.js': ['kws-api.js', '03b44e372795fd907e84eecd29419e1d052dc6704ac06935c9bf9fe19b3e3434'],
    },
  },
  // The build's input: upstream's fp32 encoder (88.8 MB, never shipped).
  { url: `${EXPORT}/encoder-epoch-99-avg-1.onnx`, id: 'encoder.fp32', sha256: 'f77a22f4ff94604e1afb2aeb13504d7699363528c047c97d3436087c95c9b659' },
  { url: `${EXPORT}/decoder-epoch-99-avg-1.int8.onnx`, to: 'decoder.int8.onnx', sha256: '21e2a2acd961b3ac72f55be2f10f1a285e1b0b0ba010d7c0b6eab141411b163c' },
  { url: `${EXPORT}/joiner-epoch-99-avg-1.int8.onnx`, to: 'joiner.int8.onnx', sha256: 'e085d73b593cf9b0707f370dbd656d58327d3fe36d80d849202ef81df02cb01e' },
  // Committed too (small): the model's token list, checked here so it can't drift from the model.
  { url: `${EXPORT}/tokens.txt`, to: 'tokens.txt', sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb' },
  // For tools/voice_keywords.py only, so kept out of public/ (vite would ship it): the word pieces
  // the model was trained with (LibriSpeech's BPE 500).
  { url: `${TRAINED}/data/lang_bpe_500/bpe.model`, to: 'bpe.model', dir: 'tools', sha256: 'c53433de083c4a6ad12d034550ef22de68cec62c4f58932a7b6b8b2f1e743fa5' },
];

// Our derived encoder: the input, the script, the recipe, the pinned quantizer, and the pin the
// output must match (the same bytes on every run: proved twice, scratch/issues/selene.md 2026-09-29).
export const BUILD = {
  input: 'encoder.fp32',
  script: join(XR, 'tools/kws_quantize.py'),
  recipe: 'matmul-table',
  requirements: join(XR, 'tools/kws-quantize-requirements.txt'),
  python: { version: '3.12', platform: 'linux-x86_64' },
  to: 'encoder.int8.onnx',
  sha256: '590ed62cda38c174dc58ac7f67d654e458bd50e47e34883746dc88e946327557',
};

export const TIMEOUT_MS = Number(process.env.KWS_FETCH_TIMEOUT_MS) || 120_000;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Every installed file and its pin: { 'kws/<name>' | 'tools/<name>': sha256 }.
export const pinsFor = (sources, build) => Object.fromEntries([
  ...sources.flatMap((s) => (s.files ? Object.values(s.files).map(([to, h]) => [`kws/${to}`, h]) : s.to ? [[`${s.dir ?? 'kws'}/${s.to}`, s.sha256]] : [])),
  ...(build ? [[`kws/${build.to}`, build.sha256]] : []),
]);
export const KWS_FILES = pinsFor(SOURCES, BUILD);

export function check(dirs = DIRS) {
  const bad = installProblems(dirs, { strict: true });
  for (const [key, want] of Object.entries(KWS_FILES)) {
    const [d, name] = key.split('/');
    const p = join(dirs[d], name);
    if (!existsSync(p)) bad.push(`${key}: missing`);
    else if (sha(readFileSync(p)) !== want) bad.push(`${key}: sha256 differs`);
  }
  return bad;
}

// One source's bytes: from `from` (a --save copy, by the URL's file name) or the network, with the
// timeout over the whole body; checked against the pin; kept in `save` if asked.
async function getSource(s, { from, save, fetchImpl, timeoutMs }) {
  let buf;
  if (from) {
    const p = join(from, basename(s.url));
    if (!existsSync(p)) throw new Error(`${p}: not in the --from copy`);
    buf = readFileSync(p);
  } else {
    // A ref'd timer, not AbortSignal.timeout (whose timer is unref'd: with nothing else pending the
    // process could exit before it fired, and a hang would end as a silent exit, not an error).
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
    let r;
    try {
      r = await fetchImpl(s.url, { signal: ac.signal });
      if (!r.ok) throw new Error(`${s.url}: HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (ac.signal.aborted) throw new Error(`${s.url}: no complete answer within ${timeoutMs} ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  if (sha(buf) !== s.sha256) throw new Error(`${s.url}: sha256 ${sha(buf)}, pinned ${s.sha256}`);
  if (save) {
    mkdirSync(save, { recursive: true });
    writeFileSync(join(save, basename(s.url)), buf);
  }
  return buf;
}

// The environment every build subprocess gets: the caller's, minus everything that can change what
// Python imports or runs (every PYTHON* variable: PYTHONPATH, PYTHONHOME, PYTHONSTARTUP, ...) and
// everything that can change what pip fetches or trusts (every PIP_*), plus pip reading no config
// file and no user site. python -I covers the PYTHON* half again; this also covers pip.
export function cleanEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^(PYTHON|PIP_)/.test(k)) out[k] = v;
  return { ...out, PIP_CONFIG_FILE: '/dev/null', PYTHONNOUSERSITE: '1' };
}

// Run a build step: isolated Python, the cleaned environment, and a timeout (SIGKILL, then throw).
export const BUILD_TIMEOUT_MS = Number(process.env.KWS_BUILD_TIMEOUT_MS) || TIMEOUT_MS * 4;

// The derived encoder, built in a throwaway venv from hash-pinned wheels (from `from`/wheels when
// offline; downloaded, and kept in `save`/wheels, otherwise). Answers the output path. Every Python is
// run with -I, pip as `python -I -m pip` with --only-binary :all:, and every step has a timeout.
export function buildEncoder(input, work, { from, save, build = BUILD, run = execFileSync, log = console.log, timeoutMs = BUILD_TIMEOUT_MS } = {}) {
  const env = cleanEnv();
  const step = (cmd, args, opts = {}) => run(cmd, args, { env, timeout: timeoutMs, killSignal: 'SIGKILL', ...opts });
  const py = process.env.KWS_PYTHON ?? 'python3';
  const [ver, plat] = String(step(py, ['-I', '-c', 'import sys, sysconfig; print("%d.%d" % sys.version_info[:2], sysconfig.get_platform())'], { encoding: 'utf8' })).trim().split(' ');
  if (ver !== build.python.version || plat !== build.python.platform) {
    throw new Error(`the quantizer is pinned to CPython ${build.python.version} on ${build.python.platform}; ${py} is ${ver} on ${plat} (set KWS_PYTHON)`);
  }
  const venv = join(work, 'venv');
  step(py, ['-I', '-m', 'venv', venv]);
  const vpy = join(venv, 'bin/python');
  const pip = (args) => step(vpy, ['-I', '-m', 'pip', ...args]);
  const wheels = from ? join(from, 'wheels') : join(save ?? work, 'wheels');
  const pinned = ['--require-hashes', '--no-deps', '--only-binary', ':all:', '-r', build.requirements];
  if (!from) pip(['download', '-q', '--disable-pip-version-check', ...pinned, '-d', wheels]);
  pip(['install', '-q', '--disable-pip-version-check', '--no-index', '--find-links', wheels, ...pinned]);
  const out = join(work, build.to);
  step(vpy, ['-I', build.script, input, out, '--recipe', build.recipe], { stdio: ['ignore', 'ignore', 'pipe'] });
  const got = sha(readFileSync(out));
  if (got !== build.sha256) throw new Error(`the built ${build.to} is sha256 ${got}, pinned ${build.sha256} (a different quantizer, interpreter or platform?)`);
  log(`built ${build.to} (recipe ${build.recipe}, ${(statSync(out).size / 1e6).toFixed(1)} MB)`);
  return out;
}

// The stamp an install writes into both directories: an id (the sha256 of the pins, so the same
// install always writes the same bytes: the contest freeze is byte-reproducible) and the pins.
export const stampOf = (pins) => JSON.stringify({ id: sha(JSON.stringify(pins)), pins }, null, 1) + '\n';

// Install the staged files. WHAT IS GUARANTEED, exactly:
//   1. Everything is assembled in stagingOf(dirs) and every pin checked there first: a failure before
//      the first rename (a wrong byte, a full disk, a kill) changes nothing in the install directories.
//   2. Each directory is replaced by one rename(2), tools/.kws first and public/kws last: neither
//      directory is ever a mix of old and new files.
//   3. It is NOT crash-atomic across the two directories. A crash between the renames can leave a
//      directory missing (its old copy under .kws-staging/, never under public/), or the new
//      tools/.kws beside the old public/kws. Both are DETECTED, not repaired: check() (--check, and
//      the freeze) refuses them, and so does the vite build (vite.config.js, installProblems()).
//   4. Running fetch_kws.mjs again repairs them.
// `copy` is for the test (a disk that fills up mid-copy); `afterRename` too (a kill between renames).
export function installAtomic(staged, dirs = DIRS, { copy = copyFileSync, pins = KWS_FILES, afterRename = () => {} } = {}) {
  const staging = stagingOf(dirs);
  const stamp = stampOf(pins);
  const order = ['tools', 'kws'].filter((d) => dirs[d] && staged.some((f) => f.dir === d));
  const fresh = {};
  try {
    mkdirSync(staging, { recursive: true });
    for (const d of order) {
      const target = dirs[d];
      const mine = staged.filter((f) => f.dir === d);
      const tmp = join(staging, `new-${process.pid}-${d}`);
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      fresh[d] = tmp;
      const names = new Set([...mine.map((f) => f.to), STAMP]);
      if (existsSync(target)) for (const n of readdirSync(target)) if (!names.has(n)) copy(join(target, n), join(tmp, n));
      for (const f of mine) copy(f.path, join(tmp, f.to));
      writeFileSync(join(tmp, STAMP), stamp);
      for (const f of mine) {
        const want = pins[`${d}/${f.to}`];
        if (want && sha(readFileSync(join(tmp, f.to))) !== want) throw new Error(`${d}/${f.to}: sha256 differs after the copy`);
      }
    }
  } catch (e) {
    for (const tmp of Object.values(fresh)) rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  for (const d of order) {
    const target = dirs[d];
    const old = join(staging, `old-${process.pid}-${d}`);
    if (existsSync(target)) renameSync(target, old);
    afterRename(d, 'aside');
    renameSync(fresh[d], target);
    afterRename(d, 'in');
    rmSync(old, { recursive: true, force: true });
  }
  rmSync(staging, { recursive: true, force: true });
}

// What is wrong with the installed state, for the vite build (lenient: a clone that never fetched is
// fine, voice shows "not installed") or for check() (strict: everything installed and pinned).
export function installProblems(dirs = DIRS, { strict = false } = {}) {
  const bad = [];
  const committed = join(dirs.kws, 'kws-worker.js');
  if (!existsSync(committed)) bad.push(`${dirs.kws} has lost its committed files (an interrupted fetch_kws install?)`);
  const staging = stagingOf(dirs);
  if (existsSync(staging) && readdirSync(staging).length) bad.push(`${staging} holds an interrupted install: ${readdirSync(staging).join(', ')}`);
  const parent = dirname(dirs.kws);
  if (existsSync(parent)) for (const n of readdirSync(parent)) if (/^kws\.(old|new)-/.test(n)) bad.push(`${join(parent, n)}: a leftover inside public/ (it would ship)`);
  const read = (d) => (existsSync(join(dirs[d], STAMP)) ? readFileSync(join(dirs[d], STAMP), 'utf8') : null);
  const [k, t] = [read('kws'), read('tools')];
  if (k !== t) bad.push(k && t ? 'public/kws and tools/.kws are from different installs' : `only ${k ? 'public/kws' : 'tools/.kws'} has an install stamp (a mixed install)`);
  else if (strict && !k) bad.push('no install stamp: run node tools/fetch_kws.mjs');
  return bad;
}

// Fetch (or read `from`), check, build, and install. Writes nothing into the install directories
// unless every step passed. The options after `dirs` are for the tests.
export async function fetchAll({ dirs = DIRS, from = null, save = null, sources = SOURCES, build = BUILD, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, buildImpl = buildEncoder, copy, afterRename, log = console.log } = {}) {
  const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'kws-'));
  try {
    const staged = []; // { dir, to, path }
    const inputs = {};
    for (const [k, s] of sources.entries()) {
      const buf = await getSource(s, { from, save, fetchImpl, timeoutMs });
      const at = join(work, String(k));
      mkdirSync(at);
      if (s.files) {
        writeFileSync(join(at, 'a'), buf);
        execFileSync('tar', [...s.tar, join(at, 'a'), '-C', at, ...Object.keys(s.files)]);
        for (const [member, [to, want]] of Object.entries(s.files)) {
          const got = sha(readFileSync(join(at, member)));
          if (got !== want) throw new Error(`${member}: sha256 ${got}, pinned ${want}`);
          staged.push({ dir: 'kws', to, path: join(at, member) });
        }
      } else {
        const p = join(at, basename(s.url));
        writeFileSync(p, buf);
        if (s.id) inputs[s.id] = p;
        if (s.to) staged.push({ dir: s.dir ?? 'kws', to: s.to, path: p });
      }
      log(`${from ? 'read' : 'fetched'} ${basename(s.url)} (${(buf.length / 1e6).toFixed(1)} MB)`);
    }
    if (build) {
      const out = buildImpl(inputs[build.input], work, { from, save, build, log });
      staged.push({ dir: 'kws', to: build.to, path: out });
    }
    installAtomic(staged, dirs, { pins: pinsFor(sources, build), ...(copy ? { copy } : {}), ...(afterRename ? { afterRename } : {}) });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
  try {
    if (!process.argv.includes('--check')) await fetchAll({ from: arg('--from'), save: arg('--save') });
  } catch (e) {
    console.error(`fetch_kws: ${e.message}\nnothing was installed; public/kws and tools/.kws are as they were (tools/fetch_kws.mjs installAtomic)`);
    process.exit(1);
  }
  const bad = check();
  if (bad.length) {
    console.error(`public/kws is not ready:\n  ${bad.join('\n  ')}\nrun: node tools/fetch_kws.mjs`);
    process.exit(1);
  }
  console.log(`public/kws ready: ${Object.keys(KWS_FILES).join(', ')}`);
}
