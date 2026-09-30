// board-mat.js: the Dueling Grounds (0039: the board unrolls in a pocket dimension) as ONE painted
// mat: night slate and indigo mist, faint stars, the 3 x 6 cells ruled in gilt, the lanes' double
// rules, the midline's glow between the two sides, and each lane's Mayan dot numeral at its near
// end, matching the pads on the stone. The look is a PROPOSAL (the bible is silent). It replaces a
// base and 18 cell meshes (19 draw calls) with one, over a stone slab and a brass rim (one more).
// Also the far keep and the life-and-mana plates.
import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { BOARD, FAR_KEEP, LANES, ROWS } from '../logic/layout.js';
import { merge, hash } from './geo.js';
import { slab } from './stone.js';
import { ART, css, PLACE_PALETTE } from './palette.js';
import { canvasTexture, drawText, gold, paintPlate, roundRect } from './plates.js';
import { isContrast, onArtTheme, ready } from './contrast.js';
import { THEMES } from '../logic/theme.js';

export const MAT = { w: 1024, h: Math.round((1024 * BOARD.d) / BOARD.w) };

export function paintMat(g, W = MAT.w, H = MAT.h) {
  const P = PLACE_PALETTE.grounds;
  const bg = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.62);
  bg.addColorStop(0, css(ART.boardNear));
  bg.addColorStop(1, css(ART.boardFar));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Mist and stars.
  for (let k = 0; k < 14; k++) {
    const x = hash(k, 7) * W, y = hash(k, 8) * H, r = 60 + hash(k, 9) * 160;
    const m = g.createRadialGradient(x, y, 0, x, y, r);
    m.addColorStop(0, css(P.mist, 0.07));
    m.addColorStop(1, css(P.mist, 0));
    g.fillStyle = m;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let k = 0; k < 220; k++) {
    g.fillStyle = `rgba(235,228,255,${0.15 + hash(k, 3) * 0.45})`;
    const s = hash(k, 4) > 0.94 ? 2.2 : 1.1;
    g.fillRect(hash(k, 1) * W, hash(k, 2) * H, s, s);
  }
  const cw = W / LANES, rh = H / ROWS;
  // The two sides: mine (the near three rows) warm, theirs cool, very faintly.
  g.fillStyle = 'rgba(255,190,120,0.05)';
  g.fillRect(0, H / 2, W, H / 2);
  g.fillStyle = 'rgba(120,170,255,0.05)';
  g.fillRect(0, 0, W, H / 2);
  // The cells.
  for (let lane = 0; lane < LANES; lane++) {
    for (let row = 0; row < ROWS; row++) {
      const x = lane * cw + 7, y = row * rh + 6, w = cw - 14, h = rh - 12;
      roundRect(g, x, y, w, h, 10);
      const f = g.createLinearGradient(0, y, 0, y + h);
      f.addColorStop(0, 'rgba(255,255,255,0.075)');
      f.addColorStop(1, 'rgba(255,255,255,0.025)');
      g.fillStyle = f;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = css(P.gilt, 0.55);
      g.stroke();
      // Corner ticks: a stepped mark in each cell's corners.
      g.fillStyle = css(P.gilt, 0.7);
      for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
        g.fillRect(cx + sx * 5 - (sx < 0 ? 12 : 0), cy + sy * 5 - (sy < 0 ? 3 : 0), 12, 3);
        g.fillRect(cx + sx * 5 - (sx < 0 ? 3 : 0), cy + sy * 5 - (sy < 0 ? 12 : 0), 3, 12);
      }
    }
  }
  // The lanes' double rules.
  g.strokeStyle = gold(g, 0, H);
  for (let lane = 1; lane < LANES; lane++) {
    for (const dx of [-3, 3]) {
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(lane * cw + dx, 0);
      g.lineTo(lane * cw + dx, H);
      g.stroke();
    }
  }
  // The midline: where the two sides meet, a glowing gilt seam.
  g.save();
  g.shadowColor = 'rgba(255,210,140,0.9)';
  g.shadowBlur = 18;
  g.strokeStyle = '#f2d58c';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W, H / 2);
  g.stroke();
  g.restore();
  // Each lane's numeral at its near end, as on its pad.
  for (let lane = 0; lane < LANES; lane++) {
    const n = lane + 1, cy = H - 22;
    for (let k = 0; k < n; k++) {
      g.beginPath();
      g.arc(lane * cw + cw / 2 + (k - (n - 1) / 2) * 26, cy, 8, 0, Math.PI * 2);
      g.fillStyle = css(P.gilt, 0.9);
      g.fill();
    }
  }
  // The frame.
  g.lineWidth = 8;
  g.strokeStyle = gold(g, 0, H);
  g.strokeRect(4, 4, W - 8, H - 8);
}

