// drive.mjs (called by capture.mjs with its page): plays the capture's segment for at most 95 s (it also
// fits an `iwsdk browser run` lease, 110 s) and returns { done }; capture.mjs calls it again until done.
// The recording lives in the page, so it runs on across calls.
//   idle      no input for control.seconds (the test's short run)
//   match     from a fresh page: the first five minutes' beats, then the match to its end
//   teahouse  the same match, turning toward each cast's door as it lands (0039: a cast stirs its
//             faction's door) and, at the end, to the winner's door
// Moves are paced by the voice: the next move waits for the line to finish, so each is heard whole.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CARD_FACTION } from '../../src/logic/doors.js';
import { DOORS, doorCenter } from '../../src/logic/layout.js';

// The beat a first-five step teaches, as the menu kind that answers it (iwer-first-five.mjs).
const KIND = { draw: 'Draw', flip: 'Charge', cast: 'CastUnit', pass: 'Pass' };
const LEASE_MS = 95000;

export default async function run({ page, frame, workspaceRoot }) {
  const f = frame ?? page;
  const c = JSON.parse(await readFile(join(workspaceRoot, '.iwsdk/xr-capture/control.json'), 'utf8'));
  const doors = Object.fromEntries(DOORS.map((d) => [d.faction, doorCenter(d)]));
  const until = Date.now() + LEASE_MS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const elapsed = () => f.evaluate(() => (performance.now() - __xrCapture.t0) / 1000);
  const moves = [];
  for (;;) {
    const t = await elapsed();
    if (c.maxSeconds && t >= c.maxSeconds) return { done: true, why: 'maxSeconds', t, moves };
    if (c.segment === 'idle') {
      // --pan: one real head turn across the take (IWER animates it); the scene is left to itself.
      if (c.pan && !c.panned) (c.panned = true), f.evaluate(([deg, s]) => __xrHands.pan(deg, s), [c.pan, Math.max(1, c.seconds - t - 0.5)]);
      if (t >= c.seconds) return { done: true, why: 'seconds', t };
      await sleep(Math.min(250, (c.seconds - t) * 1000));
      continue;
    }
    if (Date.now() + 8000 > until) return { done: false, t, moves };
    const s = await f.evaluate(() => ({ done: __tapstone.stats().done, beat: __tapstone.beats().beat }));
    if (s.done) {
      await f.evaluate(() => __xrCapture.mark('over'));
      if (c.segment === 'teahouse') {
        const winner = await f.evaluate(() => {
          const v = __tapstone.play.view;
          const b = v && (v.phase === 'lobby' && v.last_over ? v.last_over : v);
          return b?.winner != null ? b.seats?.[b.winner]?.faction ?? null : null;
        });
        if (winner && doors[winner]) await f.evaluate(async (d) => { const w = __tapstone.play.root.localToWorld(__tapstone.play.root.position.clone().set(d.x, d.y, d.z)); await __xrHands.lookAt(w, 1.5); }, doors[winner]);
        await sleep(6000);
      } else await f.evaluate(() => __xrHands.quiet(8000)), await sleep(2500);
      return { done: true, why: 'over', t: await elapsed(), moves };
    }
    // Tea house: a cast stirs its faction's door, and the glow is gone in 1.25 s (teahouse.js decays
    // it at 0.8/s), so the head turns BEFORE the cast lands: most of the way to the door, the altar
    // still at the edge of view. It holds while the door glows, then comes back to the altar.
    const next = c.segment === 'teahouse' ? await f.evaluate((k) => __xrHands.peek(k), KIND[s.beat] ?? null) : null;
    const faction = next && /^Cast/.test(next.kind) ? Object.entries(CARD_FACTION).find(([n]) => next.label.includes(n))?.[1] : null;
    if (faction) {
      await f.evaluate(async (d) => {
        const pl = __tapstone.play, m = pl.altar.pads[1].m, a = m.getWorldPosition(m.position.clone());
        const w = pl.root.localToWorld(pl.root.position.clone().set(d.x, d.y, d.z));
        __xrCapture.mark('door', { door: d });
        await __xrHands.lookAt({ x: a.x + (w.x - a.x) * 0.7, y: a.y + (w.y - a.y) * 0.7, z: a.z + (w.z - a.z) * 0.7 }, 1.0);
      }, doors[faction]);
    }
    const label = await f.evaluate(([k, input]) => __xrHands.move(k, input), [KIND[s.beat] ?? null, c.input]);
    if (label === null) {
      await sleep(300); // the other side's turn, or nothing useful yet
      continue;
    }
    moves.push(label);
    if (faction) {
      await sleep(1800);
      await f.evaluate(async () => { const pl = __tapstone.play, m = pl.altar.pads[1].m; const p = m.getWorldPosition(m.position.clone()); await __xrHands.lookAt({ x: p.x, y: p.y - 0.1, z: p.z - 0.28 }, 1.0); });
    }
    await f.evaluate(() => __xrHands.quiet(6000));
    await sleep(500);
  }
}
