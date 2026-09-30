// geo.js: the world art's geometry helpers. Static scenery is built from many small parts and merged
// into ONE geometry per material (a draw call per material, not per part), with its colour and its
// light baked into vertex colours at build time (no real-time lights, no shadows: the Quest 2's budget).
// Imports three only (not @iwsdk/core), so node tests it.
import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';

// Parts -> one non-indexed geometry with position, normal, color (and uv when every part has one).
// A part: { geo, color (hex, or (x,y,z) => hex), at: [x,y,z], rot: [x,y,z], scale: [x,y,z] | matrix }.
export function merge(parts) {
  const geos = parts.map((p) => {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone());
    const m = p.matrix ?? new Matrix4().compose(
      new Vector3(...(p.at ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(p.rot ?? [0, 0, 0]))),
      new Vector3(...(p.scale ?? [1, 1, 1])),
    );
    g.applyMatrix4(m);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (p.color === undefined && g.getAttribute('color')) return g; // already coloured (and maybe baked)
    const pos = g.getAttribute('position'), n = pos.count, col = new Float32Array(n * 3), c = new Color();
    for (let i = 0; i < n; i++) {
      const hex = typeof p.color === 'function' ? p.color(pos.getX(i), pos.getY(i), pos.getZ(i)) : p.color ?? 0xffffff;
      c.setHex(hex);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    return g;
  });
  const out = new BufferGeometry();
  const uv = geos.every((g) => g.getAttribute('uv'));
  for (const name of ['position', 'normal', 'color', ...(uv ? ['uv'] : [])]) {
    const size = geos[0].getAttribute(name).itemSize;
    const total = geos.reduce((s, g) => s + g.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(name);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[o++] = a.array[i * size + k] ?? 0;
    }
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  return out;
}

// Bakes light into a merged geometry's vertex colours, in place: albedo x (ambient + each light's
// wrapped Lambert term / (1 + (d / falloff)^2)) + emissive (a per-vertex extra, e.g. shoji paper
// lit from behind). lights: [{ at: [x,y,z], color: hex, intensity, falloff }]. `occlude(p, n)`
// returns 0..1, a cheap stand-in for ambient occlusion (the floor's corners, under the table).
// Returns the geometry.
export function bake(geo, { lights = [], ambient = 0x202020, occlude = null, emissive = null, wrap = 0.35 } = {}) {
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), col = geo.getAttribute('color');
  const amb = new Color(ambient), lc = lights.map((l) => ({ ...l, c: new Color(l.color) }));
  const p = new Vector3(), n = new Vector3(), d = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    let r = amb.r, g = amb.g, b = amb.b;
    for (const l of lc) {
      d.set(l.at[0] - p.x, l.at[1] - p.y, l.at[2] - p.z);
      const dist = d.length();
      const lam = Math.max(0, (n.dot(d.normalize()) + wrap) / (1 + wrap));
      let k = (l.intensity * lam) / (1 + (dist / l.falloff) ** 2);
      // A spot (l.cone: the cosine of its half-angle, pointing straight down) lights only below it;
      // a capped light (a lantern's black cap) throws little upward.
      if (l.cone) k *= Math.min(1, Math.max(0, (-d.y - l.cone) / (1 - l.cone)) * 4);
      if (l.capped && p.y > l.at[1] + 0.15) k *= 0.3;
      r += l.c.r * k;
      g += l.c.g * k;
      b += l.c.b * k;
    }
    const ao = occlude ? occlude(p, n) : 1;
    const e = emissive ? emissive(p, n) : 0;
    col.setXYZ(i, col.getX(i) * (r * ao + e), col.getY(i) * (g * ao + e), col.getZ(i) * (b * ao + e));
  }
  col.needsUpdate = true;
  return geo;
}

// A tiny deterministic hash in 0..1 (grain, plank tones), so a build is the same every load.
export function hash(x, y = 0, z = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Multiplies a hex colour by k (0..n), clamped.
export function shade(hex, k) {
  const c = new Color(hex).multiplyScalar(k);
  return new Color(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b)).getHex();
}

// Mixes two hex colours.
export function mix(a, b, t) {
  return new Color(a).lerp(new Color(b), t).getHex();
}
