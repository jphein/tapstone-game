// iwer-pause.mjs: pause and resume (spec §3.5, logic/pause.js) in IWSDK's managed Chromium. Run it
// twice around an `xr enter`: the first run plays into the match, waits for a move to be offered,
// ENDS the XR session (the real session.end(), so the page's sessionend listener is what pauses it),
// makes one gesture while dark, and checks for 3 s that nothing moved. The second run, after re-entry,
// checks the held gesture landed at the frozen clock and plays the match to the end, returning the
// journal for tools/journal-check.mjs to replay through the wasm.
//
//   npx @iwsdk/cli browser run tools/iwer-forget.mjs && npx @iwsdk/cli browser reload
//   npx @iwsdk/cli xr enter && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
//   npx @iwsdk/cli browser run tools/iwer-pause.mjs --timeout 105000      # phase "dark"
//   npx @iwsdk/cli xr enter && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
//   npx @iwsdk/cli browser run tools/iwer-pause.mjs --timeout 105000      # phase "back" (repeat until done)
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => f.evaluate(() => {
    const j = __tapstone.journal(), p = __tapstone.pause();
    return { taps: j.taps.length, clock: p.clock, playNow: p.playNow, head: j.head, seq: j.seq, match_id: j.match_id, paused: p.paused, reasons: p.reasons, held: p.held, pauses: p.pauses };
  });
  const offered = () => f.evaluate(() => __tapstone.table.choices().some((m) => m.useful && m.kind !== 'Mulligan'));
  const mark = await f.evaluate(() => globalThis.__iwerPause ?? null);

  if (!mark) {
    // Phase "dark". Play a few moves first, so the pause lands mid-match.
    for (let n = 0; n < 60 && (await snap()).taps < 8; n++) {
      await f.evaluate(() => __tapstone.gestureStep());
      await sleep(300);
    }
    while (!(await offered())) await sleep(50);
    const before = await snap();
    const ended = await f.evaluate(async () => {
      const s = __tapstone.play.world.renderer.xr.getSession();
      if (!s) return false;
      await s.end();
      return true;
    });
    await sleep(200);
    const dark = await snap();
    const gesture = await f.evaluate(() => __tapstone.gestureStep()); // made while dark: held
    const trail = [];
    for (let k = 0; k < 6; k++) {
      await sleep(500);
      trail.push(await snap());
    }
    await f.evaluate((m) => (globalThis.__iwerPause = m), { before, dark, gesture });
    const still = trail.every((s) => s.paused && s.clock === dark.clock && s.playNow === dark.playNow && s.taps === before.taps && s.held === 1);
    return { phase: 'dark', ended, before, dark, gesture, last: trail.at(-1), still };
  }

  // Phase "back", after `xr enter`.
  await f.waitForFunction(() => !__tapstone.pause().paused, null, { timeout: 20000 });
  await sleep(300);
  const back = await snap();
  const heldTap = await f.evaluate((n) => __tapstone.journal().taps[n] ?? null, mark.before.taps);
  const until = Date.now() + 90000;
  let done = await f.evaluate(() => __tapstone.stats().done);
  while (!done && Date.now() < until) {
    await f.evaluate(() => __tapstone.gestureStep());
    await sleep(300);
    done = await f.evaluate(() => __tapstone.stats().done);
  }
  const journal = await f.evaluate(() => {
    const { resumed, ...j } = __tapstone.journal();
    return j;
  });
  const checks = {
    resumedOnce: back.pauses === 1 && !back.paused && back.held === 0,
    heldTapLanded: back.taps >= mark.before.taps + 1 && heldTap !== null,
    heldTapAtFrozenClock: heldTap?.at === mark.dark.clock,
    sameMatch: journal.match_id === mark.before.match_id,
    done,
  };
  return { phase: 'back', mark, back, heldTap, checks, final: journal.final, journal };
}
