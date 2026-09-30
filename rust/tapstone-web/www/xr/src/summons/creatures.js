// creatures.js: which creature a card becomes (design note 2026-09-28-xr-summons-design.md). Pure, so
// Node holds it against game/cards/set1. The choice of creature is PROPOSAL (art direction): the
// Inner Authority bible names no creatures for these cards. The models are Quaternius's CC0 packs
// (public/CREDITS.md), baked by tools/bake-creatures.mjs to one draw call with five clips each:
// idle, attack, hit, death, move.

// A model: its file (public/creatures/<model>.glb), its height on the board (m, the top of its bind
// pose above the cell), and whether it flies (it hovers, and the summon flight plays its `move`).
export const MODELS = {
  // Set 1's people (2026-09-29, the units fidelity pass), each after its card's painting (public/cards):
  // Quaternius's CC0 outfits, heads and animation library, with KayKit's CC0 props, assembled by
  // tools/assemble-units.py (public/CREDITS.md). PROPOSAL: the bible names none of these figures.
  'ashen-vanguard': { height: 0.085, flies: false },
  'hearth-warden': { height: 0.085, flies: false },
  'pearl-shieldbearer': { height: 0.085, flies: false },
  'reef-archer': { height: 0.088, flies: false },
  tidecaller: { height: 0.084, flies: false },
  'brine-skimmer': { height: 0.084, flies: false },
  // Forge Runner carries an ember that glows in his hand (`glowBone`); Bellows Raider's attack is a jet of
  // flame from his (`fireFrom`), as his card's bellows.
  'forge-runner': { height: 0.084, flies: false, glowBone: 'hand_r' },
  'bellows-raider': { height: 0.084, flies: false, fireFrom: 'hand_r' },
  // The beasts: Quaternius's Giant as the basalt Slag Brute, his Crab Enemy as the Trench Leviathan.
  'slag-brute': { height: 0.095, flies: false },
  'trench-crab': { height: 0.06, flies: false },
  // The commanders (the fidelity pass, 2026-09-29): Quaternius's crowned King for Ember, the Hooded
  // Adventurer with her sword for Tide (PROPOSAL: the bible names no commander figures).
  king: { height: 0.092, flies: false },
  hooded: { height: 0.088, flies: false },
  // The Cinder Whelp is built in code (wyrm.js): no file. `span` is its wingspan on the board (m); its
  // summon flies it SOAR.big times larger (look.js).
  wyrm: { height: 0.06, flies: true, procedural: true, span: 0.12, soars: true },
  // The Cinder Whelp (2026-09-29): xTerryx's Low Poly Ice Dragon (CC0), recoloured for the Forge Peaks
  // (public/CREDITS.md). `length` is its nose to tail on the board (m); it has one clip, its flight,
  // which the summons also play slow for its idle hover and fast for an attack (`clipFrom`). If its
  // file fails to load, the wyrm takes its place (`fallback`, resolveModel()).
  drake: { height: 0.06, flies: true, length: 0.14, soars: true, clipFrom: 'move', fallback: 'wyrm' },
};

// The commander's figure by the seat's faction (a neutral seat never happens; it gets the King).
export const COMMANDER = { ember: 'king', tide: 'hooded', neutral: 'king' };

export const modelFile = (model) => `creatures/${model}.glb`;

// Set 1's units (game/cards/set1/*.toml, type = "unit"; a test holds this list to them) and the
// commander (the view names it "Commander"). Tide's come from the Deep Tides, Ember's from the Forge
// Peaks (0039); their tint is the faction's.
export const UNIT_CREATURE = {
  'Cinder Whelp': 'drake', // JP, 2026-09-28: "animate into a 3d flying dragon when you summon the whelp"
  'Ashen Vanguard': 'ashen-vanguard', // a charging helmed knight, a two-handed sword
  'Hearth Warden': 'hearth-warden', // a helmed guard, sword and shield
  'Pearl Shieldbearer': 'pearl-shieldbearer', // a pearl-helmed warrior, a round shield
  'Reef Archer': 'reef-archer', // a hooded archer with a bow
  Tidecaller: 'tidecaller', // a hooded caster with a staff
  'Brine Skimmer': 'brine-skimmer', // a hooded youth on a shell, harpoon in hand
  'Forge Runner': 'forge-runner', // a young man running, an ember in his hand
  'Bellows Raider': 'bellows-raider', // a bearded raider, an axe, and flame on the attack
  'Slag Brute': 'slag-brute', // a hulking basalt golem, an ember eye
  'Trench Leviathan': 'trench-crab', // the trench's great crab
  Commander: 'king', // by faction: COMMANDER
};

// Card ids by name (game/cards/set1/st1-NNN.toml), so a summon can show the card it came from.
export const CARD_ID = {
  'Cinder Whelp': 2, 'Ashen Vanguard': 3, 'Hearth Warden': 4, Flare: 5, 'Reef Archer': 6, Tidecaller: 7,
  'Pearl Shieldbearer': 8, 'Tidal Lash': 9, Undertow: 10, 'Deep Breath': 11, Mend: 12, Riptide: 13,
  'Forge Runner': 14, 'Bellows Raider': 15, 'Slag Brute': 16, 'Magma Burst': 17, 'Brine Skimmer': 18,
  'Trench Leviathan': 19,
};

// The creature for a unit in the view ({name, faction, commander, keyword}). A unit with no model
// (a new card before its creature is chosen) is the holographic wisp: generic, and still alive.
export function creatureFor(u) {
  const model = u.commander ? COMMANDER[u.faction] ?? COMMANDER.neutral : UNIT_CREATURE[u.name];
  const m = model && MODELS[model];
  const ranged = u.keyword === 'Ranged';
  if (!m) return { model: 'wisp', height: 0.05, flies: true, faction: u.faction, ranged, commander: !!u.commander };
  return specOf(model, m, u, ranged);
}

const specOf = (model, m, u, ranged) => ({
  model, height: m.height, flies: m.flies, procedural: !!m.procedural, span: m.span ?? null, length: m.length ?? null,
  soars: !!m.soars, clipFrom: m.clipFrom ?? null, fallback: m.fallback ?? null, glowBone: m.glowBone ?? null, fireFrom: m.fireFrom ?? null, faction: u.faction, ranged, commander: !!u.commander,
});

// The creature actually built: the spec's model if it loaded (or is built in code), else its fallback
// (the drake → the wyrm), else the wisp. `loaded`: the model names whose files loaded.
export function resolveModel(spec, loaded) {
  const has = (name) => MODELS[name]?.procedural || loaded.has(name);
  if (spec.model === 'wisp' || has(spec.model)) return spec;
  const fb = spec.fallback;
  if (fb && MODELS[fb] && has(fb)) return { ...specOf(fb, MODELS[fb], spec, spec.ranged), fellBack: spec.model };
  return { model: 'wisp', height: 0.05, flies: true, faction: spec.faction, ranged: spec.ranged, commander: spec.commander, fellBack: spec.model };
}

// The files to load: every mapped model and both commanders, but not the procedural whelp.
export const modelsNeeded = () => [...new Set([...Object.values(UNIT_CREATURE), ...Object.values(COMMANDER)])].filter((m) => !MODELS[m]?.procedural);
