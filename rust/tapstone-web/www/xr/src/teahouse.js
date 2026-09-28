// teahouse.js: the Nexus Teahouse (0039), the room around the table. The canon is JP's novel
// *Inner Authority* and its Luna Multiverse bible: this file invents no lore. Every name, plane and
// look comes from logic/lore.js, which cites the bible for each canon fact and marks the rest PROPOSAL.
//
// Full VR ('immersive-vr'): a warm, lantern-lit interior with the board on a low table. Mixed
// reality ('immersive-ar'): the player's own room is the teahouse, and only the doors appear, as
// portals at the edge of view. Either way the doors live OUTSIDE the ±32° the layout keeps for play
// (0039: "nothing essential ever sits in a door"), and they react to play (logic/doors.js, the same
// rules as the Roblox tea house): a door glows when a card of its faction is cast, so a neutral
// card glows the Hearthlands door, and the winner's door opens wide.
import { BoxGeometry, createSystem, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, AmbientLight } from '@iwsdk/core';
import { EffectsSystem } from './effects-player.js';
import { PlaySystem } from './play.js';
import { label, FACTION } from './board.js';
import { DOORS, DOOR_W, doorCenter, PLACE } from './logic/layout.js';
import { doorSigns, doorStep } from './logic/doors.js';
import { DOOR_LORE, TEAHOUSE_NAME } from './logic/lore.js';
import { motion } from './logic/access.js';
import { access } from './access.js';

// The room's floor, board-local: 0.4 m under the table's top (a low table). The doors stand on it.
const FLOOR_Y = -0.4;
const FRAME_H = 1.9;

export class TeahouseSystem extends createSystem({}) {
  init() {
    this.room = new Group();
    this.doors = [];
    this.glow = new Map();
    this.signs = doorSigns();
    this.built = false;
  }

  build(play) {
    const immersiveVR = this.world.renderer.xr.getSession()?.environmentBlendMode === 'opaque';
    play.root.add(this.room);
    if (immersiveVR) {
      // Floor, a low table under the board, four walls and lanterns: baked colour, one warm light,
      // cheap enough for the Quest 2's 90 Hz (the spike held a 90.1 fps median).
      const floor = new Mesh(new PlaneGeometry(8, 8), new MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = FLOOR_Y;
      const table = new Mesh(new BoxGeometry(0.9, 0.38, 0.8), new MeshStandardMaterial({ color: 0x5a3f2a, roughness: 0.8 }));
      table.position.set(0, -0.2 - 0.005, 0.1);
      this.room.add(floor, table);
      for (const [x, z, ry] of [[0, -3, 0], [0, 3, Math.PI], [-3, 0, Math.PI / 2], [3, 0, -Math.PI / 2]]) {
        const wall = new Mesh(new PlaneGeometry(6, 3), new MeshStandardMaterial({ color: 0x4a3526, roughness: 1, side: DoubleSide }));
        wall.position.set(x, 1.1, z);
        wall.rotation.y = ry;
        this.room.add(wall);
      }
      for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
        const lantern = new Mesh(new CylinderGeometry(0.06, 0.06, 0.14, 12), new MeshBasicMaterial({ color: 0xffc070 }));
        lantern.position.set(x, 0.9, z);
        this.room.add(lantern);
      }
      const warm = new PointLight(0xffb060, 1.2, 6);
      warm.position.set(0, 1.2, 0);
      this.room.add(warm, new AmbientLight(0x604030, 0.6));
      const lintel = label(512, 96, 'rgba(40,28,20,0.9)', '#ffd9a0');
      lintel.draw(TEAHOUSE_NAME);
      const sign = new Mesh(new PlaneGeometry(0.8, 0.15), new MeshBasicMaterial({ map: lintel.tex, transparent: true }));
      sign.position.set(0, 1.6, -2.95);
      this.room.add(sign);
    }
    // Doors (both modes): an arch and a glowing portal face per faction plane, at the edge of view.
    // In mixed reality they're anchored beside the table; a later task anchors them to detected walls.
    for (const d of DOORS) {
      const c = doorCenter(d);
      const door = new Group();
      // The door's origin is its foot, on the floor, so it grows upward when it opens wide (the
      // IWER probe caught a centred door 15 cm through the floor, and deeper at 1.15x).
      door.position.set(c.x, FLOOR_Y, c.z);
      door.rotation.y = Math.atan2(-c.x, PLACE.ahead - c.z); // facing the player's seat
      const frame = new Mesh(new BoxGeometry(DOOR_W, FRAME_H, 0.08), new MeshStandardMaterial({ color: DOOR_LORE[d.faction].look.frame }));
      frame.position.y = FRAME_H / 2;
      const portal = new Mesh(new PlaneGeometry(0.72, 1.7), new MeshBasicMaterial({ color: FACTION[d.faction], transparent: true, opacity: 0.35, side: DoubleSide }));
      portal.position.set(0, FRAME_H / 2, 0.05);
      const tag = label(384, 64, 'rgba(20,14,10,0.8)', '#f0e0c0');
      tag.draw(DOOR_LORE[d.faction].name);
      const nameplate = new Mesh(new PlaneGeometry(0.6, 0.1), new MeshBasicMaterial({ map: tag.tex, transparent: true }));
      nameplate.position.set(0, FRAME_H / 2 + 1.05, 0.06);
      door.add(frame, portal, nameplate);
      this.room.add(door);
      this.doors.push({ ...d, door, portal });
      this.glow.set(d.faction, 0);
    }
    // Prime on the view already showing, so an old cast isn't replayed when the room is built.
    if (play.view) doorStep(this.signs, play.view);
    this.world.getSystem(EffectsSystem)?.onView((v) => this.react(v));
    this.built = true;
  }

  // A door reacts to play; it never carries rules or offers a choice (0039).
  react(view) {
    for (const s of doorStep(this.signs, view)) {
      if (this.glow.has(s.faction)) this.glow.set(s.faction, s.kind === 'win' ? 3 : 1);
    }
  }

  update(delta) {
    const play = this.world.getSystem(PlaySystem);
    if (!play) return;
    if (!this.built && this.world.renderer.xr.getSession()) this.build(play);
    for (const d of this.doors) {
      const g = this.glow.get(d.faction);
      d.portal.material.opacity = 0.35 + Math.min(0.55, g * 0.3);
      d.door.scale.y = 1 + Math.min(0.15, g * 0.05) * motion('summon', 0, access).swell; // no swell with reduced motion
      this.glow.set(d.faction, Math.max(0, g - delta * 0.8));
    }
  }
}
