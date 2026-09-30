// iwer-enter-vr.mjs: enter full VR the way a person does, by pressing the page's "Full VR" entry
// (entry.js: a trusted click, so the request has its user activation), in IWSDK's managed Chromium.
// `iwsdk xr enter` accepts the browser's offer, which is mixed reality (logic/entry.js), so VR needs
// this. Returns the session it got: its blend mode and the Tea House's room.
//   npx @iwsdk/cli browser run tools/iwer-enter-vr.mjs && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const plan = await f.evaluate(() => globalThis.__tapstoneEntry);
  await f.click('#entry button[data-mode="immersive-vr"]', { timeout: 10000 });
  await f.waitForFunction(() => __tapstone.room().kind !== null && __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500));
  return { plan, room: await f.evaluate(() => __tapstone.room()), panelHidden: await f.evaluate(() => document.getElementById('entry').hidden) };
}
