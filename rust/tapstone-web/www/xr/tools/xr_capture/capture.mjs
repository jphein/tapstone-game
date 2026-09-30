#!/usr/bin/env node
// capture.mjs: records the real headset build, served by IWSDK with IWER, in a Chromium it launches on the
// Intel Arc Pro B60 (gpu.mjs), and delivers a checked MP4.
//
//   XR_PORT=<free port> npx @iwsdk/cli dev up --headless --no-open
//   node tools/xr_capture/capture.mjs <idle|match|teahouse> [--seconds N] [--max N] [--input hands|gesture]
//        [--vr] [--resume] [--returning] [--pan DEG] [--contrast] [--frame altar|room] [--gpu b60|p102|rtx2080|swiftshader] [--allow-renderer] [--out file.mp4]
//   npx @iwsdk/cli dev down
//
// The capture launches and owns its Chromium (gpu.mjs: the Intel Arc Pro B60 by default), opens the
// dev server's page, and runs install/start/drive/stop against it; IWSDK's dev server serves the
// build and IWER. The WebGL renderer is read before recording: on the wrong GPU the capture refuses
// (exit 3) unless --allow-renderer, and the JSON records it either way.
//
// Per capture: install.mjs (1920x1080 viewport, audio taps, reload) → IWER accepts the session (or
// the page's Full VR button) → hand input → screencast.mjs starts on the page's CDP session → start.mjs (hide the emulator's interface,
// frame the head, start recording the page's own audio) → drive.mjs until done (one 95 s call
// each) → stop.mjs (the audio) → the frames between the audio's start and end, each held until the
// next (the source, at the rate the page drew) → ffmpeg → video.mjs check.
// Beside the MP4 it writes <out>.json: the check's problems, both probes, the page's renderer and
// render rate, the hand moves and fallbacks, and the recording's marks (each move, the match's end).
// Exit 1 when the check finds a problem, 2 when a step fails.
//
// Frame rate and CPU: the JSON records the screencast's frame pacing (interval p50/p95/max) and
// Chromium's CPU% over the recording (the process tree under this Node process).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, check, deliverArgs } from './video.mjs';
import { screencast, concatList, pacing } from './screencast.mjs';
import { GPUS, defaultGpu, launchOptions, rendererProblem } from './gpu.mjs';
import { treeTicks, cpuPercent } from './cpu.mjs';
import install from './install.mjs';
import start from './start.mjs';
import drive from './drive.mjs';
import stop from './stop.mjs';
import enterVr from '../iwer-enter-vr.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const bin = join(root, 'node_modules/.bin/iwsdk');
const { chromium } = createRequire(join(root, 'package.json'))('playwright');

const argv = process.argv.slice(2);
const segment = argv[0];
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
if (!['idle', 'match', 'teahouse'].includes(segment)) {
  console.error('usage: capture.mjs <idle|match|teahouse> [--seconds N] [--max N] [--input hands|gesture] [--vr] [--resume] [--returning] [--pan DEG] [--contrast] [--frame altar|room] [--gpu b60|p102|rtx2080|swiftshader] [--allow-renderer] [--out file.mp4]');
  process.exit(2);
}
const seconds = Number(opt('--seconds', segment === 'idle' ? 8 : 0)) || null;
const out = resolve(opt('--out', join(root, `.iwsdk/xr-capture/${segment}.mp4`)));
const control = {
  name: segment,
  segment,
  seconds,
  maxSeconds: Number(opt('--max', 0)) || null,
  input: opt('--input', 'hands'),
  // Full VR: entered the way a person does, by the page's "Full VR" button (tools/iwer-enter-vr.mjs);
  // `xr enter` accepts the browser's offer, which is mixed reality.
  vr: argv.includes('--vr'),
  resume: argv.includes('--resume'), // keep the table's journal, so the page resumes its match
  contrast: argv.includes('--contrast'), // the high-contrast theme (install.mjs stores the setting)
  pan: Number(opt('--pan', 0)) || null, // idle only: degrees of head turn to the right across the take
  returning: argv.includes('--returning'), // the first-run offer already answered with the hands
  frame: opt('--frame', 'altar'), // the head's framing: 'altar' (leaning in) or 'room' (seated, the Tea House round the table)
  gpu: opt('--gpu', defaultGpu()),

};

const log = (...a) => console.error(`[xr_capture ${new Date().toISOString().slice(11, 19)}]`, ...a);
async function iwsdk(...args) {
  let stdout;
  try {
    ({ stdout } = await run(bin, args, { cwd: root, maxBuffer: 1 << 26 }));
  } catch (e) {
    stdout = e.stdout;
  }
  const j = JSON.parse(stdout || '{}');
  if (!j.ok) throw new Error(`iwsdk ${args.join(' ')}: ${JSON.stringify(j.error ?? j).slice(0, 400)}`);
  return j.data?.result ?? j.data;
}
// The frame that holds the app (__tapstone), found afresh: a reload replaces it.
async function appFrame(page, ms = 30000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
    for (const f of page.frames()) if (await f.evaluate(() => !!globalThis.__tapstone).catch(() => false)) return f;
  }
  throw new Error('no Tapstone frame');
}
const rendererOf = (f) => f.evaluate(() => {
  const g = __tapstone.play.world.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info');
  return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
});

