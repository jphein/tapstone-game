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
//
// The page offers both (entry.js, logic/entry.js), so the room is decided per session, not once: the
// interior is built at init, hidden, and shown only while a session is opaque (a person may try mixed
// reality first, then full VR). Its two lights change every lit material's program, so prewarm()
// compiles the scene with the interior shown and hidden: either way in, no shader compiles at entry.
//
// The look is the world art's (src/art/doors.js: torii on stepped stone, each portal a window into
// its plane; src/art/interior.js: the lantern-lit room, merged, its light baked). The red door
// (0039: the Dueling Grounds lie behind it) stands behind the board: in mixed reality 2.3 m out,
// in full VR in the far wall under the Tea House's lintel.
import { createSystem, Fog, Group, Mesh, MeshBasicMaterial, PlaneGeometry, AmbientLight, Vector3 } from '@iwsdk/core';
import { EffectsSystem } from './effects-player.js';
import { PlaySystem } from './play.js';
import { label } from './board.js';
import { DOORS, doorCenter, PLACE } from './logic/layout.js';
import { doorLook, frameGeometry, portalMesh, shadowsMesh } from './art/doors.js';
import { flatWhenContrast } from './art/contrast.js';
import { buildGlows, buildRoomMesh, LANTERNS } from './art/interior.js';
import { airUniforms, doorAir, floorLight, rays, tableMotes, tablePool } from './art/air.js';
import { createAmbience } from './art/ambience.js';
import { sparkleQuiet } from './art/card-mesh.js';
import { DOOR_AIR, FULL, MOOD, airPlan, flicker, hueDrift, total } from './logic/atmosphere.js';
import { FLOOR_Y as ART_FLOOR_Y, LABELS } from './art/labels.js';
import { doorSigns, doorStep } from './logic/doors.js';
import { DOOR_LORE, DUELING_GROUNDS, TEAHOUSE_NAME } from './logic/lore.js';
import { motion } from './logic/access.js';
import { roomFor } from './logic/entry.js';
import { access, onAccess } from './access.js';

// The room's floor, board-local: 0.4 m under the table's top (a low table). The doors stand on it.
const FLOOR_Y = ART_FLOOR_Y;
// The red door, board-local, per room: its foot's distance ahead of the seated head.
export const RED_DOOR = { mr: 2.3, vr: 2.95 + PLACE.ahead - 0.08 };
const cam = new Vector3(), fwd = new Vector3(), up = new Vector3(), at = new Vector3();
// The doors' order in the air's matrices (art/air.js uDoor): the three realm doors, then the red door.
const AIR_ORDER = [...DOORS.map((d) => d.faction), 'grounds'];
// Where the chimes hang and which lantern crackles, room-local (full VR).
const CHIMES_AT = [-2.2, 1.75, -2.35];
// Full VR's air: a warm lantern haze, thicker toward the walls (PROPOSAL). Mixed reality has none:
// the player's room is seen as it is. The portals and the cards are shader materials and ignore it,
// so the doors stay clear windows and nothing a person reads is fogged.
const HAZE = new Fog(MOOD.fog.color, MOOD.fog.near, MOOD.fog.far); // dusk: blue-violet (logic/atmosphere.js)

export class TeahouseSystem extends createSystem({}) {
  init() {
    this.room = new Group();
    this.room.name = 'teahouse.room';
    this.doors = [];
    this.glow = new Map();
    this.signs = doorSigns();
    this.built = false;
    // The atmosphere (design note 2026-09-29-xr-atmosphere-design.md): the doors' air and floor light,
    // made now so prewarm() compiles them, shown once the doors are built; the sound bed per session.
    this.airU = airUniforms();
    this.air = new Group();
    this.air.add(
      (this.doorAir = doorAir(AIR_ORDER.map((f) => ({ air: DOOR_AIR[f] })), this.airU)),
      (this.floorLight = floorLight(AIR_ORDER.map((f, index) => ({ light: f === 'grounds' ? 'grounds' : f, index })), this.airU)),
    );
    this.motes = tableMotes(FULL.table.motes, this.airU); // mixed reality's motes round the table
    this.room.add(this.motes);
    this.air.visible = false;
    this.room.add(this.air);
    this.interior = this.buildInterior();
    this.interior.visible = false;
    this.ambience = createAmbience();
    onAccess((a, key) => key === 'ambience' && this.ambience.volume(a.ambience));
    this.world.getSystem(PlaySystem)?.root.add(this.room); // there from the start, for prewarm()
    this.session = null;
    this.kind = null; // roomFor(the current session): 'interior' | 'doors' | null
    this.sessions = [];
  }

