// iwer-guide-budget.mjs: what the guide v2 adds to a frame (renderer.info: draw calls and triangles,
// median of 20 frames), with the ghost demo and the fan's grip shown, then both hidden, in the same game
// state; and the textures it made (the caption canvas). Run in XR with a demo showing (a lesson with a
// move: after the claim, say). A desktop count of the same scene the Quest draws: a budget signal, not
// a frame rate (the Quest 2's 72 fps floor is measured on the headset).
//   npx @iwsdk/cli browser run tools/iwer-guide-budget.mjs --timeout 60000
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone && __tapstone.play.ghost.visible, null, { timeout: 30000 });
  return await f.evaluate(async () => {
    const pl = __tapstone.play, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const sample = async () => {
      const s = [];
      for (let k = 0; k < 20; k++) (s.push({ ...__tapstone.render() }), await sleep(50));
      const med = (key) => s.map((x) => x[key]).sort((a, b) => a - b)[10];
      return { calls: med('calls'), triangles: med('triangles') };
    };
    // Hold the ghost mid-carry so the hand, card, path, ring and caption are all on screen.
    pl.ghostHold = true;
    const g = pl.ghost, upd = g.update.bind(g);
    g.update = (now, o) => upd(g.t0 + 1500, o);
    await sleep(300);
    const shown = await sample();
    const wasGrip = pl.hand.grip.visible;
    g.group.visible = false;
    pl.hand.grip.visible = false;
    await sleep(300);
    const hidden = await sample();
    g.group.visible = true;
    pl.hand.grip.visible = wasGrip;
    g.update = upd;
    pl.ghostHold = false;
    const cap = g.caption.tex.image;
    return { shown, hidden, added: { calls: shown.calls - hidden.calls, triangles: shown.triangles - hidden.triangles }, textureMB: +((cap.width * cap.height * 4) / 1048576).toFixed(3), captionPx: [cap.width, cap.height] };
  });
}
