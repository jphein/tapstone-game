// iwer-ghost-views.mjs: the guide's ghost hand from the heads a player uses, on the B60 (its own
// Chromium, as tools/iwer-guide-b60.mjs). Against a running dev server (`iwsdk dev up --no-open`):
// a first run answered with the hands, the opening hand drawn, and then, with the flip lesson's demo
// on the table (a card from the fan to the stone), the real Ghost held at three moments (the pinch at
// the card, mid-carry, the touch on the stone) from each view. Each still is saved and measured: the
// hand's share of the left eye's view (its world bounding box projected), and how near any of it
// comes to the eyes. The views:
//   leaning    xr_capture's framing (start.mjs), the view of guide-hands-02-demo-flip.png
//   standing   the default placement's head (layout.js defaultHead: 0.42 m over the board, 0.7 m back)
//   seated     the seated setting on, the head 35 cm lower (seated mode re-places the board from it)
//   close      0.30 m over the board, 0.60 m back: nearer the fan than a placement puts a head
//   left       leaning, in the left-handed layout (the access panel's own setting)
//   contrast   leaning, under #200's high contrast
//   node tools/iwer-ghost-views.mjs --tag before|after [--shots <dir>]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions, rendererProblem, defaultGpu } from './xr_capture/gpu.mjs';
import { hideEmulatorChrome } from './xr_capture/page.js';
import { PHASES } from '../src/guide/demo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const tag = opt('--tag', 'now');
const gpu = opt('--gpu', defaultGpu());
const shots = opt('--shots', join(root, '.iwsdk/ghost-views'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(shots, { recursive: true });
const at = (name, k) => {
  let t = 0;
  for (const [n, ms] of PHASES) {
    if (n === name) return t + ms * k;
    t += ms;
  }
  return t;
};
const MOMENTS = [['pinch', at('pinch', 0.9)], ['carry', at('carry', 0.5)], ['touch', at('touch', 0.9)]];
// Heads, board-local (the board's root): the head, and where it looks.
const VIEWS = [
  { name: 'leaning', lean: true },
  { name: 'standing', head: { x: 0, y: 0.42, z: 0.7 }, look: { x: 0, y: 0.02, z: 0.25 } },
  // seated: the seated setting on and the head 35 cm lower; seated mode re-places the board from it.
  { name: 'seated', seated: true },
  // close: 0.30 m over, 0.60 m back: nearer the fan than any placement puts a head (a stress view).
  { name: 'close', head: { x: 0, y: 0.3, z: 0.6 }, look: { x: 0, y: 0.02, z: 0.25 } },
  { name: 'left', lean: true, left: true },
  { name: 'contrast', lean: true, contrast: true },
];

const status = JSON.parse(execFileSync('npx', ['@iwsdk/cli', 'dev', 'status', '--json'], { cwd: root, encoding: 'utf8' }));
const url = status.runtimeUrls?.local ?? JSON.stringify(status).match(/https:\/\/localhost:\d+\//)?.[0];
const browser = await chromium.launch(launchOptions(gpu));
const report = { tag, gpu, views: [], problems: [] };
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  const appFrame = async () => {
    for (const end = Date.now() + 90000; Date.now() < end; await sleep(400)) {
      for (const fr of tab.frames()) if (await fr.evaluate(() => !!globalThis.__tapstone?.guide && !!globalThis.__tapstone?.tile).catch(() => false)) return fr;
    }
    throw new Error('no Tapstone frame');
  };
  await tab.goto(url, { waitUntil: 'load' });
  let f = await appFrame();
  await f.evaluate(() => { for (const k of ['tapstone.xr.journal', 'tapstone.access', 'tapstone.hand']) localStorage.removeItem(k); });
  await tab.reload({ waitUntil: 'load' });
  f = await appFrame();
  report.renderer = await f.evaluate(() => { const g = __tapstone.play.world.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; });
  const wrong = rendererProblem(gpu, report.renderer);
  if (wrong) report.problems.push(wrong);
  await f.waitForFunction(() => __tapstone.coldStart().loaded, null, { timeout: 60000 });
  await f.evaluate(() => IWER_DEVICE.remote.dispatch('accept_session'));
  await f.waitForFunction(() => __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 15000 });
  await f.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  await f.waitForFunction(() => __tapstone.play.placed, null, { timeout: 15000 });
  await tab.evaluate(() => document.querySelector('.workspace-view-switcher')?.style.setProperty('display', 'none', 'important'));
  await f.evaluate(`(${hideEmulatorChrome})()`);
  await f.evaluate(() => __tapstone.tile('offer.hands'));
  // Claim and draw the opening hand, so the flip lesson's demo is on the table.
  await f.evaluate(() => __tapstone.play.castleTap());
  for (let k = 0; k < 20 && (await f.evaluate(() => __tapstone.play.guide.lesson.id)) !== 'flip'; k++) {
    await f.evaluate(() => __tapstone.gestureStep('Draw'));
    await sleep(600);
  }
  await f.waitForFunction(() => __tapstone.play.ghost.demo && __tapstone.play.guide.lesson.id === 'flip', null, { timeout: 20000 });
  // The emulated hands out of shot.
  await f.evaluate(async () => { for (const s of ['left', 'right']) await IWER_DEVICE.remote.dispatch('set_transform', { device: `hand-${s}`, position: { x: s === 'left' ? -0.8 : 0.8, y: 0.2, z: 0.8 } }); });

  for (const v of VIEWS) {
    if (v.left) await f.evaluate(() => __tapstone.tile('leftHanded'));
    if (v.contrast) await f.evaluate(() => __tapstone.tile('highContrast'));
    if (v.seated) await f.evaluate(() => __tapstone.tile('seated'));
    await sleep(300);
    await f.evaluate(async (v) => {
      const pl = __tapstone.play, R = IWER_DEVICE.remote, W = (p) => { const w = pl.root.localToWorld(pl.root.position.clone().set(p.x, p.y, p.z)); return { x: w.x, y: w.y, z: w.z }; };
      if (v.seated) {
        const h = IWER_DEVICE.position.vec3;
        await R.dispatch('set_transform', { device: 'headset', position: { x: h[0], y: h[1] - 0.35, z: h[2] } });
        await new Promise((r) => setTimeout(r, 2500)); // seated mode settles and re-places the board
        const p = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
        await R.dispatch('look_at', { device: 'headset', target: { x: p.x, y: p.y, z: p.z - 0.1 } });
      } else if (v.lean) {
        const p = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
        await R.dispatch('set_transform', { device: 'headset', position: { x: p.x, y: p.y + 0.27, z: p.z + 0.28 } });
        await R.dispatch('look_at', { device: 'headset', target: { x: p.x, y: p.y - 0.1, z: p.z - 0.28 } });
      } else {
        await R.dispatch('set_transform', { device: 'headset', position: W(v.head) });
        await R.dispatch('look_at', { device: 'headset', target: W(v.look) });
      }
      pl.ghostKey = null; // re-aim the demo at the fan as this view's layout has it
    }, v);
    await sleep(500);
    for (const [moment, t] of MOMENTS) {
      await f.evaluate((t) => {
        const g = __tapstone.play.ghost;
        g.__update = g.__update ?? g.update.bind(g);
        g.update = (now, o) => g.__update(g.t0 + t, o);
      }, t);
      await sleep(350);
      const m = await f.evaluate(() => {
        const pl = __tapstone.play, g = pl.ghost, cam = pl.world.renderer.xr.getCamera().cameras?.[0] ?? pl.world.camera;
        const V = pl.root.position.constructor;
        const head = cam.getWorldPosition(new V());
        const pts = [];
        g.hand.updateWorldMatrix(true, true);
        g.hand.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          const pos = o.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i += 3) pts.push(new V().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
        });
        if (!pts.length) return { visible: false };
        let nearest = Infinity, x0 = 1, x1 = -1, y0 = 1, y1 = -1;
        for (const p of pts) {
          nearest = Math.min(nearest, p.distanceTo(head));
          const n = p.clone().project(cam);
          if (n.z > 1) continue;
          x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
        }
        const c = (a) => Math.max(-1, Math.min(1, a));
        const share = Math.max(0, c(x1) - c(x0)) * Math.max(0, c(y1) - c(y0)) / 4;
        return { visible: true, nearestM: +nearest.toFixed(3), viewShare: +share.toFixed(3), bbox: [x0, y0, x1, y1].map((a) => +a.toFixed(2)) };
      });
      const file = join(shots, `ghost-${tag}-${v.name}-${moment}.png`);
      await tab.screenshot({ path: file });
      report.views.push({ view: v.name, moment, ...m, file });
    }
    await f.evaluate(() => { const g = __tapstone.play.ghost; if (g.__update) g.update = g.__update; });
    if (v.left) await f.evaluate(() => __tapstone.tile('leftHanded'));
    if (v.contrast) await f.evaluate(() => __tapstone.tile('highContrast'));
    if (v.seated) await f.evaluate(() => __tapstone.tile('seated'));
  }
} catch (e) {
  report.problems.push(String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
}
writeFileSync(join(shots, `ghost-${tag}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
process.exit(report.problems.length ? 1 : 0);
