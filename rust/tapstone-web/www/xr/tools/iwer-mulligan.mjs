// iwer-mulligan.mjs: the castle's deliberate double-tap still mulligans (logic/carry.js must never
// swallow a second tap). On a fresh page, in hand mode: IWER's emulated hands claim and draw the opening
// five (tools/xr_capture/page.js), then the left hand pinches the castle twice, `gapMs` apart, inside the
// 3 s window. Returns the journal's taps after, which must end with the mulligan ('m').
//   npx @iwsdk/cli browser run tools/iwer-mulligan.mjs --timeout 105000
import { installHands } from './xr_capture/page.js';

export default async function run({ page, frame }, gapMs = 900) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone && __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 30000 });
  await f.evaluate(`(${installHands})();`);
  await f.evaluate(async () => {
    const pl = __tapstone.play, p = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
    await __xrHands.frame({ x: p.x, y: p.y + 0.27, z: p.z + 0.28 }, { x: p.x, y: p.y - 0.1, z: p.z - 0.28 });
    await __xrHands.rest();
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const offered = () => f.evaluate(() => __tapstone.table.choices().some((m) => m.kind === 'Mulligan'));
  for (let n = 0; n < 12 && !(await offered()); n++) {
    const beat = await f.evaluate(() => __tapstone.beats().beat);
    await f.evaluate((k) => __xrHands.move(k, 'hands'), beat === 'draw' ? 'Draw' : null);
    await sleep(800);
  }
  if (!(await offered())) return { ok: false, why: 'the mulligan was never offered' };
  const before = await f.evaluate(() => ({ taps: __tapstone.journal().taps.map((t) => t.key), stats: { ...__tapstone.stats(), voice: undefined } }));
  const lines = [];
  // Two pinches of the castle where it lies, as installHands' press() makes them.
  const pinchCastle = () => f.evaluate(async () => {
    const R = IWER_DEVICE.remote, c = __tapstone.play.altar.castle, v = c.getWorldPosition(c.position.clone());
    const DOWN = { pitch: -60, yaw: 0, roll: 0 }, go = (y, d) => R.dispatch('animate_to', { device: 'hand-left', position: { x: v.x, y: v.y + y, z: v.z }, orientation: DOWN, duration: d });
    await go(0.06, 0.3);
    await go(0.01, 0.2);
    await R.dispatch('set_select_value', { device: 'hand-left', value: 1 });
    await new Promise((r) => setTimeout(r, 200));
    await R.dispatch('set_select_value', { device: 'hand-left', value: 0 });
    await go(0.08, 0.2);
    return __tapstone.play.altar.line;
  });
  const t0 = Date.now();
  lines.push(await pinchCastle());
  await sleep(Math.max(0, gapMs - (Date.now() - t0)));
  lines.push(await pinchCastle());
  await sleep(1500);
  const after = await f.evaluate(() => ({ taps: __tapstone.journal().taps.map((t) => t.key), stats: { ...__tapstone.stats(), voice: undefined } }));
  const added = after.taps.slice(before.taps.length);
  return { ok: added.length === 1 && added[0] === 'm', added, lines, gapMs: Date.now() - t0, before: before.stats, after: after.stats };
}
