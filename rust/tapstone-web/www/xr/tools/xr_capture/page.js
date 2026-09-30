// page.js: the code xr_capture runs INSIDE the Tapstone page. Each export is a self-contained function
// that the browser-run scripts serialise (fn.toString()) and evaluate in the page, so none of them may
// close over anything in this module.
//
// Nothing here draws or invents gameplay: the recorder takes only the audio the page itself plays
// (the picture is Chromium's own screencast), and the hands move IWER's emulated hands through IWSDK's real grab, press and
// touch paths, as a person would. The only stand-in is gestureStep() (play.js's test hook, the same
// play() door), used when a hand move fails to land, and every such move is counted as a fallback.

// Installed with page.addInitScript, so it runs before the page's own scripts: taps every audio
// output the page makes (WebAudio contexts reaching their destination, and <audio> elements) so the
// recorder can mix them into the capture. It changes nothing the page hears.
export function installTaps() {
  if (globalThis.__xrTaps) return;
  const T = (globalThis.__xrTaps = { taps: [], elements: [], last: null, onTap: null, onElement: null, mix: null });
  const connect = AudioNode.prototype.connect;
  T.connect = connect;
  AudioNode.prototype.connect = function (dst, ...rest) {
    const r = connect.call(this, dst, ...rest);
    if (dst instanceof AudioDestinationNode && dst.context !== T.mix) {
      let tap = T.taps.find((x) => x.ctx === this.context);
      if (!tap) {
        tap = { ctx: this.context, node: this.context.createMediaStreamDestination() };
        T.taps.push(tap);
        T.onTap?.(tap);
      }
      connect.call(this, tap.node);
    }
    return r;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    T.last = this;
    if (!T.elements.includes(this)) {
      T.elements.push(this);
      T.onElement?.(this);
    }
    return play.apply(this, a);
  };
}

