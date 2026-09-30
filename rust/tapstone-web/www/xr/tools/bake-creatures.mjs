// bake-creatures.mjs: turns the vendored CC0 creature models (public/CREDITS.md) into what the
// headset draws: one skinned primitive per creature (one draw call), every part's colour baked into
// vertex colour (the holographic material, src/summons/holo.js, tints it; no textures ship), only the
// five clips the summons play, renamed to idle / attack / hit / death / move, and a simplified LOD1
// bound to the same skin (so it shares the skeleton and the clips).
//
//   cd rust/tapstone-web/www/xr
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer sharp
//   node tools/bake-creatures.mjs <dir of the source .glb files>        # writes public/creatures/*.glb
//
// The sources are the poly.pizza downloads named in SOURCES (their URLs are in public/CREDITS.md).
// Rebaking is deterministic; the output is committed, so nobody needs to rerun this to play.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, joinPrimitives, resample, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { RECOLOUR } from './recolour.mjs';
import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../public/creatures');

// file → the source clip for each role. A missing role is null (the player falls back: hit → none).
const UM_FLY = { idle: 'Flying_Idle', attack: 'Headbutt', hit: 'HitReact', death: 'Death', move: 'Fast_Flying' };
const BLOB = { idle: 'Idle', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death', move: 'Walk' };
const ENEMY = { idle: 'Idle', attack: 'Attack', hit: 'HitRecieve', death: 'Death', move: 'Run' };
// The Universal Animation Library's clips, per kind of fighter (tools/assemble-units.py keeps these).
const UAL_FIGHT = { idle: 'Sword_Idle', attack: 'Sword_Attack', hit: 'Hit_Chest', death: 'Death01', move: 'Jog_Fwd_Loop' };
const UAL_CAST = { idle: 'Spell_Simple_Idle_Loop', attack: 'Spell_Simple_Shoot', hit: 'Hit_Chest', death: 'Death01', move: 'Walk_Loop' };
const UAL_RUN = { idle: 'Idle_Loop', attack: 'Punch_Cross', hit: 'Hit_Head', death: 'Death01', move: 'Sprint_Loop' };
const HERO = { idle: 'Idle_Sword', attack: 'Sword_Slash', hit: 'HitRecieve', death: 'Death', move: 'Run' };
export const SOURCES = {
  'dragon-evolved': { file: 'dragon_evolved.glb', clips: UM_FLY },
  goleling: { file: 'Goleling_71gomWolax.glb', clips: UM_FLY },
  'goleling-evolved': { file: 'Goleling_Evolved_iHEuXiH6Aj.glb', clips: UM_FLY },
  squidle: { file: 'Squidle_54QyRcsogk.glb', clips: UM_FLY },
  imp: { file: 'Enemy_Small_4LjT020LQh.glb', clips: UM_FLY },
  fish: { file: 'Fish_7V4gaDMQV8.glb', clips: BLOB },
  birb: { file: 'Birb_gZ2ExU9OAB.glb', clips: BLOB },
  demon: { file: 'Demon_LnfIziKv4o.glb', clips: { idle: 'Idle', attack: 'Weapon', hit: 'HitReact', death: 'Death', move: 'Run' } },
  skeleton: { file: 'Skeleton_DM4QScSmbS.glb', clips: ENEMY },
  wolf: { file: 'Wolf_XU7oNeKShV.glb', clips: { idle: 'Idle', attack: 'Headbutt', hit: null, death: 'Death', move: 'Run' } },
  // The commanders (2026-09-29, the fidelity pass): Quaternius's Ultimate Animated Character rig.
  king: { file: 'King_I1gTjmuK2m.glb', clips: HERO },
  hooded: { file: 'Hooded_Adventurer_y9KWOVG21R.glb', clips: HERO, rigid: true }, // keeps her sword
  // The Cinder Whelp (2026-09-29): xTerryx's Low Poly Ice Dragon, CC0, via tools/convert-drake.py. Its
  // one clip is its flight; the summons drive its idle, attack and death from it (creatures.js).
  drake: { file: 'drake-src.glb', lod1: 'drake-lod1-src.glb', clips: { move: 'Flying' }, recolour: 'forge' },
  // Set 1's people (2026-09-29, the units fidelity pass): assembled by tools/assemble-units.py from
  // Quaternius's CC0 outfits, heads and Universal Animation Library, with KayKit's CC0 props; LOD1 is
  // Blender's Decimate, like the drake's.
  'ashen-vanguard': { file: 'units/ashen-vanguard-src.glb', lod1: 'units/ashen-vanguard-lod1-src.glb', clips: UAL_FIGHT, recolour: 'forge-people' },
  'hearth-warden': { file: 'units/hearth-warden-src.glb', lod1: 'units/hearth-warden-lod1-src.glb', clips: UAL_FIGHT, recolour: 'forge-people' },
  'pearl-shieldbearer': { file: 'units/pearl-shieldbearer-src.glb', lod1: 'units/pearl-shieldbearer-lod1-src.glb', clips: UAL_FIGHT, recolour: 'deeps' },
  'reef-archer': { file: 'units/reef-archer-src.glb', lod1: 'units/reef-archer-lod1-src.glb', clips: UAL_CAST, recolour: 'deeps' },
  'tidecaller': { file: 'units/tidecaller-src.glb', lod1: 'units/tidecaller-lod1-src.glb', clips: UAL_CAST, recolour: 'deeps' },
  'brine-skimmer': { file: 'units/brine-skimmer-src.glb', lod1: 'units/brine-skimmer-lod1-src.glb', clips: UAL_RUN, recolour: 'deeps' },
  'forge-runner': { file: 'units/forge-runner-src.glb', lod1: 'units/forge-runner-lod1-src.glb', clips: UAL_RUN, recolour: 'forge-people' },
  'bellows-raider': { file: 'units/bellows-raider-src.glb', lod1: 'units/bellows-raider-lod1-src.glb', clips: UAL_FIGHT, recolour: 'forge-people' },
  // The beasts (2026-09-29): Quaternius's Giant (poly.pizza BldaiPtyJa) as the Slag Brute, recoloured to
  // basalt and ember; his Crab Enemy (Gs3yfsV5lB) as the Trench Leviathan, in the trench's blue and pearl.
  'slag-brute': { file: 'Giant_BldaiPtyJa.glb', clips: ENEMY, recolour: 'slag' },
  'trench-crab': { file: 'Crab_Enemy_Gs3yfsV5lB.glb', clips: { idle: 'Idle', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death', move: 'Walk' }, recolour: 'trench' },

};

const LOD1_RATIO = 0.4;



async function texturePixels(tex) {
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (u, v) => {
    const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
    const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
    const i = (y * info.width + x) * 4;
    return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
  };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// Every primitive gets COLOR_0 (linear RGB, as glTF wants) from its material: the base colour
// factor times the base colour texture sampled at each vertex's UV. Then UVs, normals' partners and
// materials go: the holographic material needs position, normal, skin and colour only.
async function bakeColours(doc, recolour = null) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const f = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
      const tex = mat?.getBaseColorTexture();
      const pos = prim.getAttribute('POSITION');
      const n = pos.getCount();
      const out = new Float32Array(n * 3);
      const sample = tex ? await texturePixels(tex) : null;
      // A person's skin, eyes and hair (the base body's own materials) keep their colour through a recolour.
      const keepsColour = /Superhero|Regular|Eye|Hair|Brow/i.test(mat?.getName() ?? '');
      const isHair = /Hair|Brow/i.test(mat?.getName() ?? '');
      const uv = prim.getAttribute('TEXCOORD_0');
      const t = [0, 0];
      for (let i = 0; i < n; i++) {
        let c = [1, 1, 1];
        if (sample && uv) {
          uv.getElement(i, t);
          c = sample(t[0], t[1]).map(srgbToLinear);
        }
        let rgb = [c[0] * f[0], c[1] * f[1], c[2] * f[2]];
        if (recolour && !keepsColour) rgb = recolour(rgb);
        // Hair whose texture the download doesn't carry comes in pale grey: a dark brown instead.
        if (isHair && Math.min(...rgb) > 0.3) rgb = [0.05, 0.03, 0.018];
        out[i * 3] = rgb[0];
        out[i * 3 + 1] = rgb[1];
        out[i * 3 + 2] = rgb[2];
      }
      const acc = doc.createAccessor().setType('VEC3').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]);
      prim.setAttribute('COLOR_0', acc);
      for (const sem of prim.listSemantics()) if (!['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', 'COLOR_0'].includes(sem)) prim.setAttribute(sem, null);
      prim.setMaterial(null);
    }
  }
}

