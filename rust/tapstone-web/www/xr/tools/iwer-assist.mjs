// iwer-assist.mjs: the accessibility gate in IWER (design note 2026-09-28-xr-accessibility-design.md).
// It launches its own Chromium (as tools/xr_capture does: the managed browser takes no GPU or fake-mic
// flags) against a running dev server, enters the session, and plays with NO hand input at all:
//
//   1. the first-run offer, answered by HEAD GAZE: IWER's headset turns to the "play by looking" tile
//      and the page's own dwell fires (gaze was off: the offer is always dwell-able);
//   2. moves played by head gaze: the headset looks at each target (card, pad, castle, prompt tile)
//      in turn, and the page's dwell selects it (logic/gaze.js gazeForItem says which targets);
//   3. the settings panel opened, and high contrast turned on, by gaze; screenshots of both themes;
//   4. the MICROPHONE: Chromium's fake mic plays a WAV of spoken commands (--wav, 16 kHz mono) into
//      the page's real audio path (worklet -> worker -> the wasm keyword spotter); the phrases it
//      spots must be the WAV's;
//   5. the rest of the match by voice, through __tapstone.hear() (the same path the spotter feeds);
//   6. nothing on the network after "loaded", and the frame's draw calls and triangles.
//
//   XR_PORT=8587 npx @iwsdk/cli dev up --headless --no-open         (in tmux)
//   node tools/iwer-assist.mjs --wav /path/commands-16k.wav --shots <dir> [--gpu b60] [--moves 12]
//
// Prints one JSON report on stdout (and writes it to <shots>/iwer-assist.json).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions, rendererProblem, defaultGpu } from './xr_capture/gpu.mjs';
import { gazeForItem, gazeStep } from '../src/logic/gaze.js';
import { matchGesture } from '../src/logic/menu.js';
import { voiceForItem } from '../src/logic/voice-commands.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const gpu = opt('--gpu', defaultGpu());
const shots = opt('--shots', join(root, '.iwsdk/iwer-assist'));
const wav = opt('--wav', null);
const gazeMoves = Number(opt('--moves', 12));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[iwer-assist]', ...a);
mkdirSync(shots, { recursive: true });

