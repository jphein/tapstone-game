// The summons' pure logic (src/summons/*): which creature a card becomes, who attacks whom, what a
// spell hits, and the director that keeps one creature per unit. Replayed on both real desk matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { diffViews, EffectQueue, DURATION } from '../src/logic/effects.js';
import { UNIT_CREATURE, MODELS, CARD_ID, COMMANDER, creatureFor, resolveModel, modelFile, modelsNeeded } from '../src/summons/creatures.js';
import { strikesOf, targetInLane } from '../src/summons/combat.js';
import { spellOf, SPELLS } from '../src/summons/spells.js';
import { enrich } from '../src/summons/enrich.js';
import { Director, STATE_MS, unitsOf, keyOf, settled } from '../src/summons/direct.js';
import { lookFor, flight, FLIGHT, ROOM_KEY } from '../src/summons/look.js';
import { THEMES, contrast } from '../src/logic/theme.js';
import { BOARD, ALTAR, cellCenter, padCenter } from '../src/logic/layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const SET1 = join(here, '../../../../../game/cards/set1');
const cards = readdirSync(SET1).filter((f) => f.endsWith('.toml')).map((f) => {
  const t = readFileSync(join(SET1, f), 'utf8');
  const get = (k) => (t.match(new RegExp(`^${k} = "?([^"\\n]*)"?`, 'm')) || [])[1];
  return { id: Number(get('id').slice(4)), name: get('name'), type: get('type'), faction: get('faction') };
});
const fixture = (n) => readFileSync(join(here, `../../../../tapstone-arena/web/fixtures/${n}`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const MATCHES = { seed11: fixture('desk-seed11.jsonl'), seed1: fixture('desk-seed1.jsonl') };

// A .glb's JSON chunk.
const glbJson = (path) => {
  const b = readFileSync(path);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
};

// ---- creatures.js -------------------------------------------------------------------------------

test('Cinder Whelp becomes the flying dragon: the drake, with the wyrm as its fallback', () => {
  const c = creatureFor({ name: 'Cinder Whelp', faction: 'ember', keyword: 'Haste' });
  assert.equal(c.model, 'drake');
  assert.equal(c.soars, true, 'it does the big sweep');
  assert.equal(c.fallback, 'wyrm');
  assert.ok(c.length >= 0.1 && c.length <= 0.16, 'about a board cell long at rest');
  // Loaded: the drake. Its file failed: the wyrm, which also soars. Nothing at all: the wisp.
  assert.equal(resolveModel(c, new Set(['drake'])).model, 'drake');
  const fb = resolveModel(c, new Set());
  assert.equal(fb.model, 'wyrm');
  assert.equal(fb.fellBack, 'drake');
  assert.equal(fb.soars, true);
  assert.equal(fb.procedural, true);
  assert.equal(resolveModel({ ...c, fallback: null }, new Set()).model, 'wisp');
  assert.equal(resolveModel(creatureFor({ name: 'Reef Archer', faction: 'tide' }), new Set()).model, 'wisp', 'no fallback: the wisp');
  assert.equal(c.flies, true);
  assert.equal(c.faction, 'ember');
});

test('every set 1 unit, and the commander, has a creature; nothing maps to a card that is not a unit', () => {
  const units = cards.filter((c) => c.type === 'unit').map((c) => c.name).sort();
  assert.ok(units.length >= 11, `set 1 has ${units.length} units`);
  assert.deepEqual(Object.keys(UNIT_CREATURE).filter((n) => n !== 'Commander').sort(), units);
  for (const n of units) assert.notEqual(creatureFor({ name: n, faction: 'tide' }).model, 'wisp', n);
  assert.equal(creatureFor({ name: 'Commander', faction: 'tide', commander: true }).model, 'hooded');
  assert.equal(creatureFor({ name: 'Commander', faction: 'ember', commander: true }).model, 'king');
});

test('card ids match game/cards/set1, so a summon shows its own card', () => {
  for (const c of cards.filter((x) => x.type !== 'castle')) assert.equal(CARD_ID[c.name], c.id, c.name);
});

test('a unit with no creature yet is the holographic wisp, never nothing', () => {
  const c = creatureFor({ name: 'Some Future Card', faction: 'ember' });
  assert.equal(c.model, 'wisp');
  assert.ok(c.height > 0);
});

test('every mapped model is baked: one skinned primitive per LOD, LOD1 smaller, and the clips the director plays', () => {
  for (const m of modelsNeeded()) {
    assert.ok(MODELS[m], `${m} has a size`);
    const path = join(here, '../public', modelFile(m));
    assert.ok(existsSync(path), `${path} is baked`);
    const j = glbJson(path);
    const meshes = Object.fromEntries(j.meshes.map((x) => [x.name, x]));
    assert.equal(meshes.lod0.primitives.length, 1, `${m}: one draw call`);
    assert.equal(meshes.lod1.primitives.length, 1, `${m}: one draw call at LOD1`);
    const tris = (x) => j.accessors[x.primitives[0].indices].count / 3;
    // The commanders are flat-shaded figures of many small pieces that the simplifier can't reduce
    // (tools/bake-creatures.mjs): there are only two on the board, so they may be heavier.
    const commander = Object.values(COMMANDER).includes(m);
    if (!commander) assert.ok(tris(meshes.lod1) < tris(meshes.lod0) * 0.6, `${m}: LOD1 ${tris(meshes.lod1)} vs ${tris(meshes.lod0)}`);
    assert.ok(tris(meshes.lod0) <= (commander ? 11500 : 7500), `${m}: ${tris(meshes.lod0)} triangles`);
    const skinned = j.nodes.filter((n) => n.mesh !== undefined);
    assert.equal(new Set(skinned.map((n) => n.skin)).size, 1, `${m}: both LODs share one skin`);
    assert.ok(!j.images?.length && !j.textures?.length, `${m}: no textures ship`);
    const clips = j.animations.map((a) => a.name);
    // A model whose one clip plays every role (the drake: its flight, clipFrom) needs only that clip.
    const need = MODELS[m].clipFrom ? [MODELS[m].clipFrom] : ['idle', 'attack', 'death', 'move'];
    for (const c of need) assert.ok(clips.includes(c), `${m}: ${c} in ${clips}`);
  }
});

// ---- combat.js ----------------------------------------------------------------------------------

test("targeting is the rules': Taunt draws, Ranged hits the nearest, melee only the front", () => {
  const u = (keyword = null) => ({ name: 'x', keyword });
  assert.equal(targetInLane([null, u('Taunt'), u()], false), 1, 'a Taunt behind the front draws melee');
  assert.equal(targetInLane([null, u(), null], false), null, 'melee with an empty front hits the castle');
  assert.equal(targetInLane([null, u(), null], true), 1, 'ranged hits the nearest');
  assert.equal(targetInLane([u(), null, null], true), 0);
  assert.equal(targetInLane([null, null, null], true), null);
});

for (const [name, views] of Object.entries(MATCHES)) {
  test(`${name}: the strikes predict every turn's castle damage exactly (the record's combat_damage)`, () => {
    let turns = 0, ranged = 0;
    for (let i = 1; i < views.length; i++) {
      const m = /combat_damage: \[(\d+), (\d+)\]/.exec(views[i].last?.applied ?? '');
      const s = strikesOf(views[i - 1], views[i]);
      if (!m) {
        if (!/GameEnded/.test(views[i].last?.applied ?? '')) assert.deepEqual(s, [], `view ${i} is no turn's end`);
        continue;
      }
      turns++;
      const castle = [0, 0];
      for (const a of s) {
        if (a.target.castle !== undefined) castle[a.target.castle] += a.amount;
        if (a.ranged && a.cell !== 2) ranged++;
      }
      assert.deepEqual(castle, [Number(m[1]), Number(m[2])], `view ${i}: ${views[i].last.applied}`);
    }
    assert.ok(turns > 10, `${turns} turns`);
    if (name === 'seed11') assert.ok(ranged > 0, 'a ranged unit attacks from behind the front');
  });
}

// ---- spells.js ----------------------------------------------------------------------------------

test('every spell cast in both matches finds its target', () => {
  let n = 0;
  const seen = new Set();
  for (const views of Object.values(MATCHES)) {
    for (let i = 1; i < views.length; i++) {
      const s = spellOf(views[i - 1], views[i]);
      if ((views[i].last?.kind === 'CastSpell') !== !!s) assert.fail(`view ${i}: spell ${!!s}`);
      if (!s) continue;
      n++;
      seen.add(s.card);
      assert.equal(s.kind, SPELLS[s.card].kind);
      assert.ok(s.target, `${s.card} at view ${i} has a target`);
      if (s.card === 'Mend') assert.ok(s.target.seat !== undefined, 'Mend heals a unit');
    }
  }
  assert.ok(n >= 6, `${n} casts`);
  assert.ok(seen.has('Magma Burst') && seen.has('Tidal Lash') && seen.has('Riptide'), [...seen].join());
});

// A two-view board for synthetic cases.
const board = (cells0, cells1, last, life = [20, 20]) => ({
  phase: 'playing', lobby: [], last, seats: [
    { faction: 'tide', life: life[0], charged: 0, commander_returns: 0, hand: 3, cells: cells0 },
    { faction: 'ember', life: life[1], charged: 0, commander_returns: 0, hand: 3, cells: cells1 },
  ],
});
const unit = (name, extra = {}) => ({ name, faction: 'tide', attack: 1, toughness: 2, damage: 0, keyword: null, commander: false, ...extra });
const empty = () => [[null, null, null], [null, null, null], [null, null, null]];

test('Undertow: the unit rides a wave to its new lane (a shift, not a death and a summon)', () => {
  const a = empty(), b = empty();
  a[0][1] = unit('Tidecaller');
  b[1][1] = unit('Tidecaller');
  const prev = board(a, empty(), { kind: 'Pass', seat: 1, applied: 'TurnEnded { combat_damage: [0, 0] }' });
  const next = board(b, empty(), { kind: 'CastSpell', seat: 0, card: 'Undertow', applied: 'Spell' });
  const fx = enrich(prev, next, diffViews(prev, next, 0));
  assert.deepEqual(fx.map((e) => e.type), ['spell', 'shift']);
  assert.deepEqual(fx[0].target, { seat: 0, lane: 0, cell: 1, toLane: 1 });
  const d = new Director();
  d.apply({ type: 'summon', seat: 0, lane: 0, cell: 1, faction: 'tide', name: 'Tidecaller' }, 0, 0);
  for (const e of fx) d.apply(e, 10, 0);
  assert.deepEqual(d.census(), { '0:1:1': 'Tidecaller' });
  assert.equal(d.stateOf('0:1:1'), 'moving');
});

test('a damage spell at the castle targets the castle', () => {
  const prev = board(empty(), empty(), { kind: 'Pass', seat: 1, applied: 'TurnEnded { combat_damage: [0, 0] }' });
  const next = board(empty(), empty(), { kind: 'CastSpell', seat: 0, card: 'Flare', applied: 'Spell' }, [20, 18]);
  assert.deepEqual(spellOf(prev, next).target, { castle: 1 });
});

// ---- direct.js: the effect queue drives the creatures ---------------------------------------------

for (const [name, views] of Object.entries(MATCHES)) {
  test(`${name}: the effect stream alone keeps one creature per unit, the right one, through the whole match`, () => {
    const d = new Director();
    let now = 0, spawns = 0, attacks = 0, deaths = 0, whelp = null;
    for (let i = 1; i < views.length; i++) {
      for (const e of enrich(views[i - 1], views[i], diffViews(views[i - 1], views[i], 0))) {
        now += 700;
        for (const op of d.apply(e, now, 0)) {
          if (op.op === 'spawn') spawns++;
          if (op.op === 'attack') attacks++;
          if (op.op === 'die') deaths++;
          if (op.op === 'spawn' && op.unit.name === 'Cinder Whelp' && !whelp) whelp = op;
        }
        d.tick(now + 1);
      }
      assert.deepEqual(d.census(), unitsOf(views[i]), `after view ${i} (${views[i].last?.kind} ${views[i].last?.applied})`);
      assert.deepEqual(d.reconcile(views[i], now), [], `view ${i}: nothing to reconcile`);
    }
    assert.ok(spawns > 5 && attacks > 5 && deaths > 0, `${spawns} spawns, ${attacks} attacks, ${deaths} deaths`);
    if (name === 'seed11') {
      assert.ok(whelp, 'the whelp is cast in seed 11');
      assert.equal(creatureFor(whelp.unit).model, 'drake');
      assert.equal(whelp.origin, whelp.seat === 0 ? 'pad' : 'keep', 'the card flies from its own side');
    }
  });
}

test('states: forming, then idle; an attack and a hit return to idle; a death leaves', () => {
  const d = new Director();
  const k = keyOf(0, 1, 2);
  const T0 = STATE_MS.forming; // after the summon (the whelp's is the longest)
  d.apply({ type: 'summon', seat: 0, lane: 1, cell: 2, faction: 'ember', name: 'Cinder Whelp' }, 0, 0);
  assert.equal(d.stateOf(k), 'forming');
  d.tick(STATE_MS.forming - 1);
  assert.equal(d.stateOf(k), 'forming');
  d.tick(STATE_MS.forming);
  assert.equal(d.stateOf(k), 'idle');
  d.apply({ type: 'strike', attacks: [{ seat: 0, lane: 1, cell: 2, ranged: false, target: { castle: 1 } }] }, T0 + 2000, 0);
  assert.equal(d.stateOf(k), 'attack');
  d.tick(T0 + 2000 + STATE_MS.attack);
  assert.equal(d.stateOf(k), 'idle');
  d.apply({ type: 'damage', seat: 0, lane: 1, cell: 2, amount: 1 }, T0 + 3000, 0);
  assert.equal(d.stateOf(k), 'hit');
  const die = d.apply({ type: 'death', seat: 0, lane: 1, cell: 2 }, T0 + 4000, 0);
  assert.deepEqual(die.map((o) => o.op), ['die']);
  assert.equal(d.stateOf(k), null, 'the cell is free at once');
  assert.deepEqual(d.tick(T0 + 4000 + STATE_MS.dying - 1), []);
  assert.deepEqual(d.tick(T0 + 4000 + STATE_MS.dying).map((o) => o.op), ['remove']);
});

test('reduced motion: every state is short, and forming is a fade, not a flight', () => {
  for (const s of ['forming', 'attack', 'hit', 'dying']) assert.ok(STATE_MS.reduced[s] <= 400, s);
  assert.ok(STATE_MS.reduced.forming * 4 <= STATE_MS.forming, 'the calm form is short');
  const d = new Director({ reduced: true });
  d.apply({ type: 'summon', seat: 0, lane: 0, cell: 0, faction: 'tide', name: 'Reef Archer' }, 0, 0);
  d.tick(STATE_MS.reduced.forming);
  assert.equal(d.stateOf('0:0:0'), 'idle');
});

test('a dropped summon is reconciled: the unit appears where it stands, and a stale creature fades', () => {
  const views = MATCHES.seed11;
  const i = views.findIndex((v) => v.last?.kind === 'CastUnit');
  const d = new Director();
  // Play every effect up to the cast, then drop the cast's own effects (the queue's backlog).
  for (let j = 1; j < i; j++) for (const e of enrich(views[j - 1], views[j], diffViews(views[j - 1], views[j], 0))) d.apply(e, j * 10, 0);
  const ops = d.reconcile(views[i], i * 10);
  assert.deepEqual(ops.map((o) => [o.op, o.origin]), [['spawn', 'here']]);
  assert.deepEqual(d.census(), unitsOf(views[i]));
  const gone = d.reconcile(views[0], i * 10 + 1);
  assert.ok(gone.every((o) => o.op === 'die'));
});

// The page's own path: views arrive faster than effects play, so the real queue compresses (drops the
// oldest in a backlog), and the system reconciles whenever the queue is settled (system.js update()).
for (const [name, views] of Object.entries(MATCHES)) {
  test(`${name}: with the real queue dropping effects in a backlog, the settled-queue reconcile keeps the creatures true`, () => {
    const q = new EffectQueue();
    const d = new Director();
    let now = 0, dropped = 0, repaired = 0, checks = 0;
    const drain = (ms) => {
      for (const end = now + ms; now < end; now += 50) {
        const e = q.next(now);
        if (e) d.apply(e, now, 0);
        d.tick(now);
      }
    };
    for (let i = 1; i < views.length; i++) {
      const fx = enrich(views[i - 1], views[i], diffViews(views[i - 1], views[i], 0));
      const before = q.length;
      q.push(fx);
      dropped += before + fx.length - q.length;
      drain(150); // a fast player: a view every 150 ms, far faster than the effects play
      if (settled(q.items)) {
        repaired += d.reconcile(views[i], now).length;
        checks++;
        assert.deepEqual(d.census(), unitsOf(views[i]), `view ${i}`);
      }
    }
    drain(20000);
    repaired += d.reconcile(views.at(-1), now).length;
    assert.deepEqual(d.census(), unitsOf(views.at(-1)), 'after the queue drains');
    assert.ok(dropped > 0, 'the backlog really dropped effects (else this test proves nothing)');
    assert.ok(checks > 0 && repaired > 0, `${checks} settled checks, ${repaired} ops repaired`);
    assert.ok(DURATION.summon > 150);
  });
}

// And when nothing is dropped, a settled reconcile has nothing to repair: every creature arrives and
// leaves through its own effect (its summon flight, its death), never through a silent fade. Were a
// death not a placing effect, reconcile would fade the creature before its death could play.
for (const [name, views] of Object.entries(MATCHES)) {
  test(`${name}: with no effect dropped, no settled reconcile ever repairs anything`, () => {
    const q = new EffectQueue({ maxPending: 1e6 });
    const d = new Director();
    let now = 0, checks = 0;
    for (let i = 1; i < views.length; i++) {
      q.push(enrich(views[i - 1], views[i], diffViews(views[i - 1], views[i], 0)));
      for (const end = now + 1200; now < end; now += 50) { // a person's pace: a move every 1.2 s
        const e = q.next(now);
        if (e) d.apply(e, now, 0);
        d.tick(now);
        if (settled(q.items)) {
          checks++;
          assert.deepEqual(d.reconcile(views[i], now), [], `view ${i} at ${now} ms`);
        }
      }
    }
    assert.ok(checks > 500, `${checks} checks`);
  });
}

// ---- look.js: the rooms, the contrast theme, reduced motion, the flight ------------------------------

test('the Tea House interior lights the creatures warm (lantern light), mixed reality neutral', () => {
  const warm = lookFor({ room: 'interior' }).key, plain = lookFor({ room: 'doors' }).key;
  const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  assert.ok(rgb(warm)[0] - rgb(warm)[2] > 80, 'warm: much more red than blue');
  assert.ok(Math.abs(rgb(plain)[0] - rgb(plain)[2]) < 20, 'neutral');
  assert.equal(ROOM_KEY.interior, warm);
});

test('high contrast: an opaque, flat silhouette with a white rim, legible against the black board (3:1)', () => {
  const l = lookFor({ contrast: true });
  assert.equal(l.alpha, 1);
  assert.equal(l.scan, 0);
  assert.equal(l.flicker, 0);
  assert.equal(l.rim, 0xffffff);
  // The darkest part colour a model has (black) pulled toward the faction's contrast colour by
  // tintMix: the body must still stand out from the board's base at WCAG's 3:1 for non-text.
  const mix = (hex, k) => [16, 8, 0].reduce((acc, sh) => acc | (Math.round(((hex >> sh) & 255) * k) << sh), 0);
  for (const f of ['ember', 'tide', 'neutral']) {
    const body = mix(THEMES.contrast[`faction.${f}`], l.tintMix);
    assert.ok(contrast(body, THEMES.contrast['board.base']) >= 3, `${f}: ${contrast(body, THEMES.contrast['board.base']).toFixed(2)}`);
  }
  assert.ok(lookFor().alpha < 1 && lookFor().scan > 0, 'the standard look stays holographic');
});

test('reduced motion stills the hover and the embers, and keeps the look', () => {
  const r = lookFor({ reduced: true }), n = lookFor();
  assert.equal(r.bob, 0);
  assert.equal(r.embers, 0);
  assert.ok(n.bob > 0 && n.embers > 0);
  assert.equal(r.tintMix, n.tintMix);
});

test('the flight: from the card to the cell, turning above the board, never past its edges or out of reach', () => {
  const near = 0;
  for (let lane = 0; lane < 3; lane++) {
    const p = padCenter(lane);
    const from = { x: p.x, y: p.y + 0.054, z: p.z - 0.07 };
    for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) {
      const to = cellCenter(near, l, c, near);
      for (const flies of [true, false]) {
        const a = flight(from, to, 0, flies), b = flight(from, to, 1, flies);
        assert.ok(Math.hypot(a.x - from.x, a.y - from.y, a.z - from.z) < 1e-9, 'starts at the card');
        assert.ok(Math.hypot(b.x - to.x, b.y - to.y, b.z - to.z) < 1e-9, 'lands on its cell');
        let top = -1;
        for (let k = 0; k <= 1; k += 0.02) {
          const f = flight(from, to, k, flies);
          top = Math.max(top, f.y);
          assert.ok(f.y >= Math.min(from.y, to.y) - 1e-9, 'never below the board');
          assert.ok(Math.abs(f.x) <= BOARD.w / 2 + 0.03, `x ${f.x.toFixed(3)} stays over the board`);
          assert.ok(f.z >= -BOARD.d / 2 && f.z <= ALTAR.z + 0.03, `z ${f.z.toFixed(3)}`);
          assert.ok(Number.isFinite(f.yaw) && Number.isFinite(f.roll));
          // The turn swings out over the board (away from the person), never toward their face.
          if (flies) {
            const e = k * k * (3 - 2 * k), straight = from.z + (to.z - from.z) * e;
            assert.ok(f.z <= straight + 1e-9, `k ${k.toFixed(2)}: z ${f.z.toFixed(3)} swings toward the face (straight ${straight.toFixed(3)})`);
          }
        }
        if (flies) assert.ok(top - Math.max(from.y, to.y) > FLIGHT.climb * 0.6, 'a flier climbs into its turn');
        assert.ok(top - Math.max(from.y, to.y) <= FLIGHT.climb + 1e-9, 'and never above the climb');
      }
    }
  }
});

test('every creature file shipped is credited with its license; the drake with its source and its sha256', () => {
  const credits = readFileSync(join(here, '../public/CREDITS.md'), 'utf8');
  for (const f of readdirSync(join(here, '../public/creatures')).filter((x) => x.endsWith('.glb'))) {
    const line = credits.split('\n').find((l) => l.includes(f));
    assert.ok(line, `${f} is in CREDITS.md`);
  }
  assert.match(credits, /Low Poly Ice Dragon.*xTerryx/s);
  assert.match(credits, /https:\/\/opengameart\.org\/content\/low-poly-ice-dragon/);
  assert.match(credits, /\*\*Modified\*\*/);
  const sha = createHash('sha256').update(readFileSync(join(here, '../public/creatures/drake.glb'))).digest('hex');
  assert.ok(credits.includes(sha), 'the vendored drake.glb is the file whose hash is recorded');
  assert.ok(existsSync(join(here, '../public/licenses/LICENSE-CC0-1.0.txt')));
});
