// gestures.js: small state machines for the hands-first verbs. Pure; every clock is passed in (ms).

// Face up or face down, from how the held card faces: `dot` is the card face's normal dotted with
// world up (1 = face up, -1 = face down). Hysteresis: it flips only past `downAt` or `upAt`, so a
// card held edge-on doesn't flicker between cast and charge.
export class FlipDetector {
  constructor({ upAt = 0.35, downAt = -0.35 } = {}) {
    this.upAt = upAt;
    this.downAt = downAt;
    this.face = 'up';
  }
  update(dot) {
    if (this.face === 'up' && dot < this.downAt) this.face = 'down';
    else if (this.face === 'down' && dot > this.upAt) this.face = 'up';
    return this.face;
  }
}

// The castle card: outside the mulligan window a tap passes at once (0009). Inside it, a tap opens a
// 3 s prompt: a second tap within the window is a mulligan, and if the 3 s run out it keeps and
// passes (0032 amendment). Nothing is sent until the prompt resolves.
export class CastleTaps {
  constructor({ windowMs = 3000 } = {}) {
    this.windowMs = windowMs;
    this.openedAt = null;
  }
  // Returns 'pass' | 'mulligan' | 'pending'.
  tap(now, mulliganOpen) {
    if (!mulliganOpen) {
      this.openedAt = null;
      return 'pass';
    }
    if (this.openedAt !== null && now - this.openedAt <= this.windowMs) {
      this.openedAt = null;
      return 'mulligan';
    }
    this.openedAt = now;
    return 'pending';
  }
  // Call every frame: 'pass' once the window runs out with no second tap, else null.
  poll(now) {
    if (this.openedAt !== null && now - this.openedAt > this.windowMs) {
      this.openedAt = null;
      return 'pass';
    }
    return null;
  }
  get pending() {
    return this.openedAt !== null;
  }
}

// A spell with several legal targets: look at one and pinch, or the default applies after 3 s (0009:
// nearest). `options` come from matchGesture's { need: 'target' }; `defaultIndex` picks among them.
export class TargetTimer {
  constructor({ ms = 3000 } = {}) {
    this.ms = ms;
    this.options = null;
  }
  start(now, options, defaultIndex = 0) {
    this.options = options;
    this.startedAt = now;
    this.defaultIndex = Math.min(Math.max(0, defaultIndex), options.length - 1);
  }
  // A gaze-and-pinch on a target byte: the menu index, or null if it isn't one of the options.
  pick(target) {
    if (!this.options) return null;
    const o = this.options.find((x) => x.target === target);
    if (!o) return null;
    this.options = null;
    return o.index;
  }
  // Call every frame: the default's menu index once 3 s have passed, else null.
  poll(now) {
    if (!this.options || now - this.startedAt < this.ms) return null;
    const o = this.options[this.defaultIndex];
    this.options = null;
    return o.index;
  }
  get active() {
    return this.options !== null;
  }
}

// IWSDK's Pressed fires for poke and ray alike and doesn't name its pointer. A press with a tracked
// index fingertip within `radius` metres of the target counts as a poke (the spike's heuristic).
export function pressKind(fingertipDistances, radius = 0.03) {
  return fingertipDistances.some((d) => d <= radius) ? 'poke' : 'ray';
}
