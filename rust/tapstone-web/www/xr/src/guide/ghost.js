// guide/ghost.js: the guide's demonstrations, drawn (guide v2). A translucent ghost hand plays the move
// the lesson teaches, from guide/demo.js's keyframes: the pinch, the carry, the wrist turned over for a
// charge (the ghost card shows its back), the touch onto the stone. A dotted path shows the route, a
// ring glows on the target, and a caption over the altar carries the lesson's sentence with the voice.
//
// Built once, at init (so the prewarm compiles it), from primitives: no textures fetched, no lights.
// Seven draws while a demo runs, none while it doesn't: the hand is three meshes (the palm with its
// curled fingers merged, the index and the thumb, which close to pinch), the card one (face and back
// by vertex colour), the path one InstancedMesh, the ring one, the caption one.
import { BoxGeometry, CapsuleGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, SphereGeometry, Vector3, BufferAttribute } from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CARD } from '../logic/layout.js';
import { label } from '../board.js';
import { palette, onTheme, themed, themeName } from '../theme.js';
import { ready } from '../art/contrast.js';
import { hexVec, ringMaterial } from '../dwell-ring.js';
import { HAND, gazePoseAt, pathPoints, poseAt, stage } from './demo.js';

const GHOST = 0x7fe0ff; // a spirit-blue, lit by nothing: it reads in passthrough and in the lantern light
const GLOW = 0xffc870; // the lantern gold of the Tea House (0039)
const DOTS = 12;
const UP = new Vector3(0, 1, 0);

// forceSinglePass: three draws a transparent double-sided material twice (back faces, then front) by
// default; the ghost needs no such sorting, and on the B60 it was 10 of the demo's 26 draw calls.
const ghostMaterial = (color, opacity) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide, forceSinglePass: true });
// #200's theme hook: under high contrast the ghost is the reticle's white and its path, rings and
// highlights the dwell yellow (logic/theme.js), each held there at 7:1 against the board.
const themedGhost = (color, opacity, role) => themed(ghostMaterial(color, opacity), role);

// A capsule from a to b (hand-local), re-aimed every frame for the two moving fingers.
function aim(mesh, a, b) {
  const d = new Vector3().subVectors(b, a);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize());
  mesh.scale.set(1, d.length() / 0.03, 1); // the capsule's body is 3 cm long before scaling
}

