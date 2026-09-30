// hand.js: the person's cards, fanned low in front of them (spec 2026-09-25 §3.1), drawn from
// table.hand() (the page's own shrine knows its hand; the view carries only a count). Each card is
// OneHandGrabbable, so a pinch picks it up and it follows the hand; RayInteractable, so the
// eyes-and-hands path can select it from afar. The face is read from the card's own orientation:
// its local +y dotted with world up (1 = face up), through FlipDetector's hysteresis.
import { CapsuleGeometry, Mesh, MeshStandardMaterial, OneHandGrabbable, RayInteractable, Vector3 } from '@iwsdk/core';
import { HAND } from './logic/layout.js';
import { HAND_HOME, clampSpot, loadSpot, saveSpot } from './logic/hand-place.js';
import { FlipDetector } from './logic/gestures.js';
import { FaceSlots } from './logic/face-slots.js';
import { HandCard, HandGrip } from './tags.js';
import { blankFace, drawFace } from './art/card-face.js';
import { card3d } from './art/card-mesh.js';
import { themed } from './theme.js';

const MAX = 10;

// One canvas and texture per slot (logic/face-slots.js), repainted in place; the face and the
// holographic card are the world art's (src/art/card-face.js, src/art/card-mesh.js).

export class Hand {
  constructor(world, parentEntity, parentGroup) {
    this.cards = [];
    this.faces = new FaceSlots(MAX, blankFace);
    for (let slot = 0; slot < MAX; slot++) {
      // The map is set once, here, so the prewarm compile (index.js) builds the program a face uses.
      const mesh = card3d(this.faces.texture(slot));
      mesh.visible = false;
      parentGroup.add(mesh);
      const e = world.createTransformEntity(mesh, parentEntity);
      e.addComponent(OneHandGrabbable, {});
      e.addComponent(RayInteractable);
      e.addComponent(HandCard, { slot });
      this.cards.push({ mesh, e, flip: new FlipDetector(), data: null });
    }
    this.up = new Vector3();
    // Where the fan sits (logic/hand-place.js): stored per page and per hand. The grip is a slim wooden
    // bar just under the fan's near edge; pinching it moves the whole hand, and it stays where let go.
    this.storage = (() => {
      try {
        return globalThis.localStorage ?? null;
      } catch {
        return null;
      }
    })();
    this.leftHanded = false;
    this.origin = loadSpot(this.storage, false);
    // A lantern-gold knob at the fan's outer end, on the hand that reaches for it: off to the side, so it
    // never hides the stone behind the cards; round, so it reads as a handle and not as another card or
    // the deck; and near 3 cm thick, since hand tracking wobbles by about a centimetre.
    this.grip = new Mesh(new CapsuleGeometry(0.014, 0.034, 4, 12), themed(new MeshStandardMaterial({ color: 0xc89a4a, roughness: 0.5, emissive: 0x3a2508 }), 'pad')); // live: the pads' yellow in high contrast
    parentGroup.add(this.grip);
    this.gripEntity = world.createTransformEntity(this.grip, parentEntity);
    this.gripEntity.addComponent(OneHandGrabbable, {});
    this.gripEntity.addComponent(HandGrip);
    this.snapGrip();
  }

  // The grip's offset from the fan's centre: past the outer card, on the reaching hand's side.
  get GRIP() {
    return { x: (this.leftHanded ? -1 : 1) * (HAND.spread + 0.045), y: -0.03, z: 0.012 };
  }

  snapGrip() {
    const g = this.GRIP;
    this.grip.position.set(this.origin.x + g.x, this.origin.y + g.y, this.origin.z + g.z);
    this.grip.rotation.set(0, 0, 0);
  }

  // While the grip is held: the fan follows it (clamped to reach), every frame.
  followGrip(hand, heldSlots) {
    const g = this.GRIP;
    this.origin = clampSpot({ x: this.grip.position.x - g.x, y: this.grip.position.y - g.y, z: this.grip.position.z - g.z });
    this.refan(hand, heldSlots);
  }

  // The grip was let go: the fan stays there, the grip squares up under it, and the spot is stored.
  dropGrip(hand, heldSlots) {
    this.followGrip(hand, heldSlots);
    this.origin = saveSpot(this.storage, this.leftHanded, this.origin);
    this.snapGrip();
  }

  // Left- or right-handed: each keeps its own spot.
  useHand(leftHanded, hand, heldSlots) {
    this.leftHanded = !!leftHanded;
    this.origin = loadSpot(this.storage, this.leftHanded);
    this.snapGrip();
    this.refan(hand, heldSlots);
  }

  // Back to where the fan always sat (and forget the stored spot for this hand).
  home(hand, heldSlots) {
    this.origin = saveSpot(this.storage, this.leftHanded, HAND_HOME);
    this.snapGrip();
    this.refan(hand, heldSlots);
  }

  refan(hand, heldSlots) {
    const n = Math.min(hand.length, MAX);
    this.cards.forEach((c, slot) => {
      if (slot < n && !heldSlots.has(slot)) this.fan(c, slot, n);
    });
  }

  // Show `hand` (table.hand()'s array); cards not held return to the fan.
  // Returns how many faces were repainted (an upload of that slot's texture each), for the frame log.
  set(hand, heldSlots) {
    const n = Math.min(hand.length, MAX);
    let painted = 0;
    this.cards.forEach((c, slot) => {
      const card = hand[slot];
      c.mesh.visible = slot < n;
      if (!card) {
        c.data = null;
        return;
      }
      c.data = card;
      if (this.faces.show(slot, card, drawFace)) painted++;
      if (!heldSlots.has(slot)) this.fan(c, slot, n);
    });
    return painted;
  }

  fan(c, slot, n) {
    const t = n > 1 ? slot / (n - 1) - 0.5 : 0; // -0.5 .. 0.5
    const o = this.origin;
    c.mesh.position.set(o.x + t * 2 * HAND.spread, o.y - Math.abs(t) * 0.02, o.z);
    c.mesh.rotation.set(-Math.PI / 3, 0, -t * 0.5); // tilted toward the player, fanned
  }

  // Face up or down for a held card this frame.
  faceOf(slot) {
    const c = this.cards[slot];
    this.up.set(0, 1, 0).applyQuaternion(c.mesh.getWorldQuaternion(c.mesh.quaternion.clone()));
    return c.flip.update(this.up.y);
  }
}
