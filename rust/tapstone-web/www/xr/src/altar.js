// altar.js: the virtual shrine as a low stone with three lane pads on top (spec 2026-09-25 §3.1),
// its eye and voice line on the front face, the deck at its right end, the castle card at its left,
// and the prompt (a spell's targets) over its middle. Pads take a fingertip poke AND a ray pinch
// (spike-day1.md: IWSDK makes poke a separate opt-in, PokeInteractable; one Pressed handler serves
// both). Cards take OneHandGrabbable, so a card follows the hand that pinched it.
//
// The look is the world art's (src/art/stone.js: carved stone, a brass lip, wooden lane pads with a
// crystal and a dot numeral, a crystal eye; src/art/card-mesh.js: holographic cards with a real back).
import { DoubleSide, Group, Mesh, MeshBasicMaterial, OneHandGrabbable, PlaneGeometry, PokeInteractable, RayInteractable } from '@iwsdk/core';
import { ALTAR, DECK, PAD, PROMPT } from './logic/layout.js';
import { CastleCard, DeckTop, Pad, PromptTile } from './tags.js';
import { label } from './board.js';
import { sides } from './logic/access.js';
import { buildStone, padUvs } from './art/stone.js';
import { artTime, card3d, stack3d } from './art/card-mesh.js';
import { blankFace, drawFace } from './art/card-face.js';
import { cardArt } from './card-art.js';
import { LABELS } from './art/labels.js';
import { ART } from './art/palette.js';
import { isContrast } from './art/contrast.js';
import { THEMES } from './logic/theme.js';

// The castle card's face per faction: set 1's castles (st1-000 Ember Castle, st1-001 Tide Castle).
const CASTLES = { ember: { card: 0, name: 'Ember Castle' }, tide: { card: 1, name: 'Tide Castle' } };

