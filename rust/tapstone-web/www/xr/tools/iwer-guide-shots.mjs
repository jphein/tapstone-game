// iwer-guide-shots.mjs: stills of the guide's ghost hand (guide v2) for review, in IWSDK's managed
// Chromium. It frames the head over the altar as tools/xr_capture does (leaning in, seated), hides the
// emulator's own interface, moves the emulated hands out of shot, and holds the real Ghost (src/guide/
// ghost.js) at one moment of each demo: the claim, the draw, the charge mid-turn and at its touch, the
// cast and the pass. PNGs go to the workspace's .iwsdk/guide-shots/ (gitignored).
//   npx @iwsdk/cli browser run tools/iwer-guide-shots.mjs --timeout 105000
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hideEmulatorChrome } from './xr_capture/page.js';
import { PHASES } from '../src/guide/demo.js';

const at = (name, k = 0.5) => {
  let t = 0;
  for (const [n, ms] of PHASES) {
    if (n === name) return t + ms * k;
    t += ms;
  }
  return t;
};
const SHOTS = [
  { name: 'claim-carry', move: 'claim', from: 'castle', to: { pad: 1 }, t: at('carry', 0.55), say: 'Touch your castle card to the stone.' },
  { name: 'draw-pinch', move: 'draw', from: 'deck', to: { pad: 1 }, t: at('lift', 0.6), say: 'Touch your deck to the stone five times to draw your hand.' },
  { name: 'charge-turning', move: 'charge', from: { slot: 1 }, to: { pad: 0 }, t: at('carry', 0.45), say: 'Turn a card face down and touch it to a pad for mana.' },
  { name: 'charge-touch', move: 'charge', from: { slot: 1 }, to: { pad: 0 }, t: at('touch', 0.9), say: 'Turn a card face down and touch it to a pad for mana.' },
  { name: 'cast-touch', move: 'cast', from: { slot: 2 }, to: { pad: 2 }, t: at('touch', 0.9), say: 'Touch a card face up to a pad to summon it.' },
  { name: 'pass-carry', move: 'pass', from: 'castle', to: { pad: 1 }, t: at('carry', 0.5), say: 'Touch your castle to the stone to end your turn.' },
];

export default async function run({ page, frame, workspaceRoot }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone && __tapstone.play.world.renderer.xr.getSession() && __tapstone.play.handCards.length >= 3, null, { timeout: 60000 });
  await page.evaluate(() => document.querySelector('.workspace-view-switcher')?.style.setProperty('display', 'none', 'important'));
  await f.evaluate(`(${hideEmulatorChrome})()`);
  await f.evaluate(async () => {
    const R = IWER_DEVICE.remote, pl = __tapstone.play;
    const pad = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
    // xr_capture's framing (start.mjs): the head 0.27 m over the altar, looking just past it.
    await R.dispatch('set_transform', { device: 'headset', position: { x: pad.x, y: pad.y + 0.27, z: pad.z + 0.28 } });
    await R.dispatch('look_at', { device: 'headset', target: { x: pad.x, y: pad.y - 0.1, z: pad.z - 0.28 } });
    for (const side of ['left', 'right']) await R.dispatch('set_transform', { device: `hand-${side}`, position: { x: side === 'left' ? -0.6 : 0.6, y: 0.3, z: 0.4 } });
  });
  const dir = join(workspaceRoot, '.iwsdk/guide-shots');
  await mkdir(dir, { recursive: true });
  const out = [];
  for (const s of SHOTS) {
    const info = await f.evaluate((s) => {
      const pl = __tapstone.play, g = pl.ghost;
      const from = pl.spot(s.from), to = pl.spot(s.to);
      pl.ghostHold = true; // keep play.js from re-aiming the ghost at the live lesson meanwhile
      g.show({ move: s.move, from, to }, s.say, 0, pl.captionAt());
      // Hold the demo at t: the real update, fed a frozen clock (restored after the shot).
      g.__update = g.__update ?? g.update.bind(g);
      g.update = (now, o) => g.__update(s.t, o);
      return { from, to };
    }, s);
    await new Promise((r) => setTimeout(r, 900));
    const file = join(dir, `${s.name}.png`);
    await page.screenshot({ path: file });
    out.push({ ...s, file, ...info });
  }
  const render = await f.evaluate(() => __tapstone.render());
  await f.evaluate(() => {
    const pl = __tapstone.play, g = pl.ghost;
    if (g.__update) g.update = g.__update;
    pl.ghostHold = false;
    pl.ghostKey = null;
  });
  return { shots: out.map(({ name, file }) => ({ name, file })), renderWithGhost: render };
}
