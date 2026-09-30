// iwer-guide-b60.mjs: the guide v2 with #200's first-run offer, in IWER, on the Intel Arc Pro B60
// (it launches its own Chromium as tools/iwer-assist.mjs does; tools/xr_capture/gpu.mjs checks the
// renderer). Against a running dev server (`npx @iwsdk/cli dev up --headless --no-open`):
//
//   1. a fresh first run: the offer is shown and the guide says nothing until it is answered (ORDER);
//      answered with the hands (the offer tile) or by head gaze (a real dwell on its tile);
//   2. --resume: JP's Quest 2 case instead: a match played to round 3 without ever charging, the page
//      reloaded (the journal resumes it; the offer is already answered), and the guide must open on
//      how to charge, never on "claim" or "draw";
//   3. the learner then plays what the guide teaches, in the chosen mode: IWER's emulated HANDS
//      (tools/xr_capture/page.js installHands: pinch, carry, touch) or HEAD GAZE (the headset turned to
//      each of #200's gazeForItem targets until the page's own dwell fires). A move the mode can't land
//      goes through gestureStep() and counts as a fallback. Paced by the voice: it waits for the line
//      queue to be quiet, as a person listening would;
//   4. every lesson the guide spoke, with contradicts()'s verdict (guide/lesson.js), the lines the queue
//      started, refusals, fallbacks, and stills of the demo (the ghost hand, or the gaze ring).
//
//   node tools/iwer-guide-b60.mjs --mode hands|gaze [--resume] [--shots <dir>] [--max-s 240]
// Prints one JSON report and writes it to <shots>/guide-<mode>[-resume].json. Exit 1 on a problem.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions, rendererProblem, defaultGpu } from './xr_capture/gpu.mjs';
import { installHands, hideEmulatorChrome } from './xr_capture/page.js';
import { gazeForItem, keyOf } from '../src/logic/gaze.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const mode = opt('--mode', 'hands');
const resume = argv.includes('--resume');
const gpu = opt('--gpu', defaultGpu());
const shots = opt('--shots', join(root, '.iwsdk/guide-b60'));
const maxMs = Number(opt('--max-s', 240)) * 1000;
// --bare: the ghost and the fan's grip out of play (hidden, the grip moved off the table), to tell
// whether a fallback is theirs or the emulated hand's.
const bare = argv.includes('--bare');
const name = `guide-${mode}${resume ? '-resume' : ''}${bare ? '-bare' : ''}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(`[${name}]`, ...a);
mkdirSync(shots, { recursive: true });

const status = JSON.parse(execFileSync('npx', ['@iwsdk/cli', 'dev', 'status', '--json'], { cwd: root, encoding: 'utf8' }));
const url = status.runtimeUrls?.local ?? JSON.stringify(status).match(/https:\/\/localhost:\d+\//)?.[0];
if (!url) throw new Error('no dev server (iwsdk dev status)');

const LEARN = { draw: 'Draw', flip: 'Charge', mana: 'Charge', cast: 'CastUnit', pass: 'Pass' };
const launch = launchOptions(gpu);
launch.args.push('--autoplay-policy=no-user-gesture-required');
const browser = await chromium.launch(launch);
const report = { mode, resume, url, gpu, started: new Date().toISOString(), problems: [], shots: [] };
const problem = (s) => (report.problems.push(s), log('PROBLEM', s));
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const tab = await context.newPage();
  const appFrame = async () => {
    for (const end = Date.now() + 60000; Date.now() < end; await sleep(400)) {
      for (const fr of tab.frames()) if (await fr.evaluate(() => !!globalThis.__tapstone?.assist && !!globalThis.__tapstone?.guide).catch(() => false)) return fr;
    }
    throw new Error('no Tapstone frame');
  };
  const enter = async (f) => {
    await f.waitForFunction(() => __tapstone.coldStart().loaded, null, { timeout: 60000 });
    await f.evaluate(() => IWER_DEVICE.remote.dispatch('accept_session'));
    await f.waitForFunction(() => __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 15000 });
    await f.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
    await f.waitForFunction(() => __tapstone.play.placed, null, { timeout: 15000 });
    await tab.evaluate(() => document.querySelector('.workspace-view-switcher')?.style.setProperty('display', 'none', 'important'));
    await f.evaluate(`(${hideEmulatorChrome})(); (${installHands})();`);
    // Lean in over the altar (xr_capture's framing), hands at rest.
    await f.evaluate(async () => {
      const pl = __tapstone.play, p = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
      await __xrHands.frame({ x: p.x, y: p.y + 0.27, z: p.z + 0.28 }, { x: p.x, y: p.y - 0.1, z: p.z - 0.28 });
      await __xrHands.rest();
    });
    await sleep(600);
  };
  const shot = async (f, label) => {
    const p = join(shots, `${name}-${label}.png`);
    await tab.screenshot({ path: p });
    report.shots.push(p);
  };
  const quiet = (f, ms = 8000) => f.waitForFunction(() => { const l = __tapstone.play.lines; return !l.busy && !l.waiting.some((w) => w.kind !== 'status'); }, null, { timeout: ms, polling: 100 }).catch(() => null);

  // Look at a gaze target until the page's dwell fires, then look away (as iwer-assist.mjs does).
  const away = (f) => f.evaluate(() => {
    const w = __tapstone.play.root.localToWorld(__tapstone.play.root.position.clone().set(0, 0.6, -0.6));
    return IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: w.x, y: w.y, z: w.z } });
  });
  const dwellOn = async (f, key, timeout = 6000) => {
    const t = (await f.evaluate(() => __tapstone.gazeTargets())).find((x) => x.key === key);
    if (!t) return false;
    const before = (await f.evaluate(() => __tapstone.assist())).gaze.stats.fired;
    await f.evaluate((p) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: p }), { x: t.x, y: t.y, z: t.z });
    for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(60)) {
      if ((await f.evaluate(() => __tapstone.assist())).gaze.stats.fired > before) return (await away(f), await sleep(450), true);
    }
    await away(f);
    await sleep(450);
    return false;
  };

  await tab.goto(url, { waitUntil: 'load' });
  let f = await appFrame();
  // A first run: no journal, no stored settings (the offer unanswered), no stored fan spot.
  await f.evaluate(() => { for (const k of ['tapstone.xr.journal', 'tapstone.access', 'tapstone.hand']) localStorage.removeItem(k); });
  await tab.reload({ waitUntil: 'load' });
  f = await appFrame();
  report.renderer = await f.evaluate(() => { const g = __tapstone.play.world.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; });
  const wrong = rendererProblem(gpu, report.renderer);
  if (wrong) problem(wrong);
  await enter(f);

  // 1. ORDER: the offer first; the guide silent until it is answered.
  await sleep(3000);
  const before = await f.evaluate(() => ({ offer: __tapstone.assist().offerShown, lesson: __tapstone.guide().lesson.id, log: __tapstone.guide().log.length, lines: __tapstone.guide().lines.filter((l) => l.kind === 'lesson').map((l) => l.text) }));
  report.order = { beforeAnswer: before };
  if (!before.offer) problem('the first-run offer was not shown');
  if (before.log || before.lesson !== 'wait' || before.lines.length) problem(`the guide spoke before the offer was answered: ${JSON.stringify(before)}`);
  await shot(f, '01-offer-guide-waits');
  const answered = mode === 'gaze' ? await dwellOn(f, 'tile:offer.gaze') : await f.evaluate(() => __tapstone.tile('offer.hands'));
  if (!answered) problem('the offer could not be answered');
  await sleep(500);
  report.order.after = await f.evaluate(() => ({ access: { gaze: __tapstone.assist().access.gaze, voice: __tapstone.assist().access.voice, offered: __tapstone.assist().access.offered }, first: __tapstone.guide().lines.slice(-3).map((l) => [l.kind, l.text]) }));

  // 2. JP's case: to round 3 without charging, then a reload.
  if (resume) {
    for (const end = Date.now() + 120000; Date.now() < end;) {
      const s = await f.evaluate(() => { const v = __tapstone.play.view, m = __tapstone.table.choices(); return { round: v?.round ?? 0, active: v?.active, owed: v?.seats?.[0]?.owed_draws ?? 1, charge: m.some((x) => x.kind === 'Charge'), done: __tapstone.stats().done }; });
      if (s.done) break;
      if (s.round >= 3 && s.active === 0 && s.owed === 0 && s.charge) break;
      await f.evaluate(() => {
        const pl = __tapstone.play;
        if (pl.guide.lesson.id === 'claim') return pl.castleTap();
        const item = __tapstone.table.choices().find((m) => m.useful && ['Draw', 'Advance', 'Pass'].includes(m.kind));
        if (item) pl.play({ Draw: { source: 'deck' }, Advance: { source: 'lane', pad: item.lane }, Pass: { source: 'castle', action: 'pass' } }[item.kind]);
      });
      await sleep(200);
    }
    const setup = await f.evaluate(() => ({ round: __tapstone.play.view.round, taps: __tapstone.journal().taps.map((t) => t.key) }));
    report.resumeSetup = { round: setup.round, taps: setup.taps.length, charges: setup.taps.filter((k) => k.startsWith('c/')).length };
    await tab.reload({ waitUntil: 'load' });
    f = await appFrame();
    await enter(f);
    const r = await f.evaluate(() => ({ resumed: __tapstone.journal().resumed, offerShown: __tapstone.assist().offerShown }));
    report.resumeSetup.after = { from: r.resumed.from, taps: r.resumed.taps, offerShown: r.offerShown };
    if (r.resumed.from !== 'journal') problem('the reload did not resume the match');
  }

  if (bare) await f.evaluate(() => { const pl = __tapstone.play; pl.ghostHold = true; pl.ghost.hide(); pl.hand.grip.visible = false; pl.hand.grip.position.set(5, 5, 5); });
  // 3. The learner.
  const stats0 = await f.evaluate(() => ({ ...__tapstone.stats(), voice: undefined }));
  let fallbacks = 0, moves = 0, gazeFired = 0, shotDemo = false;
  for (const end = Date.now() + maxMs; Date.now() < end;) {
    if (await f.evaluate(() => __tapstone.stats().done)) break;
    await quiet(f);
    const l = await f.evaluate(() => { const pl = __tapstone.play; return { id: pl.guide.lesson.id, item: pl.guide.lesson.item ?? null, hand: pl.handCards.map((c) => ({ card: c.card, name: c.name })), menu: __tapstone.table.choices(), ghost: pl.ghost.visible && !!pl.ghost.demo }; });
    if (!shotDemo && !bare && l.ghost && ['flip', 'mana', 'cast'].includes(l.id)) {
      // Stills of the demo in this mode (the ghost hand mid-carry, or the gaze ring mid-fill), then
      // the same under #200's high contrast, then (once) the voice mode's phrase on the caption.
      const frameHead = () => f.evaluate(async () => {
        const pl = __tapstone.play, p = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
        await __xrHands.frame({ x: p.x, y: p.y + 0.27, z: p.z + 0.28 }, { x: p.x, y: p.y - 0.1, z: p.z - 0.28 });
      });
      const demoMoment = () => (mode === 'gaze'
        ? f.waitForFunction(() => { const g = __tapstone.play.ghost; return g.gazeRing.visible && g.gazeRing.material.uniforms.progress.value > 0.35 && g.gazeRing.material.uniforms.progress.value < 0.8; }, null, { timeout: 8000, polling: 30 }).catch(() => null)
        : f.waitForFunction(() => { const g = __tapstone.play.ghost; return g.hand.visible && g.card.visible; }, null, { timeout: 8000, polling: 30 }).catch(() => null));
      await frameHead();
      await demoMoment();
      await shot(f, `02-demo-${l.id}`);
      // The guide's frame cost here (renderer.info, median of 15 frames; two XR views): the demo and
      // the fan's grip shown, then both hidden, in the same state.
      report.budget = await f.evaluate(async () => {
        const pl = __tapstone.play, g = pl.ghost, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const sample = async () => {
          const s = [];
          for (let k = 0; k < 15; k++) (s.push({ ...__tapstone.render() }), await sleep(40));
          const med = (key) => s.map((x) => x[key]).sort((a, b) => a - b)[7];
          return { calls: med('calls'), triangles: med('triangles') };
        };
        const shown = await sample();
        g.group.visible = false;
        pl.hand.grip.visible = false;
        await sleep(200);
        const hidden = await sample();
        g.group.visible = true;
        pl.hand.grip.visible = true;
        const cap = g.caption.tex.image;
        return { shown, hidden, added: { calls: shown.calls - hidden.calls, triangles: shown.triangles - hidden.triangles }, captionMB: +((cap.width * cap.height * 4) / 1048576).toFixed(3) };
      });
      await f.evaluate(() => __tapstone.tile('highContrast'));
      await sleep(400);
      await demoMoment();
      await shot(f, `03-demo-${l.id}-high-contrast`);
      await f.evaluate(() => __tapstone.tile('highContrast'));
      if (mode === 'hands') {
        await f.evaluate(() => __tapstone.tile('voice')); // voice mode's demo: the phrase to say
        await sleep(1200);
        await shot(f, `04-demo-${l.id}-voice-caption`);
        report.voiceCaption = await f.evaluate(() => __tapstone.play.ghost.said);
        await f.evaluate(() => __tapstone.tile('voice'));
        await sleep(600);
      }
      shotDemo = true;
    }
    const taps0 = await f.evaluate(() => __tapstone.stats().taps);
    if (mode === 'hands') {
      const kind = LEARN[l.id] ?? null;
      const label = await f.evaluate((k) => __xrHands.move(k, 'hands'), kind);
      if (label === null) await sleep(300);
      else moves++;
      continue;
    }
    // Gaze: the lesson's item (or, with nothing to learn, the web gate's), dwelt on target by target.
    const item = l.id === 'claim' ? { kind: 'Claim' } : l.item ?? l.menu.find((m) => m.useful && m.kind !== 'Mulligan');
    if (!item) {
      await sleep(300);
      continue;
    }
    const steps = item.kind === 'Claim' ? [{ kind: 'castle' }] : gazeForItem(item, l.hand);
    let ok = !!steps;
    for (const t of steps ?? []) {
      if (!(await dwellOn(f, keyOf(t)))) ok = false;
      else gazeFired++;
    }
    moves++;
    await sleep(400);
    const landed = await f.evaluate((t0) => __tapstone.stats().taps > t0 || __tapstone.play.guide.lesson.id !== 'claim', taps0);
    if (!ok || (item.kind !== 'Claim' && !landed)) {
      fallbacks++;
      await f.evaluate((k) => __tapstone.gestureStep(k), item.kind === 'Claim' ? null : item.kind);
    }
  }
  const out = await f.evaluate(() => {
    const g = __tapstone.guide(), s = __tapstone.stats();
    return { done: s.done, taps: s.taps, refused: s.refused, guarded: s.guarded, voice: { played: s.voice.played, cut: s.voice.cut, blocked: s.voice.blocked }, hands: globalThis.__xrHands ? { hand: __xrHands.hand, fallbacks: __xrHands.fallbacks, missed: __xrHands.log.filter((m) => m.how !== 'hand').map((m) => ({ t: Math.round(m.t), kind: m.kind, label: m.label, how: m.how, error: m.error ?? null })) } : null, gaze: __tapstone.assist().gaze.stats, log: g.log, lines: g.lines, net: (globalThis.__tapstoneNet ?? globalThis.__spikeNet)?.after?.length ?? null, render: __tapstone.render() };
  });
  report.result = { ...out, moves, gazeFired, fallbacks: mode === 'hands' ? out.hands?.fallbacks ?? null : fallbacks, refusedDuring: out.refused - stats0.refused };
  report.contradictions = out.log.filter((x) => x.why);
  report.lessons = out.log.map((x) => x.id);
  if (!out.done) problem('the match did not finish in time');
  if (report.contradictions.length) problem(`${report.contradictions.length} lessons contradicted the state`);
  if (resume) {
    const firstTeach = report.lessons.find((id) => id !== 'place');
    if (firstTeach !== 'flip') problem(`the resumed guide opened on ${firstTeach}, not flip`);
    if (report.lessons.includes('claim') || report.lessons.includes('draw')) problem('the resumed guide went back to claim or draw');
  }
  if (out.net) problem(`${out.net} requests after "loaded"`);
} catch (e) {
  problem(String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
}
writeFileSync(join(shots, `${name}.json`), JSON.stringify(report, null, 2));
const { lines, log: _l, ...brief } = report.result ?? {};
console.log(JSON.stringify({ ...report, result: brief }, null, 1));
process.exit(report.problems.length ? 1 : 0);