// The sidecar is written on every exit: ok, a failed check, a refusal, or an error. It holds whatever
// the take reached, so a take that failed is still evidence (two takes left none, 2026-09-28).
let browser;
const record = { segment, out, outcome: null, gpu: control.gpu, wall: { started: new Date().toISOString() } };
const sidecar = async (outcome, extra = {}) => {
  Object.assign(record, extra, { outcome });
  record.wall.ended = new Date().toISOString();
  await writeFile(out.replace(/\.mp4$/, '.json'), JSON.stringify(record, null, 2)).catch((e) => log('sidecar not written:', e.message));
};
try {
  await mkdir(join(root, '.iwsdk/xr-capture'), { recursive: true });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(join(root, '.iwsdk/xr-capture/control.json'), JSON.stringify(control));
  const status = await iwsdk('dev', 'status');
  const url = status.runtimeUrls?.local ?? JSON.stringify(status).match(/https:\/\/localhost:\d+\//)?.[0];
  browser = await chromium.launch(launchOptions(control.gpu));
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
  const tab = await context.newPage();
  await tab.goto(url, { waitUntil: 'load' });
  const renderer = await rendererOf(await appFrame(tab));
  const wrongGpu = rendererProblem(control.gpu, renderer);
  Object.assign(record, { renderer, rendererProblem: wrongGpu });
  if (wrongGpu && !argv.includes('--allow-renderer')) {
    log(`REFUSED: ${wrongGpu}`);
    await browser.close();
    await sidecar('refused');
    process.exit(3);
  }
  if (wrongGpu) log(`WARNING, WRONG GPU (--allow-renderer): ${wrongGpu}`);
  log(`renderer (${control.gpu}): ${renderer}`);
  const ctx = { page: tab, context, workspaceRoot: root };
  const installed = (record.install = await install(ctx));
  log('install', JSON.stringify(installed));
  let app = await appFrame(tab);
  if (control.vr) log('entered full VR', JSON.stringify((await enterVr({ ...ctx, frame: app })).room));
  else await app.evaluate(() => IWER_DEVICE.remote.dispatch('accept_session'));
  app = await appFrame(tab);
  await app.waitForFunction(() => __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 15000 });
  await app.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  const work = join(root, `.iwsdk/xr-capture/${segment}`);
  await rm(work, { recursive: true, force: true });
  const sc = await screencast(await context.newCDPSession(tab), join(work, 'frames'));
  const at = { ...ctx, frame: app };
  const cpu0 = treeTicks();
  const page = (record.page = await start(at));
  log('recording', JSON.stringify(page));
  const drives = (record.drives = []);
  for (;;) {
    const r = await drive(at);
    drives.push(r);
    log(`drive: t=${r.t?.toFixed?.(1)} s, ${r.moves?.length ?? 0} moves, done=${r.done}${r.why ? ` (${r.why})` : ''}`);
    if (r.done) break;
  }
  const stopped = await stop(at);
  const cpu1 = treeTicks();
  const frames = await sc.stop();
  await browser.close();
  const cpu = { percent: +cpuPercent(cpu0, cpu1, stopped.seconds).toFixed(1), processes: cpu1.procs, of: 'one core = 100' };
  const pace = pacing(frames, stopped.wall0 / 1000, stopped.seconds);
  const iso = (ms) => new Date(ms).toISOString();
  Object.assign(record.wall, { recordStart: iso(stopped.wall0), recordEnd: iso(stopped.wall0 + stopped.seconds * 1000) });
  pace.stalls = pace.stalls.map((x) => ({ ...x, wall: iso(stopped.wall0 + x.t * 1000) }));
  Object.assign(record, { cpu, pacing: pace, page: { ...page, seconds: stopped.seconds, wall0: stopped.wall0 }, marks: stopped.marks, game: stopped.game });
  const list = concatList(frames, stopped.wall0 / 1000, stopped.seconds);
  log(`stopped: ${stopped.seconds.toFixed(1)} s of audio; ${list.frames} of ${frames.length} screencast frames in it; hand moves ${stopped.game.hands.hand}, fallbacks ${stopped.game.hands.fallbacks}`);
  await writeFile(join(work, 'frames.ffconcat'), list.text);
  const src = join(work, 'source.mkv');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'frames.ffconcat'), '-c:v', 'copy', '-fps_mode', 'passthrough', src], { maxBuffer: 1 << 26 });
  await run('ffmpeg', ['-v', 'error', '-y', ...deliverArgs(src, out, stopped.audioFile)], { maxBuffer: 1 << 26 });
  await rm(join(work, 'frames'), { recursive: true, force: true }); // source.mkv holds the same JPEGs
  const source = await probe(src, { countFrames: true });
  const delivery = await probe(out, { countFrames: true });
  // The idle run's length is the one asked for; a played segment's is whatever the page recorded.
  const problems = check({ source, delivery, seconds: seconds ?? stopped.seconds, audible: segment !== 'idle' });
  const { audioFile, game, marks, ...rec } = stopped;
  await sidecar(problems.length ? 'failed-check' : 'ok', { problems, source, delivery, install: installed, page: { ...page, ...rec }, marks, game, drives: drives.map(({ moves, ...d }) => ({ ...d, moves: moves?.length ?? 0 })) });
  log(problems.length ? `FAIL: ${problems.join('; ')}` : `ok: ${out} (${delivery.duration.toFixed(2)} s, ${delivery.video.frames} frames, source ${(source.video.frames / source.duration).toFixed(1)} fps, pacing p50/p95/max ${pace.p50}/${pace.p95}/${pace.max} ms, ${pace.stalls.length} stalls over 100 ms, Chromium CPU ${cpu.percent}%)`);
  process.exit(problems.length ? 1 : 0);
} catch (e) {
  log('error:', e.message);
  await browser?.close().catch(() => {});
  if (record.drives) record.drives = record.drives.map(({ moves, ...d }) => ({ ...d, moves: moves?.length ?? 0 }));
  await sidecar('error', { error: e.message });
  process.exit(2);
}
