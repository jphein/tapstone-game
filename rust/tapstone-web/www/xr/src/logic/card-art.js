// card-art.js: where a hand card's painted art (0014) comes from, and where it sits on the face.
// Pure (no DOM), so Node checks public/cards/ against game/cards/set1 and these numbers.

// The face canvas (hand.js) and its art window. The WebPs are twice the window, for the headset.
export const FACE = { w: 216, h: 344, art: { x: 10, y: 10, w: 196, h: 150 }, nameY: 200 };

// Set 1's card ids (SET1 in the rules crate, from game/cards/set1/*.toml; a test holds them equal).
export const SET1_IDS = Array.from({ length: 14 }, (_, i) => i);

export const artFile = (card) => `cards/st1-${String(card).padStart(3, '0')}.webp`;
export const artSize = () => ({ w: FACE.art.w * 2, h: FACE.art.h * 2 });