// High contrast: black ground (board.base), my three rows in board.near and theirs in board.far,
// white rules, a white midline, white lane numerals; no stars, no mist.
export function paintMatContrast(g, W = MAT.w, H = MAT.h) {
  const T = THEMES.contrast, cw = W / LANES, rh = H / ROWS;
  g.fillStyle = css(T['board.base']);
  g.fillRect(0, 0, W, H);
  for (let lane = 0; lane < LANES; lane++) {
    for (let row = 0; row < ROWS; row++) {
      const x = lane * cw + 8, y = row * rh + 7, w = cw - 16, h = rh - 14;
      roundRect(g, x, y, w, h, 8);
      g.fillStyle = css(row >= ROWS / 2 ? T['board.near'] : T['board.far']);
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#ffffff';
      g.stroke();
    }
  }
  g.fillStyle = '#ffffff';
  g.fillRect(0, H / 2 - 3, W, 6);
  for (let lane = 0; lane < LANES; lane++) {
    for (let k = 0; k <= lane; k++) {
      g.beginPath();
      g.arc(lane * cw + cw / 2 + (k - lane / 2) * 28, H - 22, 9, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.lineWidth = 8;
  g.strokeStyle = '#ffffff';
  g.strokeRect(4, 4, W - 8, H - 8);
}

// The mat, its slab and rim: [matMesh, baseMesh].
export function buildMat() {
  const { c, tex } = canvasTexture(MAT.w, MAT.h);
  const paint = (hc) => {
    (hc ? paintMatContrast : paintMat)(c.getContext('2d'));
    tex.needsUpdate = true;
  };
  paint(false);
  onArtTheme(paint);
  ready(tex);
  tex.anisotropy = 8; // seen at a slant, across the table
  const mat = new Mesh(new PlaneGeometry(BOARD.w, BOARD.d), new MeshBasicMaterial({ map: tex }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.0006;
  const m = 0.012, t = 0.004, W = BOARD.w + 2 * m, D = BOARD.d + 2 * m;
  const base = new Mesh(merge([
    { geo: slab(W, D, -0.012, 0, { r: 0.01, bevel: 0.003 }), color: ART.boardBase },
    { geo: new BoxGeometry(W - 0.004, t, t), at: [0, t / 2, D / 2 - t / 2 - 0.002], color: 0xc9a55a },
    { geo: new BoxGeometry(W - 0.004, t, t), at: [0, t / 2, -D / 2 + t / 2 + 0.002], color: 0xc9a55a },
    { geo: new BoxGeometry(t, t, D - 0.004), at: [W / 2 - t / 2 - 0.002, t / 2, 0], color: 0xc9a55a },
    { geo: new BoxGeometry(t, t, D - 0.004), at: [-W / 2 + t / 2 + 0.002, t / 2, 0], color: 0xc9a55a },
  ]), ready(new MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.45 })));
  return [mat, base]; // the base: theme.js takes it to board.base (assist.js), which blacks its colours
}

// The far keep: a stone keep with two towers, crenellations and a dark gate, tinted by its seat's
// plane (material colour x the stone's vertex colours). Origin at its foot, like the box it replaces.
export function buildKeep() {
  const { w, d, h } = FAR_KEEP, stone = 0xd8d4cc, dark = 0x1a1410;
  const parts = [
    { geo: new BoxGeometry(w * 0.72, h * 0.62, d * 0.8), at: [0, h * 0.31, 0], color: stone },
    { geo: new CylinderGeometry(w * 0.13, w * 0.15, h * 0.86, 8), at: [-w * 0.38, h * 0.43, 0], color: stone },
    { geo: new CylinderGeometry(w * 0.13, w * 0.15, h * 0.86, 8), at: [w * 0.38, h * 0.43, 0], color: stone },
    { geo: new CylinderGeometry(0, w * 0.17, h * 0.2, 8), at: [-w * 0.38, h * 0.96, 0], color: 0x5a4a44 },
    { geo: new CylinderGeometry(0, w * 0.17, h * 0.2, 8), at: [w * 0.38, h * 0.96, 0], color: 0x5a4a44 },
    { geo: new BoxGeometry(w * 0.2, h * 0.26, 0.004), at: [0, h * 0.13, d * 0.4 + 0.001], color: dark },
    { geo: new CylinderGeometry(w * 0.1, w * 0.1, 0.004, 10, 1, false, 0, Math.PI), at: [0, h * 0.26, d * 0.4 + 0.001], rot: [Math.PI / 2, 0, Math.PI / 2], color: dark },
  ];
  for (let k = 0; k < 4; k++) parts.push({ geo: new BoxGeometry(w * 0.1, h * 0.08, d * 0.8), at: [(-1.5 + k) * w * 0.18, h * 0.66, 0], color: stone });
  // Tinted by its seat's faction; in high contrast theme.js swaps the tint for faction.* (assist.js).
  return new Mesh(merge(parts), ready(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })));
}

// My castle plaque: a brass-edged plate under my life.
export function buildPlaque(pw, pd, ph) {
  return new Mesh(merge([
    { geo: slab(pw, pd, 0, ph, { r: 0.004, bevel: 0.0015, segments: 1 }), color: 0xffffff },
  ]), ready(new MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.4 })));
}