// Several skinned nodes (the Demon and its trident, the Fish's three blobs) become one: their
// primitives are rewritten onto a union joint list (the same bone node appears once), then joined.
// 4x4 column-major helpers, for binding a rigid prop to its bone.
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function invert(m) {
  // Gauss-Jordan on a 4x4 (column-major in, column-major out).
  const a = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => m[c * 4 + r]).concat([0, 1, 2, 3].map((c) => (c === r ? 1 : 0))));
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    [a[i], a[p]] = [a[p], a[i]];
    const d = a[i][i];
    for (let c = 0; c < 8; c++) a[i][c] /= d;
    for (let r = 0; r < 4; r++) if (r !== i) { const f = a[r][i]; for (let c = 0; c < 8; c++) a[r][c] -= f * a[i][c]; }
  }
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r][c + 4];
  return o;
}
const apply = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const applyDir = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);

// A rigid mesh hung from a bone (the Hooded Adventurer's sword) becomes skinned to that bone: its
// vertices go into the skin's bind space (the bone's bind matrix times the prop's matrix below the
// bone), weighted 1 to it, so it joins the body and still follows the hand.
function bindRigid(doc) {
  const root = doc.getRoot();
  const skinned = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  if (!skinned.length) return;
  const skin = skinned[0].getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const buf = root.listBuffers()[0];
  for (const n of root.listNodes()) {
    if (!n.getMesh() || n.getSkin()) continue;
    // Walk up to the nearest joint, composing the local matrices on the way.
    let m = n.getMatrix(), up = n.getParentNode();
    while (up && !joints.includes(up)) {
      m = mul(up.getMatrix(), m);
      up = up.getParentNode();
    }
    if (!up) continue;
    const j = joints.indexOf(up);
    const bind = invert(ibm.getElement(j, []));
    const T = mul(bind, m);
    for (const prim of n.getMesh().listPrimitives()) {
      const P = prim.getAttribute('POSITION'), Nn = prim.getAttribute('NORMAL');
      const cnt = P.getCount();
      const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        pos.set(apply(T, P.getElement(i, [])), i * 3);
        if (Nn) {
          const d = applyDir(T, Nn.getElement(i, []));
          const l = Math.hypot(...d) || 1;
          nor.set(d.map((x) => x / l), i * 3);
        }
      }
      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf));
      if (Nn) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf));
      prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(cnt * 4).map((_, i) => (i % 4 === 0 ? j : 0))).setBuffer(buf));
      prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(cnt * 4).map((_, i) => (i % 4 === 0 ? 1 : 0))).setBuffer(buf));
    }
    n.setSkin(skin);
    // Its node transform no longer applies (a skinned mesh ignores it): the vertices carry it.
    n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
}

