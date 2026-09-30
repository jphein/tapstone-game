// recolour.mjs: the bake's colour moves (tools/bake-creatures.mjs), pure so Node holds them
// (test/recolour.test.js). Each takes a linear RGB triple and returns one.
// Recolours, on linear RGB (a model's own light and dark kept, its hues moved): 'forge' turns the ice
// dragon into a Forge Peaks whelp (0039: Ember comes from the Forge Peaks): its mauve hide goes ember
// crimson, and its green-tipped spines and claws go gold. PROPOSAL (art direction), credited as modified.
export function hsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
export function rgbOf([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
// A person's skin (a warm, moderately saturated, mid-light tone) keeps its colour through a recolour.
export const isSkin = ([h, s, l]) => h >= 8 && h <= 42 && s >= 0.18 && s <= 0.75 && l >= 0.22 && l <= 0.85;
export const RECOLOUR = {
  // The Slag Brute: its hide goes basalt, dark and faintly warm; anything bright or pink (the nose, the
  // eyes) becomes an ember glow, as the card's molten cracks.
  slag: (rgb) => {
    const [h, s, l] = hsl(rgb);
    if (l > 0.55 || (h > 290 || h < 5) && s > 0.3) return rgbOf([22, 1, 0.5]);
    return rgbOf([18, 0.12, l * 0.3]);
  },
  // The Trench Leviathan: a shell of deep blue-grey, its light parts pearl.
  trench: (rgb) => {
    const [h, s, l] = hsl(rgb);
    if (l > 0.6) return rgbOf([195, 0.25, Math.min(0.92, l + 0.1)]);
    return rgbOf([208, 0.45, l * 0.8]);
  },
  // The Deep Tides' people (0039): cloth and leather go deep-sea blue and teal, metal goes pearl.
  deeps: (rgb) => {
    const c = hsl(rgb);
    const [h, s, l] = c;
    if (isSkin(c) && s < 0.6) return rgb;
    if (s < 0.14) return rgbOf([200, 0.18, Math.min(0.9, l * 1.15 + 0.08)]); // metal, bone, linen: pearl
    return rgbOf([h > 60 && h < 170 ? 198 : 212, Math.min(0.85, s * 0.9 + 0.2), l * 0.95]);
  },
  // The Forge Peaks' people: cloth goes ember red, leather soot brown, metal dark iron with a gold cast.
  'forge-people': (rgb) => {
    const c = hsl(rgb);
    const [h, s, l] = c;
    if (isSkin(c) && s < 0.6) return rgb;
    if (s < 0.14) return rgbOf([38, 0.22, l * 0.75]);
    if (h > 60 && h < 200) return rgbOf([8, Math.min(0.9, s + 0.25), l * 0.9]);
    return rgbOf([20, Math.min(0.7, s), l * 0.7]);
  },
  forge: (rgb) => {
    const [h, s, l] = hsl(rgb);
    const green = h > 70 && h < 170;
    return rgbOf(green ? [42, Math.max(0.75, s), Math.min(0.55, l * 1.1 + 0.08)] : [6, Math.min(1, 0.55 + s * 0.6), l * 0.9]);
  },
};