// Life and mana: a heart crest with the life number, and mana as crystals (lit = unspent) with its count.
function heart(g, x, y, r, hc = false) {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.4, y + r * 0.1, x - r * 0.9, y - r * 1.1, x, y - r * 0.4);
  g.bezierCurveTo(x + r * 0.9, y - r * 1.1, x + r * 1.4, y + r * 0.1, x, y + r * 0.9);
  const f = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 2, x, y, r * 1.3);
  f.addColorStop(0, '#ff9a8a');
  f.addColorStop(0.5, '#c8322e');
  f.addColorStop(1, '#5a0e0c');
  g.fillStyle = hc ? '#ffffff' : f;
  g.fill();
  g.lineWidth = Math.max(2, r * 0.08);
  g.strokeStyle = gold(g, y - r, y + r);
  g.stroke();
}

function crystal(g, x, y, r, lit, hc = false) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r * 0.62, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r * 0.62, y);
  g.closePath();
  if (hc) {
    // High contrast: an unspent crystal solid white, a spent one a white outline.
    g.fillStyle = lit ? '#ffffff' : '#000000';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#ffffff';
    g.stroke();
    return;
  }
  if (lit) {
    const f = g.createLinearGradient(x - r, y - r, x + r, y + r);
    f.addColorStop(0, '#e8fbff');
    f.addColorStop(0.45, '#7fd4ff');
    f.addColorStop(1, '#5a4ad8');
    g.fillStyle = f;
    g.fill();
  } else {
    g.fillStyle = 'rgba(40,44,70,0.9)';
    g.fill();
  }
  g.lineWidth = 2;
  g.strokeStyle = lit ? '#f2d58c' : 'rgba(201,165,90,0.55)';
  g.stroke();
}

export function paintLife(c, { life, charged = null, spent = 0 }, minPx) {
  const g = c.getContext('2d'), W = c.width, H = c.height, hc = isContrast(), T = THEMES.contrast;
  paintPlate(g, W, H, hc ? css(T['label.bg']) : css(ART.labelBg, 0.93), { hc });
  const r = H * 0.3, hx = H * 0.52;
  heart(g, hx, H * 0.52, r, hc);
  const lifeW = charged === null ? W - hx - r - H * 0.3 : W * 0.3;
  const fg = hc ? css(T['label.fg']) : '#fff4dc';
  drawText(g, String(life), { x: hx + r * 1.1, y: H * 0.1, w: lifeW, h: H * 0.8, fg, font: 'numeral', maxPx: Math.floor(H * 0.62), minPx, outline: !hc });
  if (charged === null) return;
  // Mana: one crystal per charge (lit while unspent) over [0.5 W, 0.76 W], then the count.
  const avail = Math.max(0, charged - spent), x0 = W * 0.5, span = W * 0.26;
  const step = Math.min(H * 0.36, span / Math.max(charged, 1)), cr = Math.min(H * 0.27, step * 0.62);
  for (let k = 0; k < charged; k++) crystal(g, x0 + step * (k + 0.5), H * 0.5, cr, k < avail, hc);
  drawText(g, `${avail}/${charged}`, { x: W * 0.78, y: H * 0.1, w: W * 0.19, h: H * 0.8, fg: hc ? fg : '#bfe9ff', font: 'numeral', maxPx: Math.floor(H * 0.5), minPx, outline: !hc });
}
