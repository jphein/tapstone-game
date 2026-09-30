// iwer-room.mjs: the Tea House in the current session (0039: mixed reality has only the doors, full VR
// the lantern-lit interior), and what a frame of it costs to draw: renderer.info's draw calls and
// triangles, sampled over ~2 s (median). A desktop count of the same scene the Quest draws, so it is
// a frame-budget signal, never a Quest frame rate (60 fps is measured on the headset only).
//   npx @iwsdk/cli browser run tools/iwer-room.mjs
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone, null, { timeout: 30000 });
  const samples = [];
  for (let k = 0; k < 20; k++) {
    samples.push(await f.evaluate(() => __tapstone.render()));
    await new Promise((r) => setTimeout(r, 100));
  }
  const med = (key) => samples.map((s) => s[key]).sort((a, b) => a - b)[samples.length >> 1];
  return { room: await f.evaluate(() => __tapstone.room()), render: { calls: med('calls'), triangles: med('triangles'), points: med('points'), lines: med('lines') } };
}