  // The current session's room: the interior shown only in full VR.
  enter(kind) {
    this.kind = kind;
    this.interior.visible = kind === 'interior';
    this.world.scene.fog = kind === 'interior' ? HAZE : null;
    this.motes.visible = kind !== 'interior'; // the room's own dust covers full VR
    if (this.red) this.red.door.position.z = PLACE.ahead - (kind === 'interior' ? RED_DOOR.vr : RED_DOOR.mr);
    this.sessions.push(kind);
    // The bed: started inside the session (a gesture opened it); a pinch resumes a held context.
    this.ambience.start(kind === 'interior' ? 'vr' : 'mr', access.ambience);
    const s = this.world.renderer.xr.getSession();
    s?.addEventListener('selectstart', () => this.ambience.resume());
    s?.addEventListener('end', () => this.ambience.stop());
  }

  // index.js's prewarm: compile() walks only visible objects and the lights they see, so run it with
  // the interior shown (and its haze on), then hidden, and three caches the programs for both rooms.
  prewarm(compile) {
    this.interior.visible = this.air.visible = true;
    this.world.scene.fog = HAZE; // the haze changes every fogged program too: compile both ways
    compile();
    this.world.scene.fog = null;
    this.interior.visible = this.air.visible = false;
    compile();
  }

  buildInterior() {
    const room = new Group();
    room.name = 'teahouse.interior'; // scenery: the contrast audit (tools/iwer-art.mjs) leaves it out
    this.room.add(room);
    // The room (one mesh, its lantern light baked) and its glows (one point cloud). The warm ambient
    // is the lantern light on the lit things at the table (the stone, the board's slab, the units):
    // the only real-time light, and no shadows.
    this.glows = buildGlows();
    this.roomMesh = buildRoomMesh();
    // Moonlight through the side walls' upper shoji, falling toward the middle (PROPOSAL).
    const shafts = [];
    for (const sx of [-1, 1]) for (const z of [-2.1, -0.75, 1.3]) shafts.push({ from: [sx * 2.93, 1.3, z], to: [sx * 0.95, FLOOR_Y + 0.02, z + 0.35], w: 0.55 });
    this.rays = rays(shafts, this.airU);
    this.pool = tablePool(); // the board's own pool of lamplight
    room.add(this.roomMesh, this.glows, this.rays, this.pool, new AmbientLight(0xffb070, 0.35));
    const lintel = label('lintel', undefined, 'rgba(26,16,12,0.94)', 'gold', { font: 'display' });
    lintel.draw(TEAHOUSE_NAME);
    const l = LABELS.lintel;
    const sign = new Mesh(new PlaneGeometry(...l.plate), new MeshBasicMaterial({ map: lintel.tex, transparent: true }));
    sign.position.set(l.at.x, l.at.y, l.at.z);
    room.add(sign);
    return room;
  }

  // One door: the merged frame, the portal, the name on the plaque. Its origin is its foot.
  door(faction, name, frame) {
    const look = doorLook(faction, frame);
    const door = new Group();
    const fr = new Mesh(frameGeometry(look.wood), new MeshBasicMaterial({ vertexColors: true }));
    flatWhenContrast(fr, 'door.frame', (c) => new MeshBasicMaterial({ color: c })); // white torii in high contrast
    const portal = portalMesh(look.kind, look.rim, look.role);
    const tag = label('doorName', undefined, 'rgba(18,12,10,0.96)', 'gold', { font: 'display' });
    tag.draw(name);
    const plate = new Mesh(new PlaneGeometry(...LABELS.doorName.plate), new MeshBasicMaterial({ map: tag.tex, transparent: true }));
    plate.position.set(0, 1.67, 0.001);
    door.add(fr, portal, plate);
    return { door, portal };
  }

  build(play) {
    play.root.add(this.room);
    // Doors (both modes): an arch and a glowing portal face per faction plane, at the edge of view.
    // In mixed reality they're anchored beside the table; a later task anchors them to detected walls.
    const feet = [];
    for (const d of DOORS) {
      const c = doorCenter(d);
      // The door's origin is its foot, on the floor, so it grows upward when it opens wide (the
      // IWER probe caught a centred door 15 cm through the floor, and deeper at 1.15x).
      const { door, portal } = this.door(d.faction, DOOR_LORE[d.faction].name, DOOR_LORE[d.faction].look.frame);
      door.position.set(c.x, FLOOR_Y, c.z);
      door.rotation.y = Math.atan2(-c.x, PLACE.ahead - c.z); // facing the player's seat
      feet.push({ x: c.x, z: c.z, ry: door.rotation.y });
      this.room.add(door);
      this.doors.push({ ...d, door, portal });
      this.glow.set(d.faction, 0);
    }
    // The red door, behind the board: the Dueling Grounds (0039). It stirs with no faction; it breathes.
    this.red = this.door('grounds', DUELING_GROUNDS, null);
    this.red.door.position.set(0, FLOOR_Y, PLACE.ahead - (this.kind === 'interior' ? RED_DOOR.vr : RED_DOOR.mr));
    this.red.door.add(shadowsMesh([{ x: 0, z: 0, ry: 0 }], 0.002)); // its own shadow: it moves per room
    this.room.add(this.red.door);
    this.shadows = shadowsMesh(feet, FLOOR_Y + 0.002);
    this.room.add(this.shadows);
    this.airDoors = [...this.doors.map((d) => d.door), this.red.door];
    this.air.visible = true;
    // Prime on the view already showing, so an old cast isn't replayed when the room is built.
    if (play.view) doorStep(this.signs, play.view);
    this.world.getSystem(EffectsSystem)?.onView((v) => this.react(v));
    // The tools' view of the room (tools/iwer-room.mjs): which room this session has, and what's built.
    play.roomState = () => ({ kind: this.kind, sessions: [...this.sessions], interiorVisible: this.interior.visible, doors: this.doors.length });
    // The atmosphere's counts for the tools (tools/iwer-art.mjs): particles shown now, and the bed.
    globalThis.__tapstoneAtmos = () => {
      const plan = airPlan(this.kind === 'interior' ? 'vr' : 'mr', access);
      return { plan: { ...plan, total: total(plan.counts) }, built: { door: this.doorAir.userData.particles, room: this.glows.userData.particles, table: this.motes.userData.particles }, sound: { ...this.ambience.stats } };
    };
    this.built = true;
  }

