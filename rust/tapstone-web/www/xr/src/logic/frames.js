// frames.js: a frame-time log for the M3 measurement (VR spec 2026-09-25 §5 MVP 10, "a measured
// 60 fps"). Pure: play.js calls begin(now) at the top of every frame and tag(name) for the work it
// does in it (a view drawn, hand faces painted, an effect started, a line drawn on the band), so a
// slow frame carries the names of what ran in it. A frame's time is the interval from its begin() to
// the next one, which includes the render of whatever it changed.
//
// It measures whatever runs the page. In IWER (the emulated headset in a desktop Chromium) that is
// a desktop GPU and CPU, not a Quest's, so its numbers are evidence about our own per-frame work,
// never the Quest's 60 fps.

// Nearest-rank percentile (p in 0..100) of `xs`, or null for none.
export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export class FrameLog {
  constructor({ cap = 20000 } = {}) {
    this.cap = cap;
    this.done = []; // { index, ms, tags }
    this.open = null;
    this.count = 0;
  }

  begin(now) {
    if (this.open) {
      this.done.push({ index: this.open.index, ms: now - this.open.at, work: this.open.work, tags: this.open.tags });
      if (this.done.length > this.cap) this.done.shift();
    }
    this.open = { index: this.count++, at: now, work: 0, tags: {} };
  }

  // Milliseconds of our own script work in this frame (the rest of the interval is the engine's
  // render, the compositor and waiting for the next frame).
  work(ms) {
    if (this.open) this.open.work += ms;
  }

  tag(name, n = 1) {
    if (this.open) this.open.tags[name] = (this.open.tags[name] ?? 0) + n;
  }

  frames() {
    return this.done;
  }

  report({ budgetMs = 1000 / 60, worst = 10 } = {}) {
    const ms = this.done.map((f) => f.ms);
    const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
    const over = this.done.filter((f) => f.ms > budgetMs);
    const causes = {};
    const keys = (f) => (Object.keys(f.tags).length ? Object.keys(f.tags) : ['(untagged)']);
    for (const f of over) for (const k of keys(f)) causes[k] = (causes[k] ?? 0) + 1;
    // Each tag's frames against the untagged ones: a tag is a cause only if its median sits above
    // the baseline's, since every frame of a slow renderer is over budget whatever it carries.
    const tagged = {};
    for (const f of this.done) for (const k of keys(f)) (tagged[k] ??= []).push(f.ms);
    const byTag = Object.fromEntries(Object.entries(tagged).map(([k, xs]) => [k, { frames: xs.length, p50: r2(percentile(xs, 50)) }]));
    return {
      frames: ms.length,
      dropped: Math.max(0, this.count - 1 - ms.length),
      budgetMs: r2(budgetMs),
      p50: r2(percentile(ms, 50)),
      p90: r2(percentile(ms, 90)),
      p95: r2(percentile(ms, 95)),
      p99: r2(percentile(ms, 99)),
      max: r2(ms.length ? Math.max(...ms) : null),
      mean: r2(ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null),
      over: over.length,
      overCauses: causes,
      byTag,
      workP50: r2(percentile(this.done.map((f) => f.work), 50)),
      workP99: r2(percentile(this.done.map((f) => f.work), 99)),
      worst: [...this.done].sort((a, b) => b.ms - a.ms).slice(0, worst).map((f) => ({ index: f.index, ms: r2(f.ms), work: r2(f.work), tags: f.tags })),
    };
  }
}
