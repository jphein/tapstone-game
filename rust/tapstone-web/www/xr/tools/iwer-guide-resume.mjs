// iwer-guide-resume.mjs: JP's Quest 2 case (2026-09-28) in IWSDK's managed Chromium. A match played to
// round 3 without ever charging (so no unit is ever affordable), the page reloaded (the journal resumes
// the match), then a learner follows the guide to the end. The guide must open on how to charge, never
// go back to "claim" or "draw", and no lesson may contradict the state (contradicts(), guide/lesson.js).
// Run it (after iwer-forget.mjs and a reload, in XR, hand mode) until done: the first lease plays to
// round 3 and reloads; the next ones follow the guide.
//   npx @iwsdk/cli browser run tools/iwer-guide-resume.mjs --timeout 105000
import { learn, report } from './iwer-guide.mjs';

async function appFrame(page) {
  for (const until = Date.now() + 30000; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) {
    for (const f of page.frames()) if (await f.evaluate(() => !!globalThis.__tapstone).catch(() => false)) return f;
  }
  throw new Error('no __tapstone after the reload');
}

export default async function run({ page }) {
  let f = await appFrame(page);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const phase = await f.evaluate(() => sessionStorage.getItem('tapstone.guide-resume'));
  if (!phase) {
    // Play like JP: draws, advances and passes, never a charge or a cast.
    const until = Date.now() + 90000;
    for (;;) {
      const s = await f.evaluate(() => {
        const v = __tapstone.play.view, m = __tapstone.table.choices();
        return { round: v?.round ?? 0, active: v?.active, owed: v?.seats?.[0]?.owed_draws ?? 1, charge: m.some((x) => x.kind === 'Charge'), done: __tapstone.stats().done };
      });
      if (s.done) return { phase: 'setup', error: 'the match ended before round 3' };
      if (s.round >= 3 && s.active === 0 && s.owed === 0 && s.charge) break;
      if (Date.now() > until) return { phase: 'setup', error: 'timeout', s };
      await f.evaluate(() => {
        const pl = __tapstone.play;
        if (pl.guide.lesson.id === 'claim') return pl.castleTap();
        const menu = __tapstone.table.choices();
        const item = menu.find((m) => m.useful && ['Draw', 'Advance', 'Pass'].includes(m.kind));
        if (item) pl.play({ Draw: { source: 'deck' }, Advance: { source: 'lane', pad: item.lane }, Pass: { source: 'castle', action: 'pass' } }[item.kind]);
      });
      await sleep(250);
    }
    const before = await f.evaluate(() => ({ round: __tapstone.play.view.round, taps: __tapstone.journal().taps.map((t) => t.key) }));
    await f.evaluate(() => sessionStorage.setItem('tapstone.guide-resume', 'follow'));
    await page.reload();
    f = await appFrame(page);
    await sleep(1500);
    const after = await f.evaluate(() => ({ resumed: __tapstone.journal().resumed, round: __tapstone.play.view?.round, first: __tapstone.guide().log[0] ?? null, lesson: __tapstone.guide().lesson }));
    return { phase: 'setup', before: { round: before.round, taps: before.taps.length, charges: before.taps.filter((k) => k.startsWith('c/')).length }, after, done: false };
  }
  const until = Date.now() + 95000;
  while (Date.now() < until && !(await f.evaluate(() => __tapstone.stats().done))) {
    await learn(f);
    await sleep(350);
  }
  const r = await report(f);
  if (r.done) await f.evaluate(() => sessionStorage.removeItem('tapstone.guide-resume'));
  return { phase: 'follow', ...r };
}
