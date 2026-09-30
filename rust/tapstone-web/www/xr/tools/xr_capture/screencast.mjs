// screencast.mjs: Chromium's own screencast of the capture's page, on a CDP session of the browser
// capture.mjs launches and holds for the whole recording. Each frame is a real compositor frame with
// its swap time; frames are written as they arrive and acknowledged after the write.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Starts a screencast of `cdp` (a Playwright CDPSession on the page) into `dir` (000001.jpg …).
// stop() resolves to [{ file, ts }], ts in epoch seconds.
export async function screencast(cdp, dir, { quality = 92 } = {}) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = (e) => {
    const file = join(dir, `${String(frames.length + 1).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(e.data, 'base64'));
    frames.push({ file, ts: e.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      await cdp.send('Page.stopScreencast');
      cdp.off('Page.screencastFrame', onFrame);
      return frames;
    },
  };
}

// An ffconcat list playing `frames` from `start` for `seconds` (epoch seconds), each frame held until
// the next one's swap time: the source keeps the rate the page really drew. The frame showing at
// `start` opens the list; the last is listed twice, as the concat demuxer needs to honour a duration.
export function concatList(frames, start, seconds) {
  const end = start + seconds;
  let i = frames.findLastIndex((f) => f.ts <= start);
  if (i < 0) i = 0;
  const used = frames.slice(i).filter((f, k) => k === 0 || f.ts < end);
  const lines = ['ffconcat version 1.0'];
  used.forEach((f, k) => {
    const from = Math.max(f.ts, start), to = k + 1 < used.length ? used[k + 1].ts : end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0, to - from).toFixed(6)}`);
  });
  if (used.length) lines.push(`file '${used.at(-1).file}'`);
  return { text: lines.join('\n') + '\n', frames: used.length };
}

// Frame pacing over `seconds` from `start` (epoch seconds): the intervals between consecutive swap
// times, in ms, as p50 / p95 / max (nearest rank). A steady 30 fps is 33 ms at every percentile.
// `stalls` lists every interval over 100 ms (three frames at 30 fps: a freeze a viewer can see) by
// when it began, in seconds from `start`, so a cut can avoid it.
export function pacing(frames, start, seconds) {
  const ts = frames.map((f) => f.ts).filter((t) => t >= start && t < start + seconds);
  const gaps = ts.slice(1).map((t, i) => ({ t: +(ts[i] - start).toFixed(3), ms: Math.round((t - ts[i]) * 1000) }));
  const exact = ts.slice(1).map((t, i) => (t - ts[i]) * 1000).sort((a, b) => a - b);
  const at = (q) => (exact.length ? +exact[Math.min(exact.length - 1, Math.ceil(q * exact.length) - 1)].toFixed(1) : null);
  return { frames: ts.length, p50: at(0.5), p95: at(0.95), max: exact.length ? +exact.at(-1).toFixed(1) : null, stalls: gaps.filter((g) => g.ms > 100) };
}