function mergeSkinned(doc) {
  const root = doc.getRoot();
  const nodes = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  // Unskinned mesh nodes (a stray eye mesh) are dropped: a joined creature is its skinned body.
  for (const n of root.listNodes()) if (n.getMesh() && !n.getSkin()) n.setMesh(null);
  const base = nodes[0];
  const skin = base.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const ibmOf = new Map(joints.map((j, i) => [j, ibm.getElement(i, [])]));
  for (const n of nodes.slice(1)) {
    const s = n.getSkin();
    const m = s.getInverseBindMatrices();
    s.listJoints().forEach((j, i) => {
      if (!ibmOf.has(j)) {
        joints.push(j);
        ibmOf.set(j, m.getElement(i, []));
      }
    });
  }
  const unified = doc.createSkin('creature').setSkeleton(skin.getSkeleton());
  const ibmArr = new Float32Array(joints.length * 16);
  joints.forEach((j, i) => {
    unified.addJoint(j);
    ibmArr.set(ibmOf.get(j), i * 16);
  });
  unified.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibmArr).setBuffer(root.listBuffers()[0]));
  const prims = [];
  for (const n of nodes) {
    const local = n.getSkin().listJoints();
    const remap = local.map((j) => joints.indexOf(j));
    for (const p of n.getMesh().listPrimitives()) {
      const J = p.getAttribute('JOINTS_0');
      const arr = new Uint16Array(J.getCount() * 4);
      const e = [0, 0, 0, 0];
      for (let i = 0; i < J.getCount(); i++) {
        J.getElement(i, e);
        for (let k = 0; k < 4; k++) arr[i * 4 + k] = remap[e[k]];
      }
      p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(arr).setBuffer(root.listBuffers()[0]));
      // Normalise each primitive's attribute set, so they join.
      const P = p.getAttribute('POSITION');
      const W = p.getAttribute('WEIGHTS_0');
      if (W.getComponentType() !== 5126) {
        const w = new Float32Array(W.getCount() * 4);
        for (let i = 0; i < W.getCount(); i++) w.set(W.getElement(i, [0, 0, 0, 0]), i * 4);
        p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(w).setBuffer(root.listBuffers()[0]));
      }
      if (!p.getIndices()) {
        const idx = new Uint32Array(P.getCount()).map((_, i) => i);
        p.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(root.listBuffers()[0]));
      }
      prims.push(p);
    }
  }
  const joined = joinPrimitives(prims);
  const mesh = doc.createMesh('lod0').addPrimitive(joined);
  for (const n of nodes) {
    n.getMesh().dispose(); // or dedup() folds lod0 back into a single-part original
    n.setMesh(null);
    n.setSkin(null);
  }
  base.setMesh(mesh).setSkin(unified).setName('lod0');
  return { node: base, skin: unified, mesh };
}