export class Ghost {
  constructor(parentGroup) {
    this.group = new Group();
    this.group.visible = false;
    parentGroup.add(this.group);

    // The hand: pinch point at the origin, the palm and wrist behind it along +z, the back of the hand
    // up (+y). update() turns +z to demo.js stage()'s side, so the hand works from beside the move.
    this.hand = new Group();
    // Life size, from demo.js HAND (the same numbers the staging test holds): a rounded palm, a short
    // wrist (no forearm: #198's ran 12 cm back toward the eyes), and the three fingers that don't pinch.
    const palm = new SphereGeometry(1, 12, 8).scale(0.036, 0.013, 0.042).translate(0, HAND.palmY, HAND.palmAt - 0.01);
    const wrist = new CapsuleGeometry(0.018, 0.02, 3, 8).rotateX(Math.PI / 2).translate(0, HAND.palmY + 0.002, HAND.length - 0.025);
    const curled = [-0.002, 0.016, 0.031].map((x, k) => new CapsuleGeometry(0.0075, 0.03 - k * 0.004, 4, 8).rotateX(Math.PI / 2 - 0.6).translate(x, 0.02, 0.022));
    const skin = themedGhost(GHOST, 0.6, 'reticle');
    this.palm = new Mesh(mergeGeometries([palm, wrist, ...curled].map((g) => g.toNonIndexed())), skin);
    this.skin = skin;
    this.index = new Mesh(new CapsuleGeometry(0.0085, 0.03, 4, 8), skin);
    this.thumb = new Mesh(new CapsuleGeometry(0.0095, 0.03, 4, 8), skin);
    this.hand.add(this.palm, this.index, this.thumb);
    this.knuckle = { index: new Vector3(-0.022, 0.032, 0.04), thumb: new Vector3(0.036, 0.02, 0.065) };

    // The card in the fingers: face (warm parchment) on +y, back (the deck's brown) on -y.
    const box = new BoxGeometry(CARD.w, 0.002, CARD.d).toNonIndexed();
    const face = new Color(0xfff1d0), back = new Color(0x5a4636), colors = [];
    const pos = box.getAttribute('position'), nrm = box.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const c = nrm.getY(i) < -0.5 ? back : face;
      colors.push(c.r, c.g, c.b);
    }
    box.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    this.card = new Mesh(box, ready(new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })));
    this.lat = { x: 1, y: 0, z: 0 };
    this.side = 1;
    // Centred on the pinch, so at the pinch it lies over the real card it shows. Hung off the
    // fingertips, it stuck out past them toward the viewer once the hand came from the side.
    this.card.position.set(0, -0.003, 0);
    this.hand.add(this.card);
    this.group.add(this.hand);

    this.dots = new InstancedMesh(new SphereGeometry(0.0035, 6, 4), themedGhost(GLOW, 0.75, 'dwell'), DOTS); // 3.5 mm beads: 6x4 is round enough
    this.ring = new Mesh(new RingGeometry(0.032, 0.043, 40).rotateX(-Math.PI / 2), themedGhost(GLOW, 0.8, 'dwell'));
    // The head-gaze demo's ring: the same arc as the live dwell ring (dwell-ring.js), filling on each
    // target in turn, facing the head.
    this.gazeRing = new Mesh(new PlaneGeometry(0.034, 0.034), ready(ringMaterial()));
    this.gazeRing.visible = false;
    // The caption: #199's engraved plate (art/plates.js), which redraws itself for high contrast.
    this.caption = label(1024, 112);
    this.captionMesh = new Mesh(new PlaneGeometry(0.36, 0.039), new MeshBasicMaterial({ map: this.caption.tex, transparent: true, depthWrite: false }));
    this.group.add(this.dots, this.ring, this.gazeRing, this.captionMesh);
    this.demo = null;
    this.mode = 'hands';
    // Under high contrast the ghost card is flat white (its vertex-coloured face and back are pale).
    const paint = () => {
      const hc = themeName() === 'contrast';
      this.card.material.vertexColors = !hc;
      this.card.material.color.setHex(hc ? palette().reticle : 0xffffff);
      this.card.material.needsUpdate = true;
      hexVec(palette().dwell, this.gazeRing.material.uniforms.color.value);
    };
    paint();
    onTheme(paint);
    this.t0 = 0;
    this.m = new Matrix4();
  }

  // Show `demo` ({ move, from, to } with board-local positions resolved by the caller), captioned.
  // `how` (guide/modes.js): { mode: 'hands' | 'gaze' | 'voice', spots } where `spots` are the gaze
  // steps' positions. Head gaze shows the dwell ring on each spot in turn and voice the phrase, on the
  // caption; neither shows the hand.
  show(demo, say, now, captionAt, how = {}) {
    this.demo = demo;
    this.t0 = now;
    this.mode = how.mode ?? 'hands';
    this.spots = how.spots ?? [];
    this.steps = how.steps ?? [];
    this.group.visible = true;
    // Staged beside the move, on the reaching side, clear of the eyes, the pad and the caption
    // (demo.js stage(); `how.head` is board-local, `how.side` 1 right-handed, -1 left).
    this.side = how.side ?? 1;
    this.lat = how.head ? stage(how.head, demo.from, demo.to, this.side, { move: demo.move, caption: captionAt }) : { x: this.side, y: 0, z: 0 };
    const pts = pathPoints(demo.from, demo.to, DOTS, this.lat);
    pts.forEach((p, i) => this.dots.setMatrixAt(i, this.m.makeTranslation(p.x, p.y, p.z)));
    this.dots.instanceMatrix.needsUpdate = true;
    this.ring.position.set(demo.to.x, demo.to.y + 0.002, demo.to.z);
    this.recaption(say);
    this.captionMesh.position.set(captionAt.x, captionAt.y, captionAt.z);
    this.captionMesh.rotation.set(-Math.PI / 5, 0, 0); // tipped up toward a seated player's eyes
  }

  // The caption carries the lesson's sentence, the same one the voice says (redrawn only on a change).
  recaption(say) {
    if (say === this.said) return;
    this.said = say ?? '';
    this.caption.draw(this.said);
  }

  hide() {
    this.demo = null;
    this.group.visible = false;
  }

  // While a hand is busy (holding a card), the demo steps aside: the path and ring stay, the ghost goes.
  // `head` (world) turns the gaze ring to the eyes; `dwellMs` is the person's dwell (#200's setting).
  update(now, { busy = false, head = null, dwellMs = 1000 } = {}) {
    if (!this.demo) return;
    const t = now - this.t0;
    this.ring.material.opacity = 0.45 + 0.4 * Math.sin(t / 180) ** 2;
    if (this.mode !== 'hands') {
      this.hand.visible = false;
      const g = this.mode === 'gaze' && this.spots.length ? gazePoseAt(this.spots, t, dwellMs) : null;
      this.gazeRing.visible = !!g?.show;
      if (!g?.show) return;
      const s = this.spots[g.step];
      this.gazeRing.position.set(s.x, s.y + 0.012, s.z);
      if (head) this.gazeRing.lookAt(head); // Object3D.lookAt takes a world point; the plane faces +z
      this.gazeRing.material.uniforms.progress.value = g.progress;
      return;
    }
    this.gazeRing.visible = false;
    const p = poseAt(this.demo.move, this.demo.from, this.demo.to, t, { lat: this.lat });
    this.hand.visible = p.show && p.alpha > 0.01 && !busy;
    if (!this.hand.visible) return;
    // Fading in as it reaches, out as it rises (demo.js alpha).
    this.skin.opacity = 0.6 * p.alpha;
    this.card.material.opacity = 0.55 * p.alpha;
    this.hand.position.set(p.pos.x, p.pos.y, p.pos.z);
    // The palm and wrist toward the staged side (yaw), the wrist turned over about that axis (roll),
    // and mirrored so the thumb is on the player's side: a right hand from the right, a left from the left.
    this.hand.scale.set(this.side > 0 ? -1 : 1, 1, 1);
    this.hand.rotation.set(0, Math.atan2(this.lat.x, this.lat.z), (p.roll * Math.PI) / 180);
    // The pinch: index and thumb tips meet at the origin when closed, 3 cm apart when open.
    const open = 1 - p.pinch;
    aim(this.index, this.knuckle.index, new Vector3(-0.003 - 0.014 * open, 0.003 + 0.012 * open, -0.004 - 0.016 * open));
    aim(this.thumb, this.knuckle.thumb, new Vector3(0.004 + 0.02 * open, 0.002, 0.004 + 0.008 * open));
    this.card.visible = p.carrying;
  }

  get visible() {
    return this.group.visible;
  }
}
