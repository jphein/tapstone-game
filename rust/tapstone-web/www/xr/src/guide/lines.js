// guide/lines.js: one queue for everything the altar says (guide v2). Pure: times are passed in.
//
// On the Quest 2 (2026-09-28) the controller guard's "put down" line cut the claim line off, because
// the altar's voice was newest-wins. Now a line plays to its end:
//   lesson   the guide's sentence: queued in order (the same sentence twice in a row is one)
//   guard    the hands-only guard: queued like a lesson
//   refusal  a refused move: only the newest waits (an older unheard refusal is stale news)
//   status   "Your move." and the like: never queued behind anything; it plays only when the queue
//            is empty, and a newer status replaces a waiting one
// A line ends when its clip ends (ended()), or after a reading time when it has no clip or the clip
// was blocked, whichever comes first; `until` caps a clip whose 'ended' never arrives.
export const READ = { perChar: 55, min: 1400, max: 7000 };
export const readMs = (text) => Math.min(READ.max, Math.max(READ.min, String(text).length * READ.perChar));

export class LineQueue {
  constructor() {
    this.current = null; // { text, kind, until }
    this.waiting = [];
    this.said = []; // every line started: { at, text, kind } (the IWER gates read it)
  }

  // `force`: say it again even if it was the last thing said (the XR-entry replay: lines spoken before
  // entry were blocked by autoplay, JP's Quest 2 run).
  // `topic`: a newer line on the same topic replaces a waiting one (the guide's lessons: "Draw 4" is
  // stale once "Draw 3" is true).
  push(text, kind = 'lesson', { force = false, topic = null } = {}) {
    if (!text) return;
    if (topic) this.waiting = this.waiting.filter((l) => l.topic !== topic);
    if (kind === 'refusal') this.waiting = this.waiting.filter((l) => l.kind !== 'refusal');
    if (kind === 'status') this.waiting = this.waiting.filter((l) => l.kind !== 'status');
    const last = this.waiting.at(-1) ?? this.current;
    if (!force && kind !== 'refusal' && last && last.text === text && last.kind === kind) return; // no stutter
    this.waiting.push({ text, kind, force, topic });
  }

  // The current line's clip finished.
  ended() {
    this.current = null;
  }

  get busy() {
    return this.current !== null;
  }

  // Call each frame. Returns the line to start now ({ text, kind }), or null.
  next(now) {
    if (this.current && now >= this.current.until) this.current = null;
    if (this.current) return null;
    // Anything but a status goes first; a status only when nothing else waits.
    let i = this.waiting.findIndex((l) => l.kind !== 'status');
    if (i < 0) i = this.waiting.length ? 0 : -1;
    if (i < 0) return null;
    const [line] = this.waiting.splice(i, 1);
    const read = now + readMs(line.text);
    this.current = { ...line, until: read, read };
    this.said.push({ at: Math.round(now), text: line.text, kind: line.kind });
    if (this.said.length > 300) this.said.shift();
    return line;
  }

  // A clip was found for the current line: let it run to its own end (ended()), up to READ.max + 2 s.
  playing(now) {
    if (this.current) this.current.until = Math.max(this.current.until, now + READ.max + 2000);
  }

  // The clip was refused (the autoplay policy before any gesture): no 'ended' will come, so the line
  // ends at its reading time.
  blocked() {
    if (this.current) this.current.until = this.current.read;
  }

  // Drop what waits (a new match); the line on air finishes.
  clear() {
    this.waiting = [];
  }
}
