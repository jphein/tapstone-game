// altar.js: the virtual shrine as a low stone with three lane pads on top (spec 2026-09-25 §3.1),
// its eye and voice line on the front face, the deck at its right end, the castle card at its left,
// and the prompt (a spell's targets) over its middle. Pads take a fingertip poke AND a ray pinch
// (spike-day1.md: IWSDK makes poke a separate opt-in, PokeInteractable; one Pressed handler serves
// both). Cards take OneHandGrabbable, so a card follows the hand that pinched it.
import {
  BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OneHandGrabbable,
  PlaneGeometry, PokeInteractable, RayInteractable, SphereGeometry,
} from '@iwsdk/core';
import { ALTAR, CARD, DECK, PAD, PROMPT } from './logic/layout.js';
import { CastleCard, DeckTop, Pad, PromptTile } from './tags.js';
import { label } from './board.js';
import { sides } from './logic/access.js';

export class Altar {
  constructor(world, parentEntity, parentGroup) {
    this.group = new Group();
    parentGroup.add(this.group);
    this.entity = world.createTransformEntity(this.group, parentEntity);
    const stone = new Mesh(new BoxGeometry(ALTAR.w, ALTAR.h, ALTAR.d), new MeshStandardMaterial({ color: 0x5b5f66, roughness: 1 }));
    stone.position.set(0, ALTAR.h / 2, ALTAR.z);
    this.group.add(stone);
    // Pads: sized for a fingertip (12 x 8 cm), lying on the stone.
    this.pads = [0, 1, 2].map((lane) => {
      const m = new Mesh(new PlaneGeometry(PAD.w, PAD.d), new MeshStandardMaterial({ color: 0x2b3440, emissive: 0x000000 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(PAD.x[lane], ALTAR.h + 0.001, ALTAR.z);
      const e = world.createTransformEntity(m, this.entity);
      e.addComponent(PokeInteractable);
      e.addComponent(RayInteractable);
      e.addComponent(Pad, { lane });
      return { m, e, lane };
    });
    // The eye: amber at rest, a red pulse on a refusal.
    this.eye = new Mesh(new SphereGeometry(0.008, 16, 12), new MeshBasicMaterial({ color: 0xe0a526 }));
    this.eye.position.set(0, ALTAR.h / 2, ALTAR.z + ALTAR.d / 2 + 0.002);
    this.group.add(this.eye);
    this.redUntil = 0;
    // The voice line on the front face: one sentence, newest wins (0032).
    this.voice = label(768, 64, 'rgba(16,20,26,0.9)');
    this.speaker = null; // set once the clips are loaded (voice.js); until then the band is text only
    const v = new Mesh(new PlaneGeometry(ALTAR.w * 0.9, 0.022), new MeshBasicMaterial({ map: this.voice.tex, transparent: true, side: DoubleSide }));
    v.position.set(0, -0.014, ALTAR.z + ALTAR.d / 2 + 0.003);
    this.group.add(v);
    // The deck: a short stack, its top card grabbable.
    const stack = (this.stack = new Mesh(new BoxGeometry(CARD.w, 0.02, CARD.d), new MeshStandardMaterial({ color: 0x3a2f28 })));
    stack.position.set(DECK.x, 0.01, DECK.z);
    this.group.add(stack);
    this.deckTop = cardMesh(0x5a4636);
    this.deckTop.position.set(DECK.x, 0.021, DECK.z);
    this.deckEntity = world.createTransformEntity(this.deckTop, this.entity);
    this.deckEntity.addComponent(OneHandGrabbable, {});
    this.deckEntity.addComponent(RayInteractable);
    this.deckEntity.addComponent(DeckTop);
    // The castle card, at the altar's left end.
    this.castle = cardMesh(0x7d8793);
    this.castle.position.set(-DECK.x, 0.002, DECK.z);
    this.castleEntity = world.createTransformEntity(this.castle, this.entity);
    this.castleEntity.addComponent(OneHandGrabbable, {});
    this.castleEntity.addComponent(RayInteractable);
    this.castleEntity.addComponent(CastleCard);
    // The prompt: up to three target tiles over the altar's middle, hidden until needed.
    this.prompt = [0, 1, 2].map((option) => {
      const lab = label(384, 96);
      const m = new Mesh(new PlaneGeometry(PROMPT.w / 3 - 0.006, PROMPT.h), new MeshBasicMaterial({ map: lab.tex, transparent: true, side: DoubleSide }));
      m.position.set(-PROMPT.w / 3 + option * (PROMPT.w / 3), PROMPT.y, PROMPT.z);
      m.rotation.x = -Math.PI / 6;
      const e = world.createTransformEntity(m, this.entity);
      e.addComponent(PokeInteractable);
      e.addComponent(RayInteractable);
      e.addComponent(PromptTile, { option });
      m.visible = false;
      return { m, e, lab };
    });
  }

  // The deck and the castle card at the ends a left- or right-handed person reaches with (access.js).
  applySides(access) {
    const s = sides(access);
    this.stack.position.set(s.deck.x, 0.01, s.deck.z);
    this.deckTop.position.set(s.deck.x, 0.021, s.deck.z);
    this.castle.position.set(s.castle.x, 0.002, s.castle.z);
  }

  say(text, opts) {
    if (text !== this.line) this.frames?.tag('say'); // a redrawn band is a canvas upload
    this.line = text;
    this.voice.draw(text);
    this.speaker?.say(text, opts);
  }

  // The clips arrive after the first line is drawn (the place beat speaks at page load), so the
  // line already on the band is spoken once they do; otherwise the tutorial's first sentence is mute.
  attach(speaker) {
    this.speaker = speaker;
    if (this.line) speaker.say(this.line);
  }

  refuse(text, now) {
    this.say(text, { force: true });
    this.redUntil = now + 600;
  }

  showPrompt(options) {
    this.prompt.forEach((t, k) => {
      const o = options[k];
      t.m.visible = !!o;
      if (o) t.lab.draw(o.label.replace(/^Cast /, ''));
    });
  }

  hidePrompt() {
    this.showPrompt([]);
  }

  // Put a card back where it rests (after a refusal, or after it was played).
  rest(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
  }

  update(now) {
    this.eye.material.color.setHex(now < this.redUntil ? 0xd9534f : 0xe0a526);
  }
}

// A card-sized thin box lying flat, face up (+y).
export function cardMesh(colour) {
  const m = new Mesh(new BoxGeometry(CARD.w, 0.002, CARD.d), new MeshStandardMaterial({ color: colour }));
  return m;
}
