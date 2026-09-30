// stop.mjs (called by capture.mjs with its page): stops the audio recording and writes it beside the
// control file.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function run({ page, frame, workspaceRoot }) {
  const f = frame ?? page;
  const dir = join(workspaceRoot, '.iwsdk/xr-capture');
  const control = JSON.parse(await readFile(join(dir, 'control.json'), 'utf8'));
  const info = await f.evaluate(() => __xrCapture.stop());
  const out = join(dir, `${control.name}.audio.webm`);
  await writeFile(out, '');
  const SLICE = 4 << 20;
  for (let off = 0; off < info.bytes; off += SLICE) {
    await appendFile(out, Buffer.from(await f.evaluate(([o, n]) => __xrCapture.read(o, n), [off, SLICE]), 'base64'));
  }
  const game = await f.evaluate(() => ({ stats: __tapstone.stats(), beats: __tapstone.beats(), hands: { hand: __xrHands.hand, fallbacks: __xrHands.fallbacks, log: __xrHands.log } }));
  return { ...info, audioFile: out, game };
}
