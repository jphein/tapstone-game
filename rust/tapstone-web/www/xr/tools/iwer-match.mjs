// iwer-match.mjs: Task S5's IWER gate. A whole match through the gesture path, in IWSDK's managed
// Chromium. Every move is __tapstone.gestureStep(): one gesture through play(), never propose().
//
//   npx @iwsdk/cli dev up --headless --allow-browser-automation --foreground   (in tmux)
//   npx @iwsdk/cli browser run tools/iwer-forget.mjs && npx @iwsdk/cli browser reload   # a fresh match: a stored journal resumes otherwise
//   npx @iwsdk/cli xr enter
//   npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'   # IWER starts with controllers,
//     which the hands-only guard (src/guard.js) refuses: every gesture would count as `guarded`
//   until npx @iwsdk/cli browser run tools/iwer-match.mjs --timeout 105000 | grep -q '"done": true'; do :; done
//
// A managed-browser script may hold its lease for at most 110 s, so each run plays for up to 95 s and
// returns; the shell loop calls it again until the match is over.
//
// Why not tools/cdp.mjs here: IWSDK drives its browser through Playwright and exposes no CDP port
// (nothing listens on :9222 on familiar), so the in-page calls go through `browser run`'s frame.
// tools/cdp.mjs stays for the Quest Browser, whose DevTools socket adb forwards.
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 95000;
  let steps = 0;
  let done = await f.evaluate(() => __tapstone.stats().done);
  for (; Date.now() < until && !done; steps++) {
    await f.evaluate(() => __tapstone.gestureStep());
    done = await f.evaluate(() => __tapstone.stats().done);
    if (!done) await sleep(300);
  }
  const stats = await f.evaluate(() => __tapstone.stats());
  const net = await f.evaluate(() => {
    const n = globalThis.__tapstoneNet ?? globalThis.__spikeNet;
    return n ? { afterLoad: n.after.length, urls: n.after.slice(0, 5), total: n.total } : null;
  });
  // The match's journal (logic/journal.js), for tools/journal-check.mjs; `resumed` says whether this
  // page replayed a stored one (iwer-reload.mjs) or started fresh.
  const journal = await f.evaluate(() => __tapstone.journal());
  return { steps, stats, net, resumed: { ...journal.resumed }, journal };
}
