// board.js: the battlefield drawn from the view JSON (spec 2026-09-25 §3.1): 3 lanes x 6 cells,
// the units, my castle plaque and the far keep. It holds no rules; applyView draws what the engine
// said. 0027 in 3D: the person's own units are objects (tall, lit, stats on a plate); the other
// seat's are entries (low stone plinths with one tag). Positions come from logic/layout.js, the same
// numbers the FoV test checks.
import { BoxGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { BOARD, CASTLE_PLAQUE, FAR_KEEP, LANE_W, ROW_D, cellCenter } from './logic/layout.js';

export const FACTION = { ember: 0xe0663a, tide: 0x3a9be0, neutral: 0x7d8793 };

// A small canvas label, redrawn in place.
export function label(w = 256, h = 96, bg = 'rgba(16,20,26,0.85)', fg = '#f0ece2') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new CanvasTexture(c);
  const draw = (text) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    const lines = String(text).split('\n');
    const size = Math.floor(h / (lines.length + 0.5));
    g.font = `600 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, w / 2, size * (i + 1), w - 8));
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

export class Board {
  constructor() {
    this.group = new Group();
    const base = new Mesh(new PlaneGeometry(BOARD.w, BOARD.d), new MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.9 }));
    base.rotation.x = -Math.PI / 2;
    this.group.add(base);
    const cellGeo = new PlaneGeometry(LANE_W * 0.92, ROW_D * 0.88);
    for (let lane = 0; lane < 3; lane++) {
      for (let row = 0; row < 6; row++) {
        const m = new Mesh(cellGeo, new MeshBasicMaterial({ color: row < 3 ? 0x444a5c : 0x3c4252 }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(-BOARD.w / 2 + LANE_W * (lane + 0.5), 0.001, -BOARD.d / 2 + ROW_D * (row + 0.5));
        this.group.add(m);
      }
    }
    // One figure and one plinth per (seat, lane, cell), shown per view: pooled, so a view never allocates.
    this.slots = new Map();
    const figureGeo = new BoxGeometry(LANE_W * 0.45, 1, ROW_D * 0.55);
    const plinthGeo = new BoxGeometry(LANE_W * 0.55, 0.012, ROW_D * 0.6);
    for (let seat = 0; seat < 2; seat++) {
      for (let lane = 0; lane < 3; lane++) {
        for (let cell = 0; cell < 3; cell++) {
          const figure = new Mesh(figureGeo, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
          const plinth = new Mesh(plinthGeo, new MeshStandardMaterial({ color: 0x6d7480, roughness: 1 }));
          const tag = label(192, 64);
          const plate = new Mesh(new PlaneGeometry(LANE_W * 0.7, 0.022), new MeshBasicMaterial({ map: tag.tex, transparent: true, side: DoubleSide }));
          figure.visible = plinth.visible = plate.visible = false;
          this.group.add(figure, plinth, plate);
          this.slots.set(`${seat}:${lane}:${cell}`, { figure, plinth, plate, tag, seat, lane, cell });
        }
      }
    }
    this.myPlaque = new Mesh(new BoxGeometry(CASTLE_PLAQUE.w, CASTLE_PLAQUE.h, CASTLE_PLAQUE.d), new MeshStandardMaterial({ color: 0x7d8793 }));
    this.myPlaque.position.set(0, CASTLE_PLAQUE.h / 2, CASTLE_PLAQUE.z);
    this.farKeep = new Mesh(new BoxGeometry(FAR_KEEP.w, FAR_KEEP.h, FAR_KEEP.d), new MeshStandardMaterial({ color: 0x7d8793 }));
    this.farKeep.position.set(0, FAR_KEEP.h / 2, FAR_KEEP.z);
    this.group.add(this.myPlaque, this.farKeep);
    this.lifeTags = [label(256, 64), label(256, 64)];
    this.lifeMeshes = this.lifeTags.map((t) => new Mesh(new PlaneGeometry(0.16, 0.04), new MeshBasicMaterial({ map: t.tex, transparent: true, side: DoubleSide })));
    this.lifeMeshes[0].position.set(0, 0.035, CASTLE_PLAQUE.z + 0.02);
    this.lifeMeshes[0].rotation.x = -Math.PI / 4;
    this.lifeMeshes[1].position.set(0, FAR_KEEP.h + 0.03, FAR_KEEP.z);
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
    this.myPlaque.material.color.setHex(FACTION[mine.faction] ?? FACTION.neutral);
    this.farKeep.material.color.setHex(FACTION[theirs.faction] ?? FACTION.neutral);
    this.lifeTags[0].draw(`♥ ${mine.life}  mana ${mine.charged - mine.spent}/${mine.charged}`);
    this.lifeTags[1].draw(`♥ ${theirs.life}`);
  }
}
