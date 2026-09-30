// Pause and resume (spec 2026-09-25 §3.5; contest rule "clean pause/resume"). The match pauses
// whenever the person can't see it: the tab hidden, the XR session hidden or blurred (the Quest menu,
// the headset off), or the session ended. The rule it keeps: a paused match is indistinguishable
// from one whose pause lasted no time at all.
//   - Play time freezes: now() stops at the moment of the pause and resumes from there, so every timer
//     measured on it (the castle's double-tap, the target's auto-pick, the first five's beats) neither
//     fires nor expires while dark.
//   - The table does not advance while paused, and the first frame back plays nothing, so the wall
//     time spent hidden (a frame delta of minutes, once rAF resumes) is never played.
//   - A gesture made while paused is held, in order, and played on return against the same state.
// Several reasons may overlap (the tab hidden inside an ended session); play resumes when the last
// one clears.
export const FRAME_CAP_MS = 100; // the most play time one frame may advance (a long frame is slow-motion, not a jump)

export class PauseClock {
  constructor() {
    this.reasons = new Set();
    this.offset = 0; // wall ms spent paused before the current pause
    this.since = null; // wall time the current pause began
    this.held = [];
    this.pauses = 0;
    this.fresh = false; // the next frame is the first one back
  }

  get paused() {
    return this.reasons.size > 0;
  }

  // Returns 'paused' or 'resumed' on a transition, null otherwise.
  set(reason, on, wall) {
    const was = this.paused;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (!was && this.paused) {
      this.since = wall;
      this.pauses++;
      return 'paused';
    }
    if (was && !this.paused) {
      this.offset += wall - this.since;
      this.since = null;
      this.fresh = true;
      return 'resumed';
    }
    return null;
  }

  // Play time at wall time `wall`: frozen while paused.
  now(wall) {
    return (this.since ?? wall) - this.offset;
  }

  pausedMs(wall) {
    return this.offset + (this.since === null ? 0 : wall - this.since);
  }

  // How much play time this frame advances, for a frame of `deltaMs` wall time.
  frameMs(deltaMs) {
    if (this.paused) return 0;
    if (this.fresh) {
      this.fresh = false;
      return 0;
    }
    return Math.min(Math.max(0, deltaMs), FRAME_CAP_MS);
  }

  hold(item) {
    this.held.push(item);
  }

  // The held items, once play has resumed ([] while still paused).
  drain() {
    if (this.paused) return [];
    const h = this.held;
    this.held = [];
    return h;
  }
}

// Which pause reasons hold right now, derived from state rather than from pairs of events: on a real
// Quest 2 (2026-09-28) the events don't pair up. Quest Browser left the 2D page's 'tab' set after the
// Quest menu, and each ended session's listener kept firing, so the match stayed paused IN the headset
// and every placing waited in the held queue. The 2D page's visibility counts only outside XR (behind
// an immersive session it may read hidden or unfocused); 'blur' is the current session's own
// visibility; 'xr' is a session that ended with none since.
export function pauseReasons({ presenting, sessionVisibility, docHidden, hadSession }) {
  return {
    tab: !presenting && !!docHidden,
    blur: !!presenting && sessionVisibility !== 'visible',
    xr: !presenting && !!hadSession,
  };
}
