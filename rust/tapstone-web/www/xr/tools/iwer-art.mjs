#!/usr/bin/env node
// iwer-art.mjs: the world art's proof, in IWER on the capture's GPU (xr_capture/gpu.mjs, the B60 by
// default): stills from a seated player's views, and what a frame costs: draw calls, triangles (the
// median over ~2 s, per view), the scene's texture memory (every texture a visible material holds,
// width x height x 4 bytes, x 4/3 when mipmapped) and the render rate IWER reached.
//
//   XR_PORT=<port> npx @iwsdk/cli dev up --headless --no-open
//   node tools/iwer-art.mjs [--vr] [--steps N] [--out dir] [--gpu b60] [--allow-renderer]
//
// It plays N moves first (gestureStep, the IWER gates' path), so the board has units and the doors
// have stirred. Writes <out>/<mode>-<view>.png and <out>/<mode>.json.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultGpu, launchOptions, rendererProblem } from './xr_capture/gpu.mjs';
import { installHands, hideEmulatorChrome } from './xr_capture/page.js';
import { KEY } from '../src/logic/journal.js';
import enterVr from './iwer-enter-vr.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(root, 'package.json'))('playwright');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const vr = argv.includes('--vr');
const hc = argv.includes('--contrast');
const calm = argv.includes('--calm'); // reduced motion
const mode = `${vr ? 'vr' : 'mr'}${hc ? '-contrast' : ''}${calm ? '-calm' : ''}`;
const steps = Number(opt('--steps', 14));
const only = opt('--views', null)?.split(',');
const out = resolve(opt('--out', join(root, '.iwsdk/art')));
const gpu = opt('--gpu', defaultGpu());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { stdout } = await run(join(root, 'node_modules/.bin/iwsdk'), ['dev', 'status'], { cwd: root }).catch((e) => e);
const url = JSON.parse(stdout).data.runtimeUrls.local;
await mkdir(out, { recursive: true });
const browser = await chromium.launch(launchOptions(gpu));
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || /THREE\.|shader/i.test(m.text())) && errors.length < 20 && errors.push(m.text().slice(0, 600)));
  page.on('pageerror', (e) => errors.length < 20 && errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(([k, hc, calm]) => {
    localStorage.removeItem(k);
    localStorage.setItem('tapstone.access', JSON.stringify({ highContrast: hc, reducedMotion: calm })); // the theme, motion (src/access.js)
  }, [KEY, hc, calm]);
  await page.reload({ waitUntil: 'load' });
  const appFrame = async () => {
    for (let k = 0; k < 60; k++, await sleep(500)) for (const f of page.frames()) if (await f.evaluate(() => !!globalThis.__tapstone).catch(() => false)) return f;
    throw new Error('no Tapstone frame');
  };
  let f = await appFrame();
  const renderer = await f.evaluate(() => {
    const g = __tapstone.play.world.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
  });
  const problem = rendererProblem(gpu, renderer);
  if (problem && !argv.includes('--allow-renderer')) throw new Error(`REFUSED: ${problem}`);
  if (vr) await enterVr({ page, frame: f });
  else await f.evaluate(() => IWER_DEVICE.remote.dispatch('accept_session'));
  f = await appFrame();
  await f.waitForFunction(() => __tapstone.play.world.renderer.xr.getSession() && __tapstone.room().kind, null, { timeout: 15000 });
  await f.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  await page.evaluate(() => document.querySelector('.workspace-view-switcher')?.style.setProperty('display', 'none', 'important'));
  await f.evaluate(`(${installHands})(); (${hideEmulatorChrome})();`);
  // Moves, so the board has units on it (the engine's bot answers each).
  const played = [];
  for (let k = 0; k < steps; k++) {
    played.push(await f.evaluate(() => __tapstone.gestureStep()));
    await sleep(700);
  }
  await sleep(1500);
  // A seated player's views: [name, head, target] relative to the board's centre, in board-local metres.
  const views = [
    ['seat', { x: 0, y: 0.42, z: 0.7 }, { x: 0, y: 0, z: 0.05 }],
    ['altar', { x: 0, y: 0.27, z: 0.68 }, { x: 0, y: -0.07, z: 0.12 }],
    ['board', { x: 0, y: 0.34, z: 0.42 }, { x: 0, y: 0, z: -0.05 }],
    ['doors-right', { x: 0, y: 0.42, z: 0.7 }, { x: 1.6, y: 0.4, z: -0.2 }],
    ['doors-left', { x: 0, y: 0.42, z: 0.7 }, { x: -1.6, y: 0.4, z: -0.2 }],
    ['room', { x: 0, y: 0.5, z: 1.4 }, { x: 0, y: 0.2, z: -1.0 }],
  ];
  const report = { mode, gpu, renderer, played, views: {} };
  for (const [name, head, target] of views.filter(([n]) => !only || only.includes(n))) {
    await f.evaluate(async ([h, t]) => {
      const r = __tapstone.play.root, w = (p) => r.localToWorld(r.position.clone().set(p.x, p.y, p.z));
      await __xrHands.frame(w(h), w(t));
      await __xrHands.rest();
    }, [head, target]);
    await sleep(900);
    const samples = [];
    for (let k = 0; k < 20; k++, await sleep(100)) samples.push(await f.evaluate(() => __tapstone.render()));
    const med = (key) => samples.map((s) => s[key]).sort((a, b) => a - b)[samples.length >> 1];
    const fps = await f.evaluate(async () => {
      const info = __tapstone.play.world.renderer.info.render;
      const f0 = info.frame, t0 = performance.now();
      await new Promise((r) => setTimeout(r, 3000));
      return ((info.frame - f0) * 1000) / (performance.now() - t0);
    });
    await page.screenshot({ path: join(out, `${mode}-${name}.png`) });
    report.views[name] = { calls: med('calls'), triangles: med('triangles'), fps: +fps.toFixed(1) };
  }
  // Texture memory: every texture on a material the scene holds (visible or not: pooled meshes load too).
  report.textures = await f.evaluate(() => {
    const seen = new Set();
    let bytes = 0;
    __tapstone.play.world.scene.traverse((o) => {
      for (const m of [o.material].flat()) {
        if (!m) continue;
        for (const v of Object.values(m)) {
          if (!v || !v.isTexture || seen.has(v)) continue;
          seen.add(v);
          const img = v.image, w = img?.width ?? 0, h = img?.height ?? 0;
          bytes += w * h * 4 * (v.generateMipmaps && v.minFilter !== 1006 && v.minFilter !== 1003 ? 4 / 3 : 1);
        }
      }
    });
    return { count: seen.size, mb: +(bytes / 2 ** 20).toFixed(2), gpuTextures: __tapstone.play.world.renderer.info.memory.textures, gpuGeometries: __tapstone.play.world.renderer.info.memory.geometries };
  });
  report.errors = errors;
  report.atmos = await f.evaluate(() => globalThis.__tapstoneAtmos?.() ?? null);
  report.playable = await f.evaluate(() => [...(__tapstone.play.playable ?? [])]);
  // The contrast audit (src/art/contrast.js): what a person must find or read, outside the interior.
  report.contrast = await f.evaluate(() => {
    if (!globalThis.__tapstoneArt) return null; // a build before the art's contrast hook
    const p = __tapstone.play, list = [];
    // What is shown: a pooled slot left hidden is themed when a view shows it (assist.js).
    const walk = (o, path) => {
      if (o.name === 'teahouse.interior' || !o.visible) return;
      if (o.isMesh) list.push([`${path}/${o.name || o.geometry?.type || 'mesh'}#${list.length}`, o]);
      o.children.forEach((c) => walk(c, path));
    };
    walk(p.altar.group, 'altar');
    walk(p.board.group, 'board');
    p.hand.cards.forEach((c, k) => c.mesh.visible && list.push([`hand/${k}`, c.mesh]));
    const room = p.root.children.find((o) => o.name === 'teahouse.room');
    if (room) walk(room, 'teahouse');
    return { on: __tapstoneArt.isContrast(), meshes: list.length, problems: __tapstoneArt.audit(list) };
  });
  // The heaviest meshes, by triangles (a budget breakdown).
  report.heavy = await f.evaluate(() => {
    const out = [];
    __tapstone.play.world.scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      const g = o.geometry, n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      out.push({ name: o.name || o.material?.type || o.type, tris: Math.round(n), visible: o.visible });
    });
    return out.sort((a, b) => b.tris - a.tris).slice(0, 8);
  });
  report.room = await f.evaluate(() => __tapstone.room());
  report.fog = await f.evaluate(() => { const g = __tapstone.play.world.scene.fog; return g ? { color: g.color.getHexString(), near: g.near, far: g.far } : null; });
  report.net = await f.evaluate(() => ({ afterLoad: globalThis.__spikeNet?.after?.length ?? null, urls: globalThis.__spikeNet?.after?.slice(0, 5) ?? [] })).catch(() => null);
  await writeFile(join(out, `${mode}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
