// start.mjs (called by capture.mjs with its page): after install.mjs's reload, the XR session and hand
// mode. Hides the emulator's own interface, frames the head on the altar and the board, puts both
// hands at rest, and starts recording the page's audio. capture.mjs has the screencast running already.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installRecorder, installHands, hideEmulatorChrome } from './page.js';

export default async function run({ page, frame, workspaceRoot }) {
  const f = frame ?? page;
  const control = JSON.parse(await readFile(join(workspaceRoot, '.iwsdk/xr-capture/control.json'), 'utf8'));
  await f.waitForFunction(() => globalThis.__tapstone && __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 30000 });
  // The IWSDK workspace shell around the app's frame: its Runtime/Editor switcher.
  await page.evaluate(() => {
    document.querySelector('.workspace-view-switcher')?.style.setProperty('display', 'none', 'important');
    for (const e of [document.documentElement, document.body]) e.style.setProperty('background', '#000', 'important'); // see hideEmulatorChrome
  });
  await f.evaluate(`(${installRecorder})(); (${installHands})();`);
  const hidden = await f.evaluate(`(${hideEmulatorChrome})()`);
  return await f.evaluate(async ([c, hidden]) => {
    const pl = __tapstone.play;
    const pad = pl.altar.pads[1].m.getWorldPosition(pl.altar.pads[1].m.position.clone());
    // Leaning in: the head 0.27 m above the altar, looking just past it, so the altar, the hands and
    // the board fill the frame (tried against the default 1.6 m stance, where the altar is small).
    if (c.frame === 'room') {
      // Seated and sitting back: the Tea House round the table (board-local, like tools/iwer-art.mjs 'room').
      const r = pl.root, w = (x, y, z) => r.localToWorld(r.position.clone().set(x, y, z));
      await __xrHands.frame(w(0, 0.5, 1.25), w(0, 0.25, -1));
    } else await __xrHands.frame({ x: pad.x, y: pad.y + 0.27, z: pad.z + 0.28 }, { x: pad.x, y: pad.y - 0.1, z: pad.z - 0.28 });
    await __xrHands.rest();
    await new Promise((r) => setTimeout(r, 500));
    const out = await __xrCapture.start(c.segment === 'idle' ? c.seconds : null);
    const g = pl.world.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info');
    const cv = pl.world.renderer.domElement;
    return { ...out, hidden, canvas: [cv.width, cv.height], renderer: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null, room: __tapstone.room?.() ?? null, blend: pl.world.renderer.xr.getSession()?.environmentBlendMode ?? null, beat: __tapstone.beats().beat, voice: __tapstone.stats().voice };
  }, [control, hidden]);
}