const status = JSON.parse(execFileSync('npx', ['@iwsdk/cli', 'dev', 'status', '--json'], { cwd: root, encoding: 'utf8' }));
const url = status.runtimeUrls?.local ?? JSON.stringify(status).match(/https:\/\/localhost:\d+\//)?.[0];
if (!url) throw new Error(`no dev server (iwsdk dev status): ${JSON.stringify(status).slice(0, 200)}`);

const launch = launchOptions(gpu);
launch.args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required');
if (wav) launch.args.push(`--use-file-for-fake-audio-capture=${wav}`);
const browser = await chromium.launch(launch);
const report = { url, gpu, wav, started: new Date().toISOString(), problems: [] };
const problem = (s) => (report.problems.push(s), log('PROBLEM', s));
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
  const tab = await context.newPage();
  const consoleLines = [];
  tab.on('console', (m) => /voice-input|assist|kws/.test(m.text()) && consoleLines.push(m.text().slice(0, 300)));
  await tab.goto(url, { waitUntil: 'load' });
  let f = null;
  for (const end = Date.now() + 60000; !f && Date.now() < end; await sleep(500)) {
    for (const fr of tab.frames()) if (await fr.evaluate(() => !!globalThis.__tapstone?.assist).catch(() => false)) f = fr;
  }
  if (!f) throw new Error('no Tapstone frame with the assist hooks');
  report.renderer = await f.evaluate(() => {
    const g = __tapstone.play.world.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
  });
  const wrong = rendererProblem(gpu, report.renderer);
  if (wrong) problem(wrong);
  await f.waitForFunction(() => __tapstone.coldStart().loaded, null, { timeout: 60000 });
  report.coldStart = await f.evaluate(() => __tapstone.coldStart());
  report.renderBefore = await f.evaluate(() => __tapstone.render());

  await f.evaluate(() => IWER_DEVICE.remote.dispatch('accept_session'));
  await f.waitForFunction(() => __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 15000 });
  await f.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  // The hands rest well away from everything: no hand input in this gate.
  await f.evaluate(async () => {
    for (const side of ['left', 'right']) await IWER_DEVICE.remote.dispatch('set_transform', { device: `hand-${side}`, position: { x: side === 'left' ? -0.6 : 0.6, y: 0.4, z: 0.6 }, orientation: { pitch: 0, yaw: 0, roll: 0 } });
  });
  await f.waitForFunction(() => __tapstone.play.placed, null, { timeout: 15000 });
  await sleep(800);
  const assist = () => f.evaluate(() => __tapstone.assist());
  const shot = async (name) => {
    const p = join(shots, `${name}.png`);
    await tab.screenshot({ path: p });
    return p;
  };
  report.shots = [];

  // Look at a gaze target (by key) until the page's dwell fires, then look away (a target must be
  // left before it fires again). Answers the ms it took, or null if it never fired.
  const away = async () => {
    await f.evaluate(() => {
      const w = __tapstone.play.root.localToWorld(__tapstone.play.root.position.clone().set(0, 0.6, -0.6));
      return IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: w.x, y: w.y, z: w.z } });
    });
    await sleep(450);
  };
  const dwellOn = async (key, timeout = 6000, midShot = null) => {
    const t = (await f.evaluate(() => __tapstone.gazeTargets())).find((x) => x.key === key);
    if (!t) return null;
    const before = (await assist()).gaze.stats.fired;
    await f.evaluate((p) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: p }), { x: t.x, y: t.y, z: t.z });
    const t0 = Date.now();
    let mid = null;
    for (; Date.now() - t0 < timeout; await sleep(60)) {
      const a = await assist();
      if (!mid && a.gaze.progress > 0.4 && a.gaze.progress < 0.9) {
        mid = a.gaze.progress;
        if (midShot) report.shots.push(await shot(midShot));
      }
      if (a.gaze.stats.fired > before) {
        const ms = Date.now() - t0;
        await away();
        return { ms, mid };
      }
    }
    await away();
    return null;
  };

  // 1. The first-run offer, by gaze.
  let a = await assist();
  report.offer = { shown: a.offerShown, gazeBefore: a.access.gaze };
  if (!a.offerShown) problem('the first-run offer was not shown on a first session');
  report.shots.push(await shot('01-first-run-offer'));
  const offered = await dwellOn('tile:offer.gaze', 6000, '01b-offer-dwell-ring');
  a = await assist();
  Object.assign(report.offer, { dwelt: offered, gazeAfter: a.access.gaze, shownAfter: a.offerShown });
  if (!offered || !a.access.gaze) problem('the offer was not answered by gaze');

  // 2. Moves by head gaze.
  const gazePlayed = [];
  for (let n = 0; n < gazeMoves; n++) {
    const s = await f.evaluate(() => ({ menu: __tapstone.table.choices(), hand: __tapstone.play.handCards, beat: __tapstone.beats().beat, taps: __tapstone.stats().taps, done: __tapstone.stats().done }));
    if (s.done) break;
    let targets, label;
    if (s.beat === 'claim' && !s.menu.length) {
      targets = [{ kind: 'castle' }];
      label = 'claim';
    } else {
      const item = s.menu.find((m) => m.useful && m.kind !== 'Mulligan');
      if (!item) {
        await sleep(700);
        n--;
        continue;
      }
      label = item.label;
      targets = gazeForItem(item, s.hand);
      if (item.kind === 'CastSpell') {
        const st = gazeStep(gazeStep(null, targets[0], s.hand).lifted, targets[1], s.hand);
        const r = matchGesture(s.menu, st.gesture);
        if (r.need === 'target') targets = gazeForItem(item, s.hand, r.options);
      }
    }
    const steps = [];
    for (const t of targets) {
      const key = `${t.kind}:${t.slot ?? t.lane ?? t.option ?? t.target ?? ''}`;
      steps.push({ key, dwell: await dwellOn(key, 6000, n === 0 && !steps.length ? '02-gaze-dwell-ring' : null) });
    }
    // The castle inside the mulligan window opens a prompt that passes when it runs out (6 s with gaze).
    let after = s.taps;
    for (let w = 0; w < (targets[0]?.kind === 'castle' ? 80 : 10) && after <= s.taps; w++) {
      await sleep(100);
      after = await f.evaluate(() => __tapstone.stats().taps);
    }
    gazePlayed.push({ label, steps, played: after > s.taps, line: await f.evaluate(() => __tapstone.play.altar.line) });
    if (steps.some((x) => !x.dwell)) problem(`gaze move "${label}": a dwell never fired (${JSON.stringify(steps)})`);
  }
  report.gaze = { moves: gazePlayed.length, played: gazePlayed.filter((x) => x.played).length, list: gazePlayed, stats: (await assist()).gaze.stats };
  report.shots.push(await shot('03-gaze-standard'));

  // What the assist system itself draws: the same frame state with it hidden, and shown.
  const cost = async (name) => {
    const frames = async () => (await sleep(400), f.evaluate(() => __tapstone.render()));
    await f.evaluate(() => __tapstone.assistHidden(true));
    const off = await frames();
    await f.evaluate(() => __tapstone.assistHidden(false));
    const on = await frames();
    (report.cost ??= {})[name] = { callsOff: off.calls, callsOn: on.calls, trisOff: off.triangles, trisOn: on.triangles };
  };
  await cost('gazeOn-panelClosed');

  // 3. The panel and high contrast, by gaze; render counts either way.
  report.renderGazeOn = await f.evaluate(() => __tapstone.render());
  report.panel = { open: await dwellOn('tile:panel', 6000, '04a-panel-dwell') };
  report.renderPanelOpen = await f.evaluate(() => __tapstone.render());
  await cost('gazeOn-panelOpen');
  report.shots.push(await shot('04-panel-open'));
  report.panel.contrast = await dwellOn('tile:highContrast');
  await sleep(400);
  a = await assist();
  if (!a.access.highContrast) problem('high contrast was not turned on by gaze');
  report.shots.push(await shot('05-high-contrast-panel'));
  report.panel.close = await dwellOn('tile:panel');
  await sleep(300);
  report.shots.push(await shot('06-high-contrast'));
  report.renderContrast = await f.evaluate(() => __tapstone.render());

  // 4. The microphone, end to end (only with --wav).
  if (wav) {
    // The whole browser's memory (this process's cgroup, when the gate runs in its own systemd scope)
    // just before voice starts and once it is listening: the worker's cost, wasm and model included.
    const cgroupMem = () => {
      try {
        const rel = readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').pop();
        return Number(readFileSync(`/sys/fs/cgroup${rel}/memory.current`, 'utf8'));
      } catch {
        return null;
      }
    };
    const memBefore = cgroupMem();
    const state = await f.evaluate(() => __tapstone.voiceStart());
    await sleep(1500);
    const memAfter = cgroupMem();
    report.mic = { state, cgroupMB: memBefore && memAfter ? { before: Math.round(memBefore / 1e6), listening: Math.round(memAfter / 1e6), delta: Math.round((memAfter - memBefore) / 1e6) } : null };
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      a = await assist();
      if (a.voice.heard.filter((h) => h.source === 'mic').length >= 3 && i > 10) break;
    }
    a = await assist();
    Object.assign(report.mic, { voice: { state: a.voice.state, error: a.voice.error, stats: a.voice.stats }, heard: a.voice.heard.filter((h) => h.source === 'mic').map((h) => ({ text: h.text, ok: h.ok, result: h.result })) });
    report.shots.push(await shot('07-listening'));
    await cost('listening');
    if (a.voice.state !== 'listening') problem(`the mic did not start: ${a.voice.state} ${a.voice.error ?? ''}`);
    if (!report.mic.heard.length) problem('the spotter heard nothing from the fake mic');
  }

  // 5. The rest of the match by voice (typed phrases through the same hear() path).
  await f.evaluate(() => __tapstone.hear('high contrast off'));
  const said = [];
  for (let n = 0; n < 200; n++) {
    const s = await f.evaluate(() => ({ menu: __tapstone.table.choices(), hand: __tapstone.play.handCards, taps: __tapstone.stats().taps, done: __tapstone.stats().done, beat: __tapstone.beats().beat }));
    if (s.done) break;
    const item = s.menu.find((m) => m.useful && m.kind !== 'Mulligan');
    if (!item) {
      if (s.beat === 'claim') await f.evaluate(() => __tapstone.hear('claim'));
      await sleep(400);
      continue;
    }
    const phrases = voiceForItem(item, s.menu, s.hand);
    for (const p of phrases) said.push({ p, r: (await f.evaluate((t) => __tapstone.hear(t), p)).result });
    await sleep(250);
  }
  const end = await f.evaluate(() => ({ stats: __tapstone.stats(), net: (() => { const n = globalThis.__tapstoneNet ?? globalThis.__spikeNet; return n ? { afterLoad: n.after.length, urls: n.after.slice(0, 5), total: n.total } : null; })() }));
  report.voice = { phrases: said.length, results: said.reduce((o, x) => ((o[x.r] = (o[x.r] ?? 0) + 1), o), {}), done: end.stats.done, refused: end.stats.refused, taps: end.stats.taps };
  report.net = end.net;
  if (!end.stats.done) problem('the match did not finish');
  if (end.net?.afterLoad) problem(`requests after load: ${end.net.urls.join(' ')}`);
  report.renderEnd = await f.evaluate(() => __tapstone.render());
  report.console = consoleLines.slice(-12);
} catch (e) {
  problem(`error: ${e?.stack ?? e}`);
} finally {
  report.ended = new Date().toISOString();
  writeFileSync(join(shots, 'iwer-assist.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
process.exit(report.problems.length ? 1 : 0);
