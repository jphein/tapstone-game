// voice.js: the altar's spoken voice. The fixed lines are pre-rendered clips (0033 "Speaking",
// tools/voice_lines.py -> public/voice/); every one is fetched DURING load and kept as a blob URL,
// so speaking touches nothing on the network after "loaded" (net.js). Which clip goes with which
// text is logic/voice.js's; this file only fetches and plays.
//
// A line with no clip (a menu label quoting the engine, a sentence added after the last render) is
// silent and still drawn: the voice band is the source of truth, and the game is playable muted.
import { VoiceIndex, VoiceLine } from './logic/voice.js';

export async function preloadVoice(base) {
  const stats = { clips: 0, played: 0, blocked: 0, silent: 0, cut: 0, heard: [] }; // heard: the first 40 played
  let manifest = null;
  try {
    const r = await fetch(`${base}voice/manifest.json`);
    if (r.ok) manifest = await r.json();
  } catch (e) {
    console.warn('[voice] no manifest', e);
  }
  const urls = new Map();
  await Promise.all((manifest?.lines ?? []).map(async (e) => {
    try {
      const r = await fetch(`${base}voice/${e.file}`);
      if (r.ok) urls.set(e.file, URL.createObjectURL(await r.blob()));
    } catch (err) {
      console.warn(`[voice] ${e.file}`, err);
    }
  }));
  // Only lines whose clip actually arrived are in the index.
  const index = new VoiceIndex({ lines: (manifest?.lines ?? []).filter((e) => urls.has(e.file)) });
  stats.clips = index.size;
  console.log(`[voice] ${index.size}/${manifest?.lines?.length ?? 0} clips preloaded`);
  const line = new VoiceLine(index);
  const audio = typeof Audio === 'function' ? new Audio() : null;
  // The guide's line queue (guide/lines.js) waits for a clip to end before the next line starts.
  audio?.addEventListener('ended', () => api.onEnded?.());
  const api = {
    stats,
    onEnded: null,
    onBlocked: null,
    // Returns true when a clip started (its end will be reported through onEnded), false for a line
    // that is drawn only (no clip, or the same line again).
    say(text, opts) {
      const file = line.next(text, opts);
      if (!file || !audio) {
        if (text && !index.clipFor(text)) stats.silent++;
        return false;
      }
      // Newest wins, as on the voice band: a new line cuts the one still playing.
      audio.pause();
      audio.src = urls.get(file);
      audio.currentTime = 0;
      audio.play().then(() => {
        stats.played++;
        if (stats.heard.length < 40) stats.heard.push(file);
      }, (err) => {
        // AbortError: a newer line cut this one (newest wins). Anything else is the autoplay policy
        // before any gesture, and the text is on the band regardless.
        if (err?.name === 'AbortError') return void stats.cut++;
        stats.blocked++;
        api.onBlocked?.(text);
        console.warn(`[voice] ${file} not played: ${err?.name ?? err}`);
      });
      return true;
    },
  };
  return api;
}