// LOD1 from a second export of the same rig: its colours baked and its parts joined like LOD0's, then
// copied in with its joints renumbered onto LOD0's skin by bone name (the two exports list them alike,
// but nothing promises the same order).
async function lod1From(srcDir, name, spec, doc, skin, buf) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const d2 = await io.read(join(srcDir, spec.lod1));
  const r2 = d2.getRoot();
  const [b0, ...more] = r2.listBuffers();
  for (const b of more) {
    for (const a of r2.listAccessors()) if (a.getBuffer() === b) a.setBuffer(b0);
    b.dispose();
  }
  await bakeColours(d2, spec.recolour ? RECOLOUR[spec.recolour] : null);
  mergeSkinned(d2);
  const m2 = r2.listMeshes().find((m) => m.getName() === 'lod0');
  const q = m2.listPrimitives()[0];
  const n2 = r2.listNodes().find((n) => n.getMesh() === m2);
  const names = skin.listJoints().map((j) => j.getName());
  const map = n2.getSkin().listJoints().map((j) => names.indexOf(j.getName()));
  if (map.includes(-1)) throw new Error(`${name}: LOD1's rig has bones LOD0's lacks`);
  const p = doc.createPrimitive();
  for (const sem of q.listSemantics()) {
    const a = q.getAttribute(sem);
    let arr = a.getArray().slice();
    if (sem === 'JOINTS_0') arr = Uint16Array.from(arr, (j) => map[j]);
    p.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(arr).setNormalized(a.getNormalized()).setBuffer(buf));
  }
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(q.getIndices().getArray())).setBuffer(buf));
  return p;
}

