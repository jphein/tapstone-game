// iwer-first-five.mjs: the first five minutes (spec §3.4) walked in IWSDK's managed Chromium, logging
// each beat's voice line. Every move goes through play() (gestureStep, preferring the beat's own
// kind), and the claim beat's castle tap through castleTap(), the method the castle's Pressed calls.
//
//   npx @iwsdk/cli dev up --headless --allow-browser-automation   (its own port; not nx-m1b-iwer's)
//   npx @iwsdk/cli browser run tools/iwer-forget.mjs && npx @iwsdk/cli browser reload   # a fresh match: a stored journal resumes otherwise
//   npx @iwsdk/cli xr enter
//   npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
//   npx @iwsdk/cli browser run tools/iwer-first-five.mjs --timeout 105000
//
// It stops once `untilBeat` (default 'bot', i.e. beats 1-6 done) starts, or after 95 s (the lease).
const KIND = { draw: 'Draw', flip: 'Charge', cast: 'CastUnit', pass: 'Pass' };

export default async function run({ page, frame }, untilBeat = 'bot') {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 95000;
  const trail = [];
  for (;;) {
    // #200's first-run offer comes first (the guide waits for it): answer it with the hands.
    await f.evaluate(() => __tapstone.assist?.().offerShown && __tapstone.tile('offer.hands'));
    const b = await f.evaluate(() => __tapstone.beats());
    if (b.done || b.beat === untilBeat || Date.now() > until) break;
    if (b.beat === 'claim') trail.push(await f.evaluate(() => (__tapstone.play.castleTap(), 'castle')));
    else if (KIND[b.beat]) trail.push(await f.evaluate((k) => __tapstone.gestureStep(k), KIND[b.beat]));
    await sleep(700);
  }
  const beats = await f.evaluate(() => __tapstone.beats());
  const stats = await f.evaluate(() => __tapstone.stats());
  return { beats, stats, trail };
}
