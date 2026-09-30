// stone.js: the altar as an object (materials.md's shrine two-point-oh, in stone): a carved stone
// block on a darker foot, a brass lip around its top with a gap in it (materials.md: a closed ring is
// a shorted turn over the reader; the virtual shrine keeps the real one's rule), three inset lane
// pads of dark wood with brass corners, a crystal and the lane's Mayan dot numeral (one, two, three
// dots: PROPOSAL, the Mayan influence of 0039), and a faceted crystal eye on a brass mount.
// Stone and brass are lit by the room's image light; the textures are painted once at load.
import { ExtrudeGeometry, IcosahedronGeometry, Mesh, MeshStandardMaterial, RepeatWrapping, Shape, BoxGeometry, CylinderGeometry } from '@iwsdk/core';
import { ALTAR, PAD } from '../logic/layout.js';
import { merge, hash } from './geo.js';
import { canvasTexture, gold, roundRect } from './plates.js';
import { ART, css } from './palette.js';
import { flatWhenContrast, onArtTheme, ready } from './contrast.js';

function roundedShape(w, d, r) {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  return s;
}

// A rounded slab `w` x `d`, from y0 to y1, bevelled, lying in xz.
export function slab(w, d, y0, y1, { r = 0.006, bevel = 0.0025, segments = 2 } = {}) {
  const h = y1 - y0 - 2 * bevel;
  const g = new ExtrudeGeometry(roundedShape(w - 2 * bevel, d - 2 * bevel, r), { depth: Math.max(0.0005, h), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segments, curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  return g;
}

// Granite: a grey-green ground with speckle and two faint veins (256 x 128, tiled).
function stoneTexture() {
  const { c, tex } = canvasTexture(256, 128);
  const g = c.getContext('2d');
  g.fillStyle = css(ART.stone);
  g.fillRect(0, 0, 256, 128);
  for (let k = 0; k < 2600; k++) {
    const x = hash(k, 1) * 256, y = hash(k, 2) * 128, t = hash(k, 3);
    g.fillStyle = t < 0.5 ? `rgba(40,42,44,${0.15 + t * 0.4})` : `rgba(210,212,200,${(t - 0.5) * 0.35})`;
    g.fillRect(x, y, 1 + (t > 0.93) * 1.5, 1 + (t > 0.93) * 1.5);
  }
  g.strokeStyle = 'rgba(225,220,200,0.22)';
  g.lineWidth = 1.2;
  for (const y0 of [34, 90]) {
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y0 + Math.sin(x * 0.05 + y0) * 9 + hash(x, y0) * 4);
    g.stroke();
  }
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(1 / 0.16, 1 / 0.08); // ExtrudeGeometry's uvs are metres
  return tex;
}

// The three pads' atlas: 3 columns of 256 x 224 (a pad is 8 x 7 cm).
export const PAD_ATLAS = { w: 768, h: 224, col: 256 };
function padTexture() {
  const { c, tex } = canvasTexture(PAD_ATLAS.w, PAD_ATLAS.h);
  const paint = (hc) => {
    (hc ? paintPadsContrast : paintPads)(c.getContext('2d'));
    tex.needsUpdate = true;
  };
  paint(false);
  onArtTheme(paint);
  return ready(tex);
}

// High contrast: each pad white (theme.js multiplies the pad colour, yellow, over it), a thick
// black frame, and its lane's dots in black: the lane reads without its colour.
function paintPadsContrast(g) {
  const W = PAD_ATLAS.col, H = PAD_ATLAS.h;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, PAD_ATLAS.w, H);
  for (let lane = 0; lane < 3; lane++) {
    const x0 = lane * W, cx = x0 + W / 2;
    g.lineWidth = 14;
    g.strokeStyle = '#000000';
    roundRect(g, x0 + 9, 9, W - 18, H - 18, 16);
    g.stroke();
    for (let k = 0; k <= lane; k++) {
      g.beginPath();
      g.arc(cx + (k - lane / 2) * 50, H / 2 + 10, 20, 0, Math.PI * 2);
      g.fillStyle = '#000000';
      g.fill();
    }
  }
}

