// lore.js: the Tea House's names and door looks, from JP's canon (0039): the *Inner Authority* series
// bible. Pure data, so test/lore.test.js can check it without a renderer. Only short names and
// phrases come from the bible; each canon fact cites its section, and anything the bible doesn't
// state carries `proposal: true`, a PROPOSAL for JP, never canon.

// bible Part II: The Realms. All six, in the bible's order.
export const CANON_REALMS = ['The Hearthlands', 'The Deep Tides', 'The Forge Peaks', 'The Wandering Courts', 'The Star Fields', 'The Dreaming'];

// The planes behind each faction's door, keyed by the engine's factions. RULED by JP (0039): Tide's
// cards come from the Deep Tides, Ember's from the Forge Peaks; neutral = the Hearthlands (JP,
// 2026-09-27), whose door stirs for neutral casts (lead decision 2026-09-28). Where each door
// stands comes from logic/layout.js (DOORS), which the FoV test checks. `frame` is the door's wood,
// drawn by teahouse.js.
export const DOOR_LORE = {
  // bible Part II: The Realms: a water world, floating islands and coral kingdoms. The door itself
  // is blue wood whose water motifs shift (bible Book 1 Ch 35, "The Tea House Grows a New Door").
  tide: { name: 'The Deep Tides', look: { text: 'blue wood, shifting water motifs', frame: 0x1c3f6e, source: 'bible Book 1 Ch 35' } },
  // bible Part II: The Realms: volcanic mountains and crystalline caves, rich in ores. The bible
  // describes no door for it, so this look is a PROPOSAL: dark basalt with ember light in its cracks.
  ember: { name: 'The Forge Peaks', look: { text: 'PROPOSAL: dark basalt, ember light in the cracks', frame: 0x2e2624, proposal: true } },
  // bible Part II: The Realms: the starting realm, gentle forests and mild weather. Neutral cards come
  // from it (lead decision 2026-09-28, under 0039). The bible describes no door for it, so this look
  // is a PROPOSAL, the Roblox tea house's warm oak: wood the colour of a hearth's glow.
  neutral: { name: 'The Hearthlands', look: { text: 'PROPOSAL: warm oak, hearth-glow', frame: 0xb0703a, proposal: true } },
};

// The lintel: the bible's own name, the "Tea House" (bible Part II: The Tea House).
export const TEAHOUSE_NAME = 'The Tea House';

// The keeper: the bible names none. The house has an intelligence of its own, a benevolent awareness
// that offers and never forces (bible Part II: The Tea House), so the lintel names no one.
export const TEAHOUSE_KEEPER = { named: null, onLintel: false, source: 'bible Part II: The Tea House' };

// The red door and where it leads: "stepping onto the dueling grounds teleports your entire Deck … to a
// pocket dimension battlefield", through the red door (bible Book 1 Ch 22, per 0039). The name and the
// door's colour are canon; the view through it (a starlit plain ruled in gilt) is a PROPOSAL.
export const DUELING_GROUNDS = 'The Dueling Grounds';
export const RED_DOOR_LORE = { name: DUELING_GROUNDS, source: 'bible Book 1 Ch 22', view: { text: 'PROPOSAL: a starlit plain ruled in gilt', proposal: true } };
