// hand.js: the person's cards, fanned low in front of them (spec 2026-09-25 §3.1), drawn from
// table.hand() (the page's own shrine knows its hand; the view carries only a count). Each card is
// OneHandGrabbable, so a pinch picks it up and it follows the hand; RayInteractable, so the
// eyes-and-hands path can select it from afar. The face is read from the card's own orientation:
// its local +y dotted with world up (1 = face up), through FlipDetector's hysteresis.
import { CanvasTexture, Mesh, MeshStandardMaterial, OneHandGrabbable, RayInteractable, SRGBColorSpace, Vector3, BoxGeometry } from '@iwsdk/core';
import { CARD, HAND } from './logic/layout.js';
import { FACE } from './logic/card-art.js';
import { cardArt } from './card-art.js';
import { FlipDetector } from './logic/gestures.js';
import { FaceSlots } from './logic/face-slots.js';
import { HandCard } from './tags.js';
import { FACTION } from './board.js';

const MAX = 10;

// One canvas and texture per slot (logic/face-slots.js), repainted in place.
function blankFace() {
  const canvas = document.createElement('canvas');
  canvas.width = FACE.w;
  canvas.height = FACE.h;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // the painting is sRGB; without this it renders washed out
  return { canvas, texture };
}

function drawFace(c, card) {
  const g = c.getContext('2d');
  const a = FACE.art;
  g.fillStyle = '#efe6cf';
  g.fillRect(0, 0, FACE.w, FACE.h);
  g.fillStyle = `#${(FACTION[card.faction] ?? FACTION.neutral).toString(16).padStart(6, '0')}`;
  g.fillRect(a.x, a.y, a.w, a.h);
  const art = cardArt(card.card); // the painting (0014), fetched during load; else the faction colour
  if (art) g.drawImage(art, a.x, a.y, a.w, a.h);
  g.fillStyle = '#2a2622';
  g.font = '600 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(card.name, 108, FACE.nameY, 196);
  g.font = '500 22px system-ui, sans-serif';
  g.fillText(`cost ${card.cost}`, 108, 240);
  if (card.kind === 'unit') g.fillText(`${card.attack} / ${card.toughness}${card.keyword ? `  ${card.keyword}` : ''}`, 108, 280);
  else if (card.effect) g.fillText(card.effect, 108, 280, 196);
}

export class Hand {
  constructor(world, parentEntity, parentGroup) {
    this.cards = [];
    this.faces = new FaceSlots(MAX, blankFace);
    for (let slot = 0; slot < MAX; slot++) {
      // The map is set once, here, so the prewarm compile (index.js) builds the program a face uses.
      const mesh = new Mesh(new BoxGeometry(CARD.w, 0.002, CARD.d), new MeshStandardMaterial({ color: 0xffffff, map: this.faces.texture(slot) }));
      mesh.visible = false;
      parentGroup.add(mesh);
      const e = world.createTransformEntity(mesh, parentEntity);
      e.addComponent(OneHandGrabbable, {});
      e.addComponent(RayInteractable);
      e.addComponent(HandCard, { slot });
      this.cards.push({ mesh, e, flip: new FlipDetector(), data: null });
    }
    this.up = new Vector3();
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
    c.mesh.position.set(t * 2 * HAND.spread, HAND.y - Math.abs(t) * 0.02, HAND.z);
    c.mesh.rotation.set(-Math.PI / 3, 0, -t * 0.5); // tilted toward the player, fanned
  }

  // Face up or down for a held card this frame.
  faceOf(slot) {
    const c = this.cards[slot];
    this.up.set(0, 1, 0).applyQuaternion(c.mesh.getWorldQuaternion(c.mesh.quaternion.clone()));
    return c.flip.update(this.up.y);
  }
}