async function bake(srcDir, name, spec) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(srcDir, spec.file));
  const root = doc.getRoot();
  if (root.listBuffers().length === 0) doc.createBuffer();
  // Collapse to one buffer: new accessors land in the first.
  const [first, ...rest] = root.listBuffers();
  for (const b of rest) {
    for (const a of root.listAccessors()) if (a.getBuffer() === b) a.setBuffer(first);
    b.dispose();
  }
  await bakeColours(doc, spec.recolour ? RECOLOUR[spec.recolour] : null);
  // Keep only the five roles' clips, renamed.
  const byShort = new Map(root.listAnimations().map((a) => [a.getName().split('|').pop(), a]));
  const keep = new Set();
  for (const [role, clip] of Object.entries(spec.clips)) {
    if (!clip) continue;
    const a = byShort.get(clip);
    if (!a) throw new Error(`${name}: no clip ${clip} (has ${[...byShort.keys()].join(', ')})`);
    if (keep.has(a)) throw new Error(`${name}: ${clip} plays two roles`);
    a.setName(role);
    keep.add(a);
  }
  for (const a of root.listAnimations()) if (!keep.has(a)) a.dispose();
  if (spec.rigid) bindRigid(doc);
  mergeSkinned(doc);
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  await doc.transform(resample(), weld(), dedup(), prune({ keepAttributes: true }));
  // LOD1: LOD0's own vertices (the same accessors, so no second copy) with a simplified index list,
  // on a sibling node bound to the same skin: it shares the skeleton and the clips.
  await MeshoptSimplifier.ready;
  const lod0 = root.listMeshes().find((m) => m.getName() === 'lod0');
  // dedup() may have folded the merged skin into an identical original: read both back from lod0's node.
  const node = root.listNodes().find((n) => n.getMesh() === lod0);
  const skin = node.getSkin();
  const p0 = lod0.listPrimitives()[0];
  if (!p0) throw new Error(`${name}: lod0 lost its primitive (${root.listMeshes().map((m) => m.getName())})`);
  const pos = p0.getAttribute('POSITION').getArray();
  const idx = new Uint32Array(p0.getIndices().getArray());
  const target = Math.floor((idx.length / 3) * LOD1_RATIO) * 3;
  let [lodIdx] = MeshoptSimplifier.simplify(idx, new Float32Array(pos), 3, target, 0.02);
  // A flat-shaded figure (the commanders) splits every vertex at its normal seams, so the simplifier
  // sees borders everywhere and keeps them: simplify it on an index welded by position alone (each
  // vertex → the first at its spot), at a looser error. LOD1 then uses those vertices' normals,
  // which the far seat's distance hides.
  if (lodIdx.length > target * 1.5) {
    const first = new Map();
    const remap = new Uint32Array(pos.length / 3);
    for (let v = 0; v < remap.length; v++) {
      const k = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`;
      if (!first.has(k)) first.set(k, v);
      remap[v] = first.get(k);
    }
    [lodIdx] = MeshoptSimplifier.simplify(idx.map((v) => remap[v]), new Float32Array(pos), 3, target, 0.05);
  }
  let p1 = doc.createPrimitive();
  if (spec.lod1) {
    // A LOD1 made elsewhere (the drake: Blender's Decimate, tools/convert-drake.py), same rig.
    p1.dispose();
    p1 = await lod1From(srcDir, name, spec, doc, skin, first);
    lodIdx = p1.getIndices().getArray();
  } else {
    for (const sem of p0.listSemantics()) p1.setAttribute(sem, p0.getAttribute(sem));
    p1.setIndices(doc.createAccessor().setType('SCALAR').setArray(lodIdx).setBuffer(first));
  }
  const lod1Node = doc.createNode('lod1').setMesh(doc.createMesh('lod1').addPrimitive(p1)).setSkin(skin);
  lod1Node.setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
  const parent = node.getParentNode();
  if (parent) parent.addChild(lod1Node);
  else root.listScenes()[0].addChild(lod1Node);
  const out = join(OUT, `${name}.glb`);
  await io.write(out, doc);
  const b0 = getBounds(root.listScenes()[0]);
  return { name, lod0: idx.length / 3, lod1: lodIdx.length / 3, kb: Math.round(statSync(out).size / 1024), clips: root.listAnimations().map((x) => x.getName()).join(' '), minY: +b0.min[1].toFixed(2), maxY: +b0.max[1].toFixed(2) };
}

const srcDir = process.argv[2];
if (!srcDir) {
  console.error('usage: node tools/bake-creatures.mjs <dir of source .glb files>');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const only = process.argv[3];
const report = [];
for (const [name, spec] of Object.entries(SOURCES)) {
  if (only && only !== name) continue;
  report.push(await bake(srcDir, name, spec));
}
console.table(report);
