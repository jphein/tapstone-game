// iwer-forget.mjs: drop the page's stored journal and stop it saving, so the next `browser reload`
// opens a fresh match (the managed browser keeps localStorage between runs). Run before any IWER gate
// that expects a fresh match: iwer-match, iwer-first-five, iwer-handback, iwer-pause, iwer-reload.
//   npx @iwsdk/cli browser run tools/iwer-forget.mjs && npx @iwsdk/cli browser reload
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  return await f.evaluate(() => ({ forgot: __tapstone.forget(), stored: localStorage.getItem('tapstone.xr.journal') }));
}