  // A door reacts to play; it never carries rules or offers a choice (0039).
  react(view) {
    for (const s of doorStep(this.signs, view)) {
      if (this.glow.has(s.faction)) this.glow.set(s.faction, s.kind === 'win' ? 3 : 1);
    }
  }

  // The bed's panners follow the doors (and the chimes and a lantern, in full VR); the listener the head.
  soundStep(session) {
    if (!session || !this.built) return;
    const cm = this.world.camera.matrixWorld;
    fwd.set(0, 0, -1).transformDirection(cm);
    up.set(0, 1, 0).transformDirection(cm);
    this.ambience.listen(cam, fwd, up);
    AIR_ORDER.forEach((f, k) => this.ambience.place(f, this.airDoors[k].localToWorld(at.set(0, 1.0, 0.1))));
    this.ambience.place('room', this.room.localToWorld(at.set(...CHIMES_AT)));
    this.ambience.place('lantern', this.room.localToWorld(at.set(...LANTERNS[1])));
  }

  update(delta) {
    const play = this.world.getSystem(PlaySystem);
    if (!play) return;
    const session = this.world.renderer.xr.getSession();
    if (!this.built && session) this.build(play);
    if (session && session !== this.session) this.enter(roomFor(session));
    this.session = session;
    const t = performance.now() / 1000;
    this.world.camera.getWorldPosition(cam);
    // The air: time, speed, calm and dim from the settings (logic/atmosphere.js airPlan), the doors'
    // matrices, the lanterns' flicker on the halos and, faintly, on the baked room itself.
    const plan = airPlan(this.kind === 'interior' ? 'vr' : 'mr', access);
    const base = session?.renderState?.baseLayer;
    const scale = (base?.framebufferHeight ?? this.world.renderer.domElement.height) / 2;
    this.airU.uTime.value = t;
    this.airU.uSpeed.value = plan.speed;
    this.airU.uCalm.value = plan.flicker ? 0 : 1;
    this.airU.uDim.value = plan.dim;
    this.airU.uScale.value = scale;
    this.airDoors?.forEach((d, k) => this.airU.uDoor.value[k].copy(d.matrix));
    if (this.glows) {
      const u = this.glows.material.uniforms;
      u.uTime.value = t;
      u.uScale.value = scale;
      u.uSpeed.value = plan.speed;
      u.uCalm.value = this.airU.uCalm.value;
      u.uFlick.value = plan.flicker;
      u.uDim.value = plan.dim;
      if (this.interior.visible) {
        // The lanterns' flicker, faintly, on the whole baked room, and the dusk's slow hue drift.
        const f = 0.985 + 0.15 * (flicker(t, 3, plan.flicker) - 1), [r, g, b] = hueDrift(t, !plan.flicker);
        this.roomMesh.material.color.setRGB(f * r, f * g, f * b);
        this.pool.material.uniforms.uFlick.value = 0.9 + 0.1 * flicker(t, 5, plan.flicker);
        this.pool.material.uniforms.uDim.value = plan.dim;
      }
    }
    this.soundStep(session);
    sparkleQuiet.value = play.ghost?.visible ? 1 : 0; // one highlight at a time: the guide's demo wins
    const aim = (portal, glow) => {
      const u = portal.material.uniforms;
      u.uTime.value = t;
      u.uGlow.value = glow;
      u.uCam.value.copy(portal.worldToLocal(cam.clone()));
    };
    if (this.red) aim(this.red.portal, 0.15 + 0.15 * Math.sin(t * 0.7));
    for (const d of this.doors) {
      const g = this.glow.get(d.faction);
      aim(d.portal, Math.min(1.6, g * 0.55));
      d.door.scale.y = 1 + Math.min(0.15, g * 0.05) * motion('summon', 0, access).swell; // no swell with reduced motion
      this.glow.set(d.faction, Math.max(0, g - delta * 0.8));
    }
  }
}
