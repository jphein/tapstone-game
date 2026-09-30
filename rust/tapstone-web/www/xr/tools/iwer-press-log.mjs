// iwer-press-log.mjs: every route a hand move takes into play.js, logged with its time, as IWER's
// emulated hands play a match (tools/xr_capture/page.js's installHands: pinch a card, carry it to a pad,
// let go; poke a pad; pinch the castle). It wraps the live PlaySystem's entry points from outside, so
// the game's code is what runs:
//   lift      the eyes-and-hands path: a card or the deck was Pressed (pinch-selected)
//   pad       a pad was Pressed (poke or ray-pinch), with the fingertip distances and whether a card was lifted
//   touch     the touch path: a held card met a pad (checkTouches)
//   play      what a gesture resolved to: tap <label>, refused <reason>, target, guarded
//   held      a held card's offset from the nearest pad (flat, up, in mm), every 50 ms
//   hand      an emulated-hand command: a pinch (set_select_value) or a move (animate_to), per side
// Runs up to 95 s per call; call it again until done (like iwer-match.mjs). On a fresh page, in hand mode.
//   npx @iwsdk/cli browser run tools/iwer-press-log.mjs --timeout 105000
import { installHands } from './xr_capture/page.js';

const KIND = { draw: 'Draw', flip: 'Charge', cast: 'CastUnit', pass: 'Pass' };

export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone && __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 30000 });
  await f.evaluate(`(${installHands})();`);
  await f.evaluate(async () => {
    if (globalThis.__pressLog) return;
    const L = (globalThis.__pressLog = []);
    const pl = __tapstone.play, T = () => Math.round(performance.now());
    const hands = () => [...(pl.world.renderer.xr.getSession()?.inputSources ?? [])].map((s) => s.handedness);
    const wrap = (name, fn) => {
      const orig = pl[name].bind(pl);
      pl[name] = (...a) => fn(orig, ...a);
    };
    wrap('liftCard', (o, slot) => (L.push({ t: T(), ev: 'lift', source: 'hand', slot }), o(slot)));
    wrap('lift', (o, l) => (l.source !== 'hand' && L.push({ t: T(), ev: 'lift', source: l.source }), o(l)));
    wrap('padPressed', (o, lane, e) => {
      L.push({ t: T(), ev: 'pad', lane, lifted: pl.lifted ? pl.lifted.source : null, tips: pl.fingertipDistanceTo(e).map((d) => Math.round(d * 1000)), hands: hands() });
      return o(lane, e);
    });
    // The emulated hands' own commands (installHands drives IWER_DEVICE.remote), so each press can be
    // placed in its move: the approach, the pinch, the carry, the release, the return to rest.
    const R = IWER_DEVICE.remote, dispatch = R.dispatch.bind(R);
    R.dispatch = (cmd, arg) => {
      if (/^hand-/.test(arg?.device ?? '')) L.push({ t: T(), ev: 'hand', cmd, side: arg.device.slice(5), ...(cmd === 'set_select_value' ? { pinch: arg.value } : { to: arg.position && [arg.position.x, arg.position.y, arg.position.z].map((v) => Math.round(v * 1000)), dur: arg.duration }) });
      return dispatch(cmd, arg);
    };
    // While something is held: its offset from the nearest pad centre, each frame (what the touch path
    // tests: flat <= 45 mm and 0 <= up <= 30 mm), at most one sample per 50 ms.
    const V = pl.root.position.constructor;
    let lastHeld = 0;
    wrap('checkTouches', (o) => {
      const held = [...pl.queries.heldCards.entities, ...pl.queries.heldDeck.entities];
      if (held.length && T() - lastHeld >= 50) {
        lastHeld = T();
        const p = held[0].object3D.getWorldPosition(new V());
        let best = null;
        for (const m of pl.altar.pads.map((x) => x.m)) {
          const q = m.getWorldPosition(new V()), flat = Math.hypot(p.x - q.x, p.z - q.z);
          if (!best || flat < best.flat) best = { flat, up: p.y - q.y, lane: pl.altar.pads.findIndex((x) => x.m === m) };
        }
        L.push({ t: T(), ev: 'held', lane: best.lane, flat: Math.round(best.flat * 1000), up: Math.round(best.up * 1000) });
      }
      return o();
    });
    wrap('castleTap', (o) => (L.push({ t: T(), ev: 'castle' }), o()));
    const touches = pl.stats.touch;
    wrap('play', (o, g) => {
      const s0 = { ...pl.stats }, line0 = pl.altar.line;
      const via = pl.stats.touch !== (pl.__lastTouch ?? touches) ? 'touch' : null;
      pl.__lastTouch = pl.stats.touch;
      o(g);
      const out = pl.stats.taps > s0.taps ? `tap ${pl.altar.line}` : pl.stats.refused > s0.refused ? `refused ${pl.altar.line}` : pl.stats.guarded > s0.guarded ? 'guarded' : pl.target.active ? 'target' : pl.pause.paused ? 'held' : `other (${line0 === pl.altar.line ? 'same line' : pl.altar.line})`;
      L.push({ t: T(), ev: 'play', via, g: { ...g }, out });
    });
    __tapstone.play.world.renderer.xr.getSession(); // (session checked above)
    const p = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
    await __xrHands.frame({ x: p.x, y: p.y + 0.27, z: p.z + 0.28 }, { x: p.x, y: p.y - 0.1, z: p.z - 0.28 });
    await __xrHands.rest();
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 90000;
  let done = false;
  while (!done && Date.now() + 8000 < until) {
    const s = await f.evaluate(() => ({ done: __tapstone.stats().done, beat: __tapstone.beats().beat }));
    if ((done = s.done)) break;
    const label = await f.evaluate((k) => __xrHands.move(k, 'hands'), KIND[s.beat] ?? null);
    if (label === null) await sleep(300);
    else await sleep(1200); // let the voice line play (no audio tap here to wait on)
  }
  return await f.evaluate((done) => ({
    done,
    stats: { ...__tapstone.stats(), voice: undefined },
    voice: { cut: __tapstone.stats().voice.cut, played: __tapstone.stats().voice.played },
    hands: { hand: __xrHands.hand, fallbacks: __xrHands.fallbacks },
    moves: __xrHands.log.map((m) => ({ t: Math.round(m.t), kind: m.kind, how: m.how })),
    log: globalThis.__pressLog,
  }), done);
}
