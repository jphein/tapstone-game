// logic/voice.js: which pre-rendered clip, if any, speaks this exact text (0033 "Speaking": fixed,
// predictable lines are rendered ahead of time). Pure: it reads the manifest that
// tools/voice_lines.py writes into public/voice/, and knows nothing about who is speaking or why.
//
// The match is exact, character for character. A near-miss (a changed word, "..." for "…") has no
// clip, and the caller keeps its text-only behaviour: the voice band is the source of truth and
// the game is playable muted (0033), so a missing clip is silence, never a wrong sentence.
export class VoiceIndex {
  constructor(manifest) {
    this.byText = new Map();
    for (const e of manifest?.lines ?? []) this.byText.set(e.text, e.file);
  }

  get size() {
    return this.byText.size;
  }

  clipFor(text) {
    return typeof text === 'string' && text ? this.byText.get(text) ?? null : null;
  }

  urlFor(text, base) {
    const file = this.clipFor(text);
    return file ? `${base}voice/${file}` : null;
  }
}

// The altar's voice is one sentence, newest wins (0032), and play.js re-says the current line on
// every view that arrives, so a clip is spoken when the line CHANGES, not each time it is redrawn.
// A refusal (force) is spoken every time: a second refused try is news to the person making it.
export class VoiceLine {
  constructor(index) {
    this.index = index;
    this.last = null;
  }

  // The clip to play for this line now, or null (redraw only).
  next(text, { force = false } = {}) {
    const repeat = text === this.last;
    this.last = text || null;
    return repeat && !force ? null : this.index.clipFor(text);
  }
}