// Defines globalThis.__xrCapture: records the page's own audio (the tapped contexts and elements,
// mixed) with MediaRecorder, and reads it back in base64 slices (a browser-run result is JSON). The
// picture comes from Chromium's screencast (screencast.mjs); `wall0` is when this recording started,
// on the same wall clock as the screencast's frame timestamps, so the two line up.
export function installRecorder() {
  const C = (globalThis.__xrCapture = globalThis.__xrCapture ?? {});
  C.start = async (seconds) => {
    const T = globalThis.__xrTaps;
    const mix = new AudioContext();
    await mix.resume();
    const dest = mix.createMediaStreamDestination();
    const audio = { taps: 0, elements: 0, installed: !!T };
    if (T) {
      T.mix = mix;
      const addTap = (tap) => (mix.createMediaStreamSource(tap.node.stream).connect(dest), audio.taps++);
      const addElement = (el) => {
        const n = mix.createMediaElementSource(el); // reroutes the element through `mix`, so...
        n.connect(dest);
        n.connect(mix.destination); // ...it still plays out loud, as before
        audio.elements++;
      };
      T.taps.forEach(addTap);
      T.elements.forEach(addElement);
      T.onTap = addTap;
      T.onElement = addElement;
    }
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
    C.chunks = [];
    C.marks = [];
    rec.ondataavailable = (e) => e.data.size && C.chunks.push(e.data);
    C.rec = rec;
    C.held = { mix, dest }; // a collected AudioContext ends its track and stalls the recorder
    C.audio = audio;
    C.stopped = null;
    rec.start(1000);
    C.t0 = performance.now();
    C.wall0 = performance.timeOrigin + C.t0;
    // A fixed-length capture stops itself, on the page's clock, not after a browser-run round trip.
    if (seconds) setTimeout(() => C.stop(), seconds * 1000);
    return { audio, wall0: C.wall0 };
  };
  // A named moment, relative to the recording's start (the orchestrator cuts segments on these).
  C.mark = (name, data) => C.rec && C.marks.push({ t: (performance.now() - C.t0) / 1000, name, ...(data ?? {}) });
  C.stop = () =>
    (C.stopped ??= new Promise((resolve) => {
      C.rec.onstop = () => {
        C.blob = new Blob(C.chunks, { type: C.rec.mimeType });
        const ms = performance.now() - C.t0;
        resolve({ bytes: C.blob.size, seconds: ms / 1000, wall0: C.wall0, mimeType: C.rec.mimeType, audio: C.audio, marks: C.marks });
      };
      C.rec.stop();
    }));
  C.read = async (offset, length) => {
    const b = new Uint8Array(await C.blob.slice(offset, offset + length).arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
}

// In the app's frame: hides IWER's own interface, which no headset shows: its DevUI (a shadow-DOM
// toolbar and hand panels), the transform gizmos drawn on a canvas above the app's, and the "Remote
// Control Active" pill. What stays is the app's canvas and, beneath it, the canvas where IWER draws
// its emulated room (its stand-in for passthrough). Nothing is drawn; elements are only hidden.
export function hideEmulatorChrome() {
  const app = __tapstone.play.world.renderer.domElement;
  const z = (e) => Number(getComputedStyle(e).zIndex) || 0;
  const hidden = [];
  const hide = (e, why) => (e.style.setProperty('display', 'none', 'important'), hidden.push(why));
  for (const e of [...app.parentElement.children]) {
    if (e === app) continue;
    if (e.tagName === 'CANVAS' && z(e) < z(app)) continue; // the emulated room, under the app
    hide(e, e.tagName === 'CANVAS' ? 'overlay canvas' : e.shadowRoot ? 'devui' : e.tagName.toLowerCase());
  }
  for (const e of document.body.children) if (e.shadowRoot && !e.contains(app)) hide(e, 'shadow host');
  // Where the app draws nothing the page shows through. A headset's opaque display ignores alpha
  // and shows the cleared black; Mesa on the B60 leaves those pixels transparent (the full-VR
  // ceiling came out white, the page's colour, where the P102 had written it opaque).
  for (const e of [document.documentElement, document.body]) e.style.setProperty('background', '#000', 'important');
  hidden.push('page background -> black');
  return hidden;
}

// Defines globalThis.__xrHands: moves IWER's emulated hands (IWER_DEVICE.remote, the runtime the
// `iwsdk xr` commands drive) to play one move the way a person does: pinch a card, carry it to a pad,
// let go; pinch the castle to pass or claim; poke a pad. IWSDK decides which of the page's paths that
// becomes (a press, a grab, a touch): a draw measured here lands on the pad press at the release.
export function installHands() {
  const H = (globalThis.__xrHands = globalThis.__xrHands ?? { log: [], fallbacks: 0, hand: 0 });
  const R = () => IWER_DEVICE.remote;
  const p = () => __tapstone.play;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = (o) => {
    const v = o.position.clone();
    o.getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  };
  const up = (v, dy) => ({ x: v.x, y: v.y + dy, z: v.z });
  const DOWN = { pitch: -60, yaw: 0, roll: 0 };
  const FLIP = { pitch: -60, yaw: 0, roll: 180 };
  // At rest the hands hover 15 cm over the altar's near edge. They used to rest at y 1.2 m, inside the
  // altar's own height (its pads' tops sit at ~1.206 m), so every reach from rest slid across the pads
  // and poked them on the way (tools/iwer-press-log.mjs, 2026-09-28): no hand at rest lies on the table.
  const rest = (side) => {
    const a = at(p().altar.pads[1].m);
    return { x: a.x + (side === 'left' ? -0.2 : 0.2), y: a.y + 0.15, z: a.z + 0.14 };
  };
  const go = (side, position, duration, orientation = DOWN) => R().dispatch('animate_to', { device: `hand-${side}`, position, orientation, duration });
  const pinch = (side, value) => R().dispatch('set_select_value', { device: `hand-${side}`, value });
  const until = async (ok, ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (ok()) return true;
      await sleep(50);
    }
    return ok();
  };
  H.speaking = () => {
    const el = globalThis.__xrTaps?.last;
    return !!el && !el.paused && !el.ended;
  };
  // Waits for the altar's voice line to finish (at most `ms`), so a line is heard whole.
  H.quiet = async (ms = 6000) => (await sleep(150), until(() => !H.speaking(), ms));
  // The head leans in over the altar, as a seated player does, and looks at the altar and board.
  H.frame = async (position, target) => {
    await R().dispatch('set_transform', { device: 'headset', position });
    await R().dispatch('look_at', { device: 'headset', target });
  };
  H.lookAt = (target, duration = 1.2) => {
    const h = IWER_DEVICE.position;
    const dx = target.x - h.x, dy = target.y - h.y, dz = target.z - h.z;
    const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI, pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    return R().dispatch('animate_to', { device: 'headset', orientation: { pitch, yaw, roll: 0 }, duration });
  };
  // The head orientation (degrees, as animate_to takes it) for a view direction `dir`, turned `deg`
  // degrees to the right about the vertical: the pitch stays, the yaw moves (IWER's yaw grows to the left).
  H.panOrientation = (dir, deg) => {
    const yaw = (Math.atan2(-dir.x, -dir.z) * 180) / Math.PI, pitch = (Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * 180) / Math.PI;
    return { pitch: +pitch.toFixed(3), yaw: +(yaw - deg).toFixed(3), roll: 0 };
  };
  // A slow head turn of `deg` degrees to the right over `seconds`, from where the head looks now.
  H.pan = (deg, seconds) => {
    const cam = p().world.renderer.xr.getCamera(), d = cam.position.clone();
    cam.getWorldDirection(d);
    return R().dispatch('animate_to', { device: 'headset', orientation: H.panOrientation(d, deg), duration: seconds });
  };
  H.rest = async () => {
    await R().dispatch('set_transform', { device: 'hand-left', position: rest('left'), orientation: DOWN });
    await R().dispatch('set_transform', { device: 'hand-right', position: rest('right'), orientation: DOWN });
  };

  // Pinch `obj`, carry it onto `pad` (face down if `flip`), and let go there.
  async function carry(side, obj, pad, flip) {
    const from = at(obj), to = at(pad);
    await go(side, up(from, 0.06), 0.45);
    await go(side, up(from, 0.01), 0.3);
    await pinch(side, 1);
    await sleep(250);
    await go(side, up(to, 0.09), 0.6, flip ? FLIP : DOWN);
    await go(side, up(to, 0.02), 0.3, flip ? FLIP : DOWN);
    await sleep(350);
    await pinch(side, 0);
    await sleep(150);
    await go(side, rest(side), 0.45);
  }
  // Pinch `obj` where it lies and let go (the castle: a pass, or the claim).
  async function press(side, obj) {
    const o = at(obj);
    await go(side, up(o, 0.06), 0.45);
    await go(side, up(o, 0.01), 0.3);
    await pinch(side, 1);
    await sleep(300);
    await pinch(side, 0);
    await sleep(150);
    await go(side, rest(side), 0.45);
  }
  // Poke a pad with the index fingertip (a bare fingertip on a pad advances that lane).
  async function poke(side, pad) {
    const o = at(pad);
    await go(side, up(o, 0.08), 0.45, { pitch: -80, yaw: 0, roll: 0 });
    await go(side, up(o, -0.005), 0.25, { pitch: -80, yaw: 0, roll: 0 });
    await sleep(250);
    await go(side, rest(side), 0.45);
  }

  const handMesh = (card) => {
    const slot = p().handCards.findIndex((c) => c && c.card === card);
    return slot >= 0 ? p().hand.cards[slot].mesh : null;
  };
  async function perform(item) {
    const a = p().altar, pad = (lane) => a.pads[lane].m;
    switch (item.kind) {
      case 'Draw':
        return carry('right', a.deckTop, pad(1));
      case 'Charge':
        return carry('right', handMesh(item.card), pad(0), true);
      case 'CastUnit':
        return carry('right', handMesh(item.card), pad(item.lane));
      case 'CastSpell':
        return carry('right', handMesh(item.card), pad(1));
      case 'Advance':
        return poke('right', pad(item.lane));
      case 'Pass':
        return press('left', a.castle);
      default:
        throw new Error(`no hand move for ${item.kind}`);
    }
  }

  // The move H.move would play next (the same choice), without playing it.
  H.peek = (kind) => {
    const menu = p().table.choices();
    const item = (kind && menu.find((m) => m.useful && m.kind === kind)) || menu.find((m) => m.useful && m.kind !== 'Mulligan');
    return item ? { kind: item.kind, label: item.label } : null;
  };

  // One move, chosen as gestureStep chooses (preferring `kind`), played with the hands. If the move
  // lands nowhere (no tap, no beat), it goes through gestureStep instead and counts as a fallback.
  // With input 'gesture' every move is gestureStep (the iwer-*.mjs gates' path) and the hands rest.
  H.move = async (kind, input = 'hands') => {
    const pl = p(), t = pl.table;
    if (input === 'gesture') {
      const label = __tapstone.beats().beat === 'claim' ? (pl.castleTap(), 'claim') : __tapstone.gestureStep(kind);
      if (label) H.log.push({ t: performance.now(), kind: kind ?? 'step', label, how: 'gesture' }), globalThis.__xrCapture?.mark?.('move', { label });
      return label;
    }
    const beat = () => `${__tapstone.beats().beat}|${pl.beats.count ?? ''}|${pl.beatLog.length}`;
    if (__tapstone.beats().beat === 'claim') {
      const b0 = beat();
      await press('left', pl.altar.castle);
      const ok = await until(() => beat() !== b0, 2000);
      H.log.push({ t: performance.now(), kind: 'Claim', label: 'claim', how: ok ? 'hand' : 'missed' });
      if (ok) H.hand++;
      else H.fallbacks++, pl.castleTap();
      return 'claim';
    }
    const menu = t.choices();
    const item = (kind && menu.find((m) => m.useful && m.kind === kind)) || menu.find((m) => m.useful && m.kind !== 'Mulligan');
    if (!item) return null;
    globalThis.__xrCapture?.mark?.('move', { kind: item.kind, label: item.label });
    const taps0 = pl.stats.taps, b0 = beat();
    let how = 'hand', error;
    try {
      await perform(item);
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const wait = item.kind === 'Pass' || item.kind === 'CastSpell' ? 4500 : 2000;
    const ok = !error && (await until(() => pl.stats.taps > taps0 || beat() !== b0, wait));
    if (ok) H.hand++;
    else {
      how = 'fallback';
      H.fallbacks++;
      __tapstone.gestureStep(item.kind);
    }
    H.log.push({ t: performance.now(), kind: item.kind, label: item.label, how, error });
    return item.label;
  };
}
