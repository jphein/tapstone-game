// iwer-profile.mjs: the M3 frame-time measurement (VR spec §5 MVP 10) in IWSDK's managed Chromium:
// a whole match through the gesture path, exactly as tools/iwer-match.mjs plays it, with the page's
// frame log (src/logic/frames.js) reset once at the match's first run. Loop it like iwer-match.mjs:
//
//   until npx @iwsdk/cli browser run tools/iwer-profile.mjs --timeout 105000 | tee -a profile.json | grep -q '"done": true'; do :; done
//
// The last run's `frames` is the whole match's report: percentiles of the frame interval, our own
// per-frame work, and the worst frames with what ran in them. It is a desktop GPU emulating a
// headset, so it says how heavy OUR frames are, never whether a Quest 2 holds 60 fps.
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const fresh = await f.evaluate(() => {
    if (globalThis.__tapstoneProfiling) return false;
    globalThis.__tapstoneProfiling = true;
    return __tapstone.framesReset();
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 95000;
  let steps = 0;
  let done = await f.evaluate(() => __tapstone.stats().done);
  for (; Date.now() < until && !done; steps++) {
    await f.evaluate(() => __tapstone.gestureStep());
    done = await f.evaluate(() => __tapstone.stats().done);
    if (!done) await sleep(300);
  }
  if (done) await sleep(2500); // the result's effect and sound (2 s) play inside the window
  const frames = await f.evaluate(() => __tapstone.frames({ worst: 12 }));
  const stats = await f.evaluate(() => __tapstone.stats());
  const beats = await f.evaluate(() => __tapstone.beats());
  return { fresh, steps, done, frames, sfx: stats.sfx, voice: { played: stats.voice.played, blocked: stats.voice.blocked }, taps: stats.taps, refused: stats.refused, guarded: stats.guarded, beat: beats.beat, beatsDone: beats.done };
}
