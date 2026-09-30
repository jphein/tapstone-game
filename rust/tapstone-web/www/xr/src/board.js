// board.js: the battlefield drawn from the view JSON (spec 2026-09-25 §3.1): 3 lanes x 6 cells,
// the units, my castle plaque and the far keep. It holds no rules; applyView draws what the engine
// said. 0027 in 3D: the person's own units are objects (tall, lit, stats on a plate); the other
// seat's are entries (low stone plinths with one tag). Positions come from logic/layout.js, the same
// numbers the FoV test checks.
//
// The look is the world art's (src/art/board-mat.js): one painted mat for the Dueling Grounds, a
// stone slab and brass rim under it, a stone keep, and life and mana on engraved plates.
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { CASTLE_PLAQUE, FAR_KEEP, LANE_W, ROW_D, cellCenter } from './logic/layout.js';
import { canvasTexture, label } from './art/plates.js';
import { onArtTheme, ready } from './art/contrast.js';
import { LABELS, minPxOf } from './art/labels.js';
import { buildKeep, buildMat, buildPlaque, paintLife } from './art/board-mat.js';
import { factionOf } from './art/palette.js';

export const FACTION = { ember: 0xe0663a, tide: 0x3a9be0, neutral: 0x7d8793 };

// A small canvas label, redrawn in place: the world art's engraved plate (src/art/plates.js).
export { label };

export class Board {
  constructor() {
    this.group = new Group();
    // The Dueling Grounds: one painted mat (its cells, lanes and numerals) on a slab with a brass rim.
    this.group.add(...buildMat());
    // One figure and one plinth per (seat, lane, cell), shown per view: pooled, so a view never allocates.
    this.slots = new Map();
    const figureGeo = new BoxGeometry(LANE_W * 0.45, 1, ROW_D * 0.55);
    const plinthGeo = new BoxGeometry(LANE_W * 0.55, 0.012, ROW_D * 0.6);
    for (let seat = 0; seat < 2; seat++) {
      for (let lane = 0; lane < 3; lane++) {
        for (let cell = 0; cell < 3; cell++) {
          const figure = new Mesh(figureGeo, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
          const plinth = new Mesh(plinthGeo, new MeshStandardMaterial({ color: 0x6d7480, roughness: 1 }));
          const tag = label('unitTag');
          const plate = new Mesh(new PlaneGeometry(...LABELS.unitTag.plate), new MeshBasicMaterial({ map: tag.tex, transparent: true, side: DoubleSide }));
          figure.visible = plinth.visible = plate.visible = false;
          this.group.add(figure, plinth, plate);
          this.slots.set(`${seat}:${lane}:${cell}`, { figure, plinth, plate, tag, seat, lane, cell });
        }
      }
    }
    this.myPlaque = buildPlaque(CASTLE_PLAQUE.w, CASTLE_PLAQUE.d, CASTLE_PLAQUE.h);
    this.myPlaque.position.set(0, 0, CASTLE_PLAQUE.z);
    this.farKeep = buildKeep();
    this.farKeep.position.set(0, 0, FAR_KEEP.z);
    this.group.add(this.myPlaque, this.farKeep);
    // Life and mana: a heart crest and mana crystals on engraved plates (board-mat.js paintLife).
    this.lifeTags = ['lifeMine', 'lifeTheirs'].map((name) => {
      const { c, tex } = canvasTexture(...LABELS[name].canvas);
      let key = null, last = null;
      const draw = (v) => {
        const k = JSON.stringify(v);
        if (k === key) return;
        key = k;
        last = v;
        paintLife(c, v, minPxOf(name));
        tex.needsUpdate = true;
      };
      onArtTheme(() => last && ((key = null), draw(last))); // the high-contrast plate (board-mat.js)
      return { tex: ready(tex), draw };
    });
    this.lifeMeshes = ['lifeMine', 'lifeTheirs'].map((name, k) => new Mesh(new PlaneGeometry(...LABELS[name].plate), new MeshBasicMaterial({ map: this.lifeTags[k].tex, transparent: true, side: DoubleSide })));
    this.lifeMeshes[0].position.set(0, 0.035, CASTLE_PLAQUE.z + 0.02);
    this.lifeMeshes[0].rotation.x = -Math.PI / 4;
    this.lifeMeshes[1].position.set(0, LABELS.lifeTheirs.at.y, FAR_KEEP.z);
    this.group.add(...this.lifeMeshes);
  }

  // The world position of a cell's centre (for effects).
  cellWorld(seat, lane, cell, near, out) {
    const p = cellCenter(seat, lane, cell, near);
    return this.group.localToWorld(out.set(p.x, p.y, p.z));
  }

  // Draw a view (the board to show: view, or last_over after a result) for the person in `near`.
  applyView(v, near) {
    const b = v.phase === 'lobby' && !v.lobby.length && v.last_over ? v.last_over : v;
    for (const s of this.slots.values()) s.figure.visible = s.plinth.visible = s.plate.visible = false;
    if (!b.seats || !b.seats.length) return;
    for (const s of this.slots.values()) {
      const u = b.seats[s.seat].cells[s.lane][s.cell];
      if (!u) continue;
      const p = cellCenter(s.seat, s.lane, s.cell, near);
      const hp = u.toughness - u.damage;
      const colour = FACTION[u.faction] ?? FACTION.neutral;
      if (s.seat === near) {
        // mine: an object, its height the unit's remaining health, a commander taller
        const h = 0.03 + 0.006 * Math.min(hp, 8) + (u.commander ? 0.02 : 0);
        s.figure.scale.set(1, h, 1);
        s.figure.position.set(p.x, h / 2, p.z);
        s.figure.material.color.setHex(colour);
        s.figure.material.emissive?.setHex(u.commander ? 0x332200 : 0x000000);
        s.figure.visible = true;
        s.tag.draw(`${u.commander ? '♛ ' : ''}${u.attack} / ${hp}${u.keyword ? ` ${u.keyword}` : ''}`);
        s.plate.position.set(p.x, h + 0.018, p.z + ROW_D * 0.3);
      } else {
        // theirs: an entry, a low plinth in their colour and one small tag
        s.plinth.position.set(p.x, 0.006, p.z);
        s.plinth.material.color.setHex(colour);
        s.plinth.visible = true;
        s.tag.draw(`${u.commander ? '♛' : ''}${u.attack}/${hp}${u.keyword ? ` ${u.keyword.slice(0, 2)}` : ''}`);
        s.plate.position.set(p.x, 0.03, p.z);
      }
      s.plate.visible = true;
    }
    const mine = b.seats[near], theirs = b.seats[1 - near];
    this.myPlaque.material.color.setHex(factionOf(mine.faction).mid);
    this.farKeep.material.color.setHex(factionOf(theirs.faction).light);
    this.lifeTags[0].draw({ life: mine.life, charged: mine.charged, spent: mine.spent });
    this.lifeTags[1].draw({ life: theirs.life });
    this.onFaction?.(mine.faction); // the altar's castle card shows my castle (play.js wires it)
  }
}