export class Altar {
  constructor(world, parentEntity, parentGroup) {
    this.group = new Group();
    parentGroup.add(this.group);
    this.entity = world.createTransformEntity(this.group, parentEntity);
    const art = buildStone();
    this.group.add(art.stone, art.lip, art.eye);
    // Pads: sized for a fingertip (8 x 7 cm), lying on the stone; one atlas, one material for all three.
    this.pads = [0, 1, 2].map((lane) => {
      const m = new Mesh(padUvs(new PlaneGeometry(PAD.w, PAD.d), lane), art.padMaterial);
      m.rotation.x = -Math.PI / 2;
      m.position.set(PAD.x[lane], ALTAR.h + 0.001, ALTAR.z);
      const e = world.createTransformEntity(m, this.entity);
      e.addComponent(PokeInteractable);
      e.addComponent(RayInteractable);
      e.addComponent(Pad, { lane });
      return { m, e, lane };
    });
    // The eye: a crystal on the lip's gap, amber at rest, a red pulse on a refusal.
    this.eye = art.eye;
    this.redUntil = 0;
    // The voice line: one sentence, newest wins (0032), on a strip slanted along the stone's front
    // toward the seated head, up to two lines and never under the legibility floor (src/art/labels.js).
    this.voice = label('voice', undefined, 'rgba(24,18,14,0.94)', '#f6e7c4');
    this.speaker = null; // set once the clips are loaded (voice.js); until then the band is text only
    const vs = LABELS.voice;
    const v = new Mesh(new PlaneGeometry(...vs.plate), new MeshBasicMaterial({ map: this.voice.tex, transparent: true, side: DoubleSide }));
    v.position.set(vs.at.x, vs.at.y, vs.at.z);
    v.rotation.x = -Math.PI / 4;
    this.group.add(v);
    // The deck: a stack of backs, its top card grabbable.
    const stack = (this.stack = stack3d(0.02));
    stack.position.set(DECK.x, 0.01, DECK.z);
    this.group.add(stack);
    this.deckTop = card3d(null);
    this.deckTop.position.set(DECK.x, 0.021, DECK.z);
    this.deckEntity = world.createTransformEntity(this.deckTop, this.entity);
    this.deckEntity.addComponent(OneHandGrabbable, {});
    this.deckEntity.addComponent(RayInteractable);
    this.deckEntity.addComponent(DeckTop);
    // The castle card, at the altar's left end.
    this.castleFace = blankFace();
    this.setCastle('ember');
    this.castle = card3d(this.castleFace.texture);
    this.castle.position.set(-DECK.x, 0.002, DECK.z);
    this.castleEntity = world.createTransformEntity(this.castle, this.entity);
    this.castleEntity.addComponent(OneHandGrabbable, {});
    this.castleEntity.addComponent(RayInteractable);
    this.castleEntity.addComponent(CastleCard);
    // The prompt: up to three target tiles over the altar's middle, hidden until needed.
    this.prompt = [0, 1, 2].map((option) => {
      const lab = label('prompt', undefined, 'rgba(38,44,70,0.94)', '#f6e7c4');
      const m = new Mesh(new PlaneGeometry(...LABELS.prompt.plate), new MeshBasicMaterial({ map: lab.tex, transparent: true, side: DoubleSide }));
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
    this.homes = { deck: [s.deck.x, 0.021, s.deck.z], castle: [s.castle.x, 0.002, s.castle.z] };
    this.home('deck');
    this.home('castle');
  }

  // The deck's top card or the castle card back where it lives, once a hand lets go of it. Left where it
  // was dropped (on a pad, say), the next pinch would pick it up already touching that pad.
  home(which) {
    const o = which === 'deck' ? this.deckTop : this.castle, [x, y, z] = this.homes[which];
    o.position.set(x, y, z);
    o.rotation.set(0, 0, 0);
  }

  // The castle card shows my seat's castle (board.js reports the seat's faction on each view).
  // Painted again once the painting has loaded (the altar is built before the art preload ends).
  setCastle(faction) {
    const c = CASTLES[faction];
    if (!c || (this.castleKind === faction && this.castleArt)) return;
    this.castleKind = faction;
    this.castleArt = !!cardArt(c.card);
    drawFace(this.castleFace.canvas, { ...c, faction, kind: 'castle' });
    this.castleFace.texture.needsUpdate = true;
  }

  // Returns true when a clip started (voice.js), so the guide's line queue waits for its end.
  say(text, opts) {
    if (text !== this.line) this.frames?.tag('say'); // a redrawn band is a canvas upload
    this.line = text;
    this.voice.draw(text, { refuse: !!opts?.refuse }); // a refusal in label.refuse (plates.js)
    return this.speaker?.say(text, opts) ?? false;
  }

  // The clips arrive after the first line is drawn (the place beat speaks at page load), so the
  // line already on the band is spoken once they do; otherwise the tutorial's first sentence is mute.
  attach(speaker) {
    this.speaker = speaker;
    if (this.line) speaker.say(this.line);
  }

  refuse(text, now) {
    this.say(text, { force: true, refuse: true });
    this.flash(now);
  }

  // The eye's red pulse, on its own: the refusal's words go through the guide's queue (play.js).
  flash(now) {
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
    // The eye: amber, red on a refusal; in high contrast the theme's own two (altar.eye, altar.eyeRefuse).
    const red = now < this.redUntil, T = THEMES.contrast, hc = isContrast();
    const glow = hc ? T[red ? 'altar.eyeRefuse' : 'altar.eye'] : red ? ART.eyeRefuse : ART.eye;
    this.eye.material.emissive.setHex(glow);
    this.eye.material.color.setHex(hc ? glow : red ? 0xff8070 : 0xffd080);
    artTime.value = now / 1000; // every card's holographic sheen and breathing art (card-mesh.js)
  }
}

// A card lying flat, showing its back (the world art's holographic card, src/art/card-mesh.js).
export const cardMesh = () => card3d(null);
