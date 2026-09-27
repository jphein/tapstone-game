// iwer-state.mjs: three gestures through play(), then the page's counters, for the hands-only guard
// and the no-network-after-load checks in IWER (run with `iwsdk browser run`, like iwer-match.mjs).
//   npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"controller"}'   # or "hand"
//   npx @iwsdk/cli browser run tools/iwer-state.mjs
// With controllers connected, `guarded` must rise and `taps` must not. With either input mode, every
// input-profile model the page asked for came from the vendored copies: net.afterLoad stays 0.
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const before = await f.evaluate(() => __tapstone.stats());
  for (let i = 0; i < 3; i++) {
    await f.evaluate(() => __tapstone.gestureStep());
    await new Promise((r) => setTimeout(r, 300));
  }
  return await f.evaluate((b) => {
    const n = globalThis.__tapstoneNet ?? globalThis.__spikeNet;
    const xr = __tapstone.play.world.renderer.xr.getSession();
    return {
      before: b,
      after: __tapstone.stats(),
      sources: [...(xr?.inputSources ?? [])].map((s) => (s.hand ? 'hand' : 'controller')),
      net: n ? { afterLoad: n.after.length, urls: n.after.slice(0, 6) } : null,
    };
  }, before);
}
