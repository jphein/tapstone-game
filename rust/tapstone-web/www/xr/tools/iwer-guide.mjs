// iwer-guide.mjs: the guide v2 in IWSDK's managed Chromium: a learner follows the guide through a whole
// match (each move the one the lesson shows, through play()'s gesture path; the claim through the
// castle), and every lesson the guide spoke is returned with contradicts()'s verdict (guide/lesson.js).
// Pass: done, and no lesson with a `why`. Loop it like iwer-match.mjs until done (95 s per lease).
//   npx @iwsdk/cli browser run tools/iwer-forget.mjs && npx @iwsdk/cli browser reload
//   npx @iwsdk/cli xr enter && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
//   npx @iwsdk/cli browser run tools/iwer-guide.mjs --timeout 105000
export const LEARN = { draw: 'Draw', flip: 'Charge', mana: 'Charge', cast: 'CastUnit', pass: 'Pass' };

// One learner step in the page: the lesson's move, or (nothing to learn) the web gate's. Like a person,
// the learner waits for the altar to finish speaking (the line queue idle) before acting.
export async function learn(f) {
  return await f.evaluate((LEARN) => {
    const pl = __tapstone.play, l = pl.guide.lesson;
    // #200's first-run offer comes first (the guide waits for it): answer it with the hands.
    if (__tapstone.assist?.().offerShown) return (__tapstone.tile('offer.hands'), 'offer');
    if (pl.lines.busy || pl.lines.waiting.some((w) => w.kind !== 'status')) return null;
    if (l.id === 'claim') return (pl.castleTap(), 'claim');
    if (l.id === 'place') return null;
    return __tapstone.gestureStep(LEARN[l.id]);
  }, LEARN);
}

export async function report(f) {
  return await f.evaluate(() => {
    const g = __tapstone.guide();
    return { done: __tapstone.stats().done, stats: { taps: __tapstone.stats().taps, refused: __tapstone.stats().refused }, log: g.log, contradictions: g.log.filter((l) => l.why), lines: g.lines, history: g.history };
  });
}

export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 95000;
  while (Date.now() < until && !(await f.evaluate(() => __tapstone.stats().done))) {
    await learn(f);
    await sleep(350);
  }
  return await report(f);
}