function paintPads(g) {
  for (let lane = 0; lane < 3; lane++) {
    const x0 = lane * PAD_ATLAS.col, W = PAD_ATLAS.col, H = PAD_ATLAS.h;
    g.save();
    g.translate(x0, 0);
    // Walnut, with its grain along the lane.
    const wood = g.createLinearGradient(0, 0, W, 0);
    wood.addColorStop(0, '#2c1a10');
    wood.addColorStop(0.5, css(ART.pad));
    wood.addColorStop(1, '#2a180e');
    g.fillStyle = wood;
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(${k % 3 ? 20 : 90},${k % 3 ? 12 : 60},${k % 3 ? 6 : 30},0.35)`;
      g.lineWidth = 1 + hash(k, lane) * 1.5;
      g.beginPath();
      const x = 8 + k * 9.3;
      for (let y = 0; y <= H; y += 14) g.lineTo(x + Math.sin(y * 0.04 + k) * 3, y);
      g.stroke();
    }
    // The brass bevel and its corner caps.
    g.lineWidth = 10;
    g.strokeStyle = gold(g, 0, H);
    roundRect(g, 5, 5, W - 10, H - 10, 16);
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(20,10,4,0.8)';
    roundRect(g, 11, 11, W - 22, H - 22, 12);
    g.stroke();
    for (const [cx, cy] of [[18, 18], [W - 18, 18], [18, H - 18], [W - 18, H - 18]]) {
      g.beginPath();
      g.arc(cx, cy, 9, 0, Math.PI * 2);
      g.fillStyle = gold(g, cy - 9, cy + 9);
      g.fill();
    }
    // The crystal: a cabochon toward the board (the pad's far end).
    const cy = 62, cx = W / 2;
    const cr = g.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, 26);
    cr.addColorStop(0, '#fff6e0');
    cr.addColorStop(0.35, '#f0c060');
    cr.addColorStop(1, '#8a4a10');
    g.beginPath();
    g.ellipse(cx, cy, 26, 22, 0, 0, Math.PI * 2);
    g.fillStyle = cr;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = gold(g, cy - 22, cy + 22);
    g.stroke();
    // The lane's numeral: Mayan dots, one to three, in gilt.
    const n = lane + 1, dy = 150;
    for (let k = 0; k < n; k++) {
      const dx = cx + (k - (n - 1) / 2) * 42;
      g.beginPath();
      g.arc(dx, dy, 14, 0, Math.PI * 2);
      g.fillStyle = gold(g, dy - 14, dy + 14);
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = 'rgba(10,6,2,0.85)';
      g.stroke();
    }
    g.restore();
  }
}

// Builds the stone: returns { stone, lip, eye, padMaterial, padGeometry(lane) }.
export function buildStone() {
  const { w, d, h, z } = ALTAR;
  const body = slab(w, d, 0.004, h, { r: 0.008, bevel: 0.003 });
  const foot = slab(w + 0.008, d + 0.008, 0, 0.0055, { r: 0.01, bevel: 0.0015, segments: 1 });
  const stone = new Mesh(
    merge([{ geo: body, color: 0xffffff }, { geo: foot, color: 0x6a6660 }]),
    new MeshStandardMaterial({ map: stoneTexture(), vertexColors: true, roughness: 0.82, metalness: 0 }),
  );
  stone.position.z = z;
  // High contrast: the stone flat near-black (altar.stone), the pads and cards on it bright.
  flatWhenContrast(stone, 'altar.stone', (c) => new MeshStandardMaterial({ color: c, roughness: 1 }));
  // The brass lip: four rails round the top, open at the back's middle (a gap, not a shorted ring).
  const t = 0.0024, y = h + t / 2 - 0.0008, gap = 0.02;
  const rails = [
    { geo: new BoxGeometry(w - 0.006, t, t), at: [0, y, d / 2 - 0.004] },
    { geo: new BoxGeometry(w / 2 - gap / 2 - 0.004, t, t), at: [-(w / 4 + gap / 4), y, -d / 2 + 0.004] },
    { geo: new BoxGeometry(w / 2 - gap / 2 - 0.004, t, t), at: [w / 4 + gap / 4, y, -d / 2 + 0.004] },
    { geo: new BoxGeometry(t, t, d - 0.006), at: [-w / 2 + 0.004, y, 0] },
    { geo: new BoxGeometry(t, t, d - 0.006), at: [w / 2 - 0.004, y, 0] },
    // The eye's mount, in the gap.
    { geo: new CylinderGeometry(0.006, 0.008, 0.006, 8), at: [0, h + 0.003, -d / 2 + 0.01] },
  ].map((p) => ({ ...p, color: 0xffffff }));
  const lip = new Mesh(merge(rails), new MeshStandardMaterial({ color: 0xc9a55a, metalness: 1, roughness: 0.32 }));
  lip.position.z = z;
  // The eye: a faceted crystal, amber at rest.
  const eye = new Mesh(new IcosahedronGeometry(0.0085, 0), new MeshStandardMaterial({ color: 0xffd080, emissive: ART.eye, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.1, flatShading: true }));
  eye.position.set(0, h + 0.0135, z - d / 2 + 0.01);
  eye.scale.set(1, 1.35, 1);
  const padMaterial = new MeshStandardMaterial({ map: padTexture(), roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
  // High contrast: the pads glow a little, so the room's light can't dim their yellow (theme.js sets
  // the colour, pad; the atlas repaints white under it).
  onArtTheme((on) => padMaterial.emissive.setHex(on ? 0x4a3e00 : 0x000000));
  return { stone, lip, eye, padMaterial };
}

// A pad's plane, its uvs on its lane's column of the atlas.
export function padUvs(geo, lane) {
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, (lane + uv.getX(i)) / 3);
  uv.needsUpdate = true;
  return geo;
}
export const PAD_SIZE = PAD;
