#!/usr/bin/env node
// iwer-summons.mjs: the summons' IWER proof (design note 2026-09-28-xr-summons-design.md). In a
// Chromium on the B60 (xr_capture/gpu.mjs), with IWER's session accepted and hand input:
//   whelp    play the match through gestureStep() until Cinder Whelp can be cast, then cast it through
//            the same gesture path and record it (a clip, and stills through the transition), and
//            check that the dragon formed, flew and settled into its idle
//   gallery  every creature at once, 9 a side (the worst case): stills and renderer.info, before and after
//   match    a whole match through gestureStep(): the peak draw calls and triangles, the frame log, and
//            the check that the creatures are the board's units at the end (runs on a build without
//            the summons too, for the before numbers)
//
//   XR_PORT=8387 npx @iwsdk/cli dev up --headless --no-open
//   node tools/iwer-summons.mjs <whelp|gallery|match> --out <dir> [--gpu b60] [--motion reduce] [--contrast] [--vr] [--per N] [--drop <model>]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screencast, concatList } from './xr_capture/screencast.mjs';
import { defaultGpu, launchOptions, rendererProblem } from './xr_capture/gpu.mjs';
import { installHands, hideEmulatorChrome } from './xr_capture/page.js';
import { KEY } from '../src/logic/journal.js';
import enterVr from './iwer-enter-vr.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const { chromium } = createRequire(join(root, 'package.json'))('playwright');
const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const out = resolve(opt('--out', join(root, '.iwsdk/summons')));
const gpu = opt('--gpu', defaultGpu());
const port = process.env.XR_PORT || 8387;
const reduce = opt('--motion', '') === 'reduce';
const vr = argv.includes('--vr'); // full VR through the page's own button (the Tea House interior)
const contrast = argv.includes('--contrast');
const per = Number(opt('--per', 9));
// --drop <model>: the page acts as if that model's file failed to load (?summonsDrop), for the fallback.
const drop = opt('--drop', '');
const expectModel = drop === 'drake' ? 'wyrm' : 'drake';
const log = (...a) => console.error(`[summons ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!['whelp', 'gallery', 'match'].includes(mode)) {
  console.error('usage: iwer-summons.mjs <whelp|gallery|match> --out <dir> [--gpu b60] [--motion reduce]');
  process.exit(2);
}

async function appFrame(page, ms = 40000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    for (const f of page.frames()) if (await f.evaluate(() => !!globalThis.__tapstone).catch(() => false)) return f;
  }
  throw new Error('no Tapstone frame');
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch(launchOptions(gpu));
const record = { mode, gpu, reduce, vr, contrast, per, drop, started: new Date().toISOString() };
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
  const tab = await context.newPage();
  const errors = [];
  tab.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : /summons/.test(m.text()) && log('page:', m.text())));
  tab.on('pageerror', (e) => errors.push(String(e)));
  const query = [reduce && 'motion=reduce', contrast && 'contrast=high', drop && `summonsDrop=${drop}`].filter(Boolean).join('&');
  await tab.goto(`https://localhost:${port}/${query ? `?${query}` : ''}`, { waitUntil: 'load' });
  // A fresh match (no stored journal), by a person who has answered the first-run offer: hands.
  await tab.evaluate((k) => (localStorage.removeItem(k), localStorage.setItem('tapstone.access', JSON.stringify({ offered: true }))), KEY).catch(() => {});
  await tab.reload({ waitUntil: 'load' });
  let app = await appFrame(tab);
  await app.evaluate((k) => localStorage.removeItem(k), KEY);
  record.renderer = await app.evaluate(() => {
    const g = __tapstone.play.world.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
  });
  const wrong = rendererProblem(gpu, record.renderer);
  if (wrong) throw new Error(`wrong GPU: ${wrong}`);
  log('renderer', record.renderer);
  await app.waitForFunction(() => (globalThis.__tapstoneNet ?? globalThis.__spikeNet)?.loadedAt != null && (!globalThis.__tapstoneSummons || globalThis.__tapstoneSummons.stats().models > 0), null, { timeout: 40000 }).catch(() => {});
  if (vr) record.room = (await enterVr({ page: tab, frame: app })).room;
  else await app.evaluate(() => IWER_DEVICE.remote.dispatch('accept_session'));
  app = await appFrame(tab);
  await app.waitForFunction(() => __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 15000 });
  await app.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  await tab.evaluate(() => {
    document.querySelector('.workspace-view-switcher')?.style.setProperty('display', 'none', 'important');
    for (const e of [document.documentElement, document.body]) e.style.setProperty('background', '#000', 'important');
  });
  await app.evaluate(`(${installHands})();`);
  await app.evaluate(`(${hideEmulatorChrome})()`);
  // Framed as a seated player leaning in, looking at the board (xr_capture/start.mjs's framing,
  // leaning further in, so the pads and the board's rows fill the frame).
  await app.evaluate(async () => {
    const pl = __tapstone.play;
    const pad = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
    await __xrHands.frame({ x: pad.x, y: pad.y + 0.24, z: pad.z + 0.06 }, { x: pad.x, y: pad.y - 0.02, z: pad.z - 0.3 });
    await __xrHands.rest();
  });
  await sleep(800);
  record.baseline = await app.evaluate(() => ({ render: __tapstone.render(), summons: globalThis.__tapstoneSummons?.stats() ?? null }));
  const shot = async (name) => {
    const f = join(out, `${name}.png`);
    await tab.screenshot({ path: f });
    return f;
  };
  if (mode === 'match') {
    await app.evaluate(() => (__tapstone.framesReset(), globalThis.__tapstoneSummons?.costReset()));
    const peak = { calls: 0, triangles: 0, creatures: 0 };
    let steps = 0, done = false;
    const shots = {};
    for (const end = Date.now() + 240000; !done && Date.now() < end; steps++) {
      const r = await app.evaluate(() => {
        __tapstone.gestureStep();
        return { done: __tapstone.stats().done, render: __tapstone.render(), live: globalThis.__tapstoneSummons?.stats().live ?? 0 };
      });
      done = r.done;
      // A still of the first strikes, spells and deaths, a moment into each.
      const seen = await app.evaluate(() => globalThis.__tapstoneSummons?.stats() ?? null);
      for (const kind of ['attacks', 'spells', 'deaths']) {
        if (seen && seen[kind] > (shots[kind] ?? 0) && (shots[`n${kind}`] ?? 0) < 2) {
          shots[kind] = seen[kind];
          shots[`n${kind}`] = (shots[`n${kind}`] ?? 0) + 1;
          await sleep(kind === 'deaths' ? 350 : 200);
          await shot(`match-${kind}-${shots[`n${kind}`]}`);
        }
      }
      for (let k = 0; k < 4; k++) {
        await sleep(150);
        const x = await app.evaluate(() => ({ render: __tapstone.render(), live: globalThis.__tapstoneSummons?.stats().live ?? 0 }));
        peak.calls = Math.max(peak.calls, x.render.calls);
        peak.triangles = Math.max(peak.triangles, x.render.triangles);
        peak.creatures = Math.max(peak.creatures, x.live);
      }
    }
    await sleep(2500);
    record.match = await app.evaluate(() => {
      const view = __tapstone.play.view;
      const b = view.phase === 'lobby' && !view.lobby.length && view.last_over ? view.last_over : view;
      const units = {};
      if (b.seats) for (let s = 0; s < 2; s++) for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) if (b.seats[s].cells[l][c]) units[`${s}:${l}:${c}`] = b.seats[s].cells[l][c].name;
      return { units, debug: globalThis.__tapstoneSummons?.debug?.() ?? null, summons: globalThis.__tapstoneSummons?.stats() ?? null, frames: __tapstone.frames(), done: __tapstone.stats().done };
    });
    record.match.steps = steps;
    record.match.peak = peak;
    record.after = { render: await app.evaluate(() => __tapstone.render()) };
    const s = record.match.summons;
    const problems = [];
    if (!record.match.done) problems.push('the match did not end');
    if (s) {
      if (JSON.stringify(s.census) !== JSON.stringify(Object.fromEntries(Object.entries(record.match.units).sort()))) {
        const a = JSON.stringify(Object.fromEntries(Object.entries(s.census).sort()));
        if (a !== JSON.stringify(Object.fromEntries(Object.entries(record.match.units).sort()))) problems.push(`creatures ${a} are not the units ${JSON.stringify(record.match.units)}`);
      }
      if (!(s.spawned > 0 && s.attacks > 0 && s.deaths > 0)) problems.push(`spawned ${s.spawned}, attacks ${s.attacks}, deaths ${s.deaths}`);
    }
    record.problems = problems;
    await shot('match-end');
  } else if (mode === 'gallery') {
    await shot('gallery-before');
    const g = await app.evaluate((n) => __tapstoneSummons.gallery(n), per);
    await sleep(1500);
    await app.evaluate(() => (__tapstone.framesReset(), __tapstoneSummons.costReset()));
    await sleep(3000);
    record.after = await app.evaluate(() => ({ render: __tapstone.render(), summons: __tapstoneSummons.stats(), frames: __tapstone.frames?.() ?? null }));
    await shot('gallery-after');
    record.gallery = { live: g.live };
  } else {
    // Play until the menu offers Cinder Whelp, then cast it (the same door the hands use).
    let steps = 0, whelp = null;
    for (; steps < 400 && !whelp; steps++) {
      whelp = await app.evaluate(async () => {
        const menu = __tapstone.table.choices();
        // The whelp must be the first useful cast, so gestureStep('CastUnit') plays exactly it.
        const first = menu.find((m) => m.useful && m.kind === 'CastUnit');
        if (first && /Cinder Whelp/.test(first.label)) return first.label;
        if (__tapstone.stats().done) return 'DONE';
        __tapstone.gestureStep();
        return null;
      });
      if (whelp === 'DONE') throw new Error('the match ended before the whelp could be cast');
      if (!whelp) await sleep(250);
    }
    log(`whelp castable after ${steps} steps: ${whelp}`);
    // Let the queue drain and the creatures settle before the cast.
    await app.waitForFunction(() => !__tapstoneSummons.stats().creatures.some((c) => c.anim), null, { timeout: 10000 }).catch(() => {});
    await sleep(600);
    await shot('whelp-0-before');
    const work = join(out, 'frames');
    await rm(work, { recursive: true, force: true });
    const sc = await screencast(await context.newCDPSession(tab), work);
    const t0 = Date.now() / 1000;
    // Through the gesture door the hands use (no module import here: that would be a fetch after load).
    const cast = await app.evaluate(() => __tapstone.gestureStep('CastUnit'));
    const trace = [];
    const began = Date.now();
    for (const at of [200, 700, 1200, 1700, 2200, 2700, 3200, 3700, 4200, 5000, 6000]) {
      await sleep(Math.max(0, at - (Date.now() - began)));
      const s = await app.evaluate(() => __tapstoneSummons.stats());
      const w = s.creatures.find((c) => c.name === 'Cinder Whelp');
      trace.push({ ms: Date.now() - began, whelp: w ?? null, fxDraws: s.fxDraws, motes: s.motes });
      await shot(`whelp-${String(at).padStart(4, '0')}`);
    }
    await sleep(800);
    const frames = await sc.stop();
    const seconds = Date.now() / 1000 - t0;
    const list = concatList(frames, t0, seconds);
    await writeFile(join(out, 'frames.ffconcat'), list.text);
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(out, 'frames.ffconcat'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', join(out, 'whelp-summon.mp4')], { maxBuffer: 1 << 26 });
    await rm(work, { recursive: true, force: true });
    record.whelp = { cast, steps, trace, frames: list.frames, seconds: +seconds.toFixed(2) };
    record.after = await app.evaluate(() => ({ render: __tapstone.render(), summons: __tapstoneSummons.stats() }));
    // The proof: the whelp became the dragon, it flew (anim 'summon'), and it settled into its idle.
    const seen = trace.map((x) => x.whelp).filter(Boolean);
    const problems = [];
    if (!seen.length) problems.push('no whelp creature ever appeared');
    if (seen.some((w) => w.model !== expectModel)) problems.push(`the whelp is not the dragon (${expectModel})`);
    if (!reduce && !seen.some((w) => w.anim === 'summon')) problems.push('the whelp never flew from the card');
    const end = seen.at(-1);
    if (!end || end.anim !== null || end.clip !== 'idle') problems.push(`the whelp did not settle: ${JSON.stringify(end)}`);
    record.problems = problems;
  }
  record.net = await app.evaluate(() => { const n = globalThis.__tapstoneNet ?? globalThis.__spikeNet; return { afterLoad: n.after.length, urls: n.after.slice(0, 5) }; });
  record.errors = errors;
  await writeFile(join(out, `${mode}.json`), JSON.stringify(record, null, 2));
  log(JSON.stringify({ problems: record.problems ?? [], net: record.net, errors: errors.length, baseline: record.baseline.render, after: record.after.render }));
  await browser.close();
  process.exit(record.problems?.length || record.net.afterLoad ? 1 : 0);
} catch (e) {
  log('error:', e.stack || e.message);
  record.error = e.message;
  await writeFile(join(out, `${mode}.json`), JSON.stringify(record, null, 2)).catch(() => {});
  await browser.close().catch(() => {});
  process.exit(2);
}
