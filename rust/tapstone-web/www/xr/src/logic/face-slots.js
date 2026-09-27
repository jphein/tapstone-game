// face-slots.js: the hand's card faces, one canvas and one texture per hand slot, made once and
// repainted in place. Pure (the canvas and texture come from `make`), so node can count them.
//
// hand.js used to make a new canvas and CanvasTexture for every face it painted and never dispose the
// one it replaced: each repaint left a texture on the GPU for the rest of the session (found by the
// M3 frame-timing report, 2026-09-27). Reusing the slot's texture means there is never one to
// replace; a repaint only marks it for upload (needsUpdate), and the material keeps the same map, so
// its shader program never changes after load.
export class FaceSlots {
  // make() -> { canvas, texture }, called once per slot, up front.
  constructor(n, make) {
    this.faces = Array.from({ length: n }, () => ({ ...make(), key: null }));
  }

  texture(slot) {
    return this.faces[slot].texture;
  }

  // Paint `card` into the slot's canvas with draw(canvas, card) unless it already shows it. Returns
  // whether it painted (the frame log's `hand` count).
  show(slot, card, draw) {
    const f = this.faces[slot];
    const key = `${card.card}:${card.name}`;
    if (key === f.key) return false;
    f.key = key;
    draw(f.canvas, card);
    f.texture.needsUpdate = true;
    return true;
  }

  dispose() {
    for (const f of this.faces) if (!f.disposed) f.texture.dispose(), (f.disposed = true);
  }
}
