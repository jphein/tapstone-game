// type.js: the in-scene type's rules, pure, so node checks every label (test/art-type.test.js).
//
// A label is a canvas on a plate: the canvas is `canvasH` px tall, the plate `plateH` m, and a line of
// text is `fontPx` px, whose capitals are CAP x fontPx tall. Legible at arm's length means both:
//   - the capitals subtend at least MIN_DEG at the label's viewing distance: ~9 px on the Quest 2,
//     whose panel gives ~20 px per degree at the centre (and fewer toward the edge);
//   - at least MIN_PX canvas px per capital (a 20 px font), so the texture is not the limit when a hand or a lean
//     brings the label closer than its seat distance.
// fitText picks a line's size: the largest that fits the plate's width, never under `minPx` (the
// guard's floor); a line that won't fit at the floor wraps instead of being squashed (canvas
// fillText's maxWidth condenses glyphs, which is what made the altar's long lines unreadable).
export const MIN_DEG = 0.45;
export const MIN_PX = 14;
export const CAP = 0.7; // cap height / font size, for the serif and sans stacks used

export const FONTS = {
  display: '"Cinzel", "Trajan Pro", "Noto Serif Display", "Noto Serif", Georgia, "Times New Roman", serif',
  text: '"Noto Serif", Georgia, "Times New Roman", serif',
  numeral: '"Roboto Condensed", "Roboto", "Noto Sans", "Helvetica Neue", Arial, sans-serif',
};

// The capitals' angular height in degrees, for a plate `plateH` m tall carrying `fontPx` of `canvasH`.
// `oblique` is the angle (degrees) between the plate's normal and the line of sight: a plate seen
// edge-on foreshortens its capitals by its cosine.
export function capDegrees({ plateH, canvasH, fontPx, dist, oblique = 0 }) {
  const capM = ((CAP * fontPx * plateH) / canvasH) * Math.cos((oblique * Math.PI) / 180);
  return (2 * Math.atan(capM / 2 / dist) * 180) / Math.PI;
}

// Why a label is not legible, or null.
export function illegible(spec) {
  const deg = capDegrees(spec), px = CAP * spec.fontPx;
  if (deg < MIN_DEG) return `${spec.name ?? 'label'}: capitals ${deg.toFixed(2)}° at ${spec.dist.toFixed(2)} m, under ${MIN_DEG}°`;
  if (px < MIN_PX) return `${spec.name ?? 'label'}: capitals ${px.toFixed(0)} px on the canvas, under ${MIN_PX}`;
  return null;
}

// The smallest font px a plate may use: its guard floor.
export function floorPx({ plateH, canvasH, dist, oblique = 0 }) {
  const capM = (2 * dist * Math.tan((MIN_DEG * Math.PI) / 360)) / Math.cos((oblique * Math.PI) / 180);
  return Math.max(Math.ceil(MIN_PX / CAP), Math.ceil((capM * canvasH) / (CAP * plateH)));
}

// Lines and a size for `text` in `maxW` px: `measure(line, px)` is the line's width at that size.
// Tries maxPx down to minPx on one line (or the text's own lines); then wraps at minPx, greedily by words,
// into at most `maxLines`. Returns { px, lines, fits } (fits false: even wrapped it overflows).
export function fitText(measure, text, { maxW, maxPx, minPx, maxLines = 2 }) {
  const given = String(text).split('\n');
  const widest = (lines, px) => Math.max(...lines.map((l) => measure(l, px)));
  for (let px = maxPx; px >= minPx; px--) if (widest(given, px) <= maxW) return { px, lines: given, fits: true };
  const words = String(text).replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
  // At the floor, as few lines as fit; then the size grows back while the wrap still fits.
  for (let n = 2; n <= maxLines; n++) {
    const lines = wrap(measure, words, maxW, minPx, n);
    if (lines) {
      let px = minPx;
      while (px < maxPx && wrap(measure, words, maxW, px + 1, n)?.length === lines.length) px++;
      return { px, lines: wrap(measure, words, maxW, px, n), fits: true };
    }
  }
  return { px: minPx, lines: wrap(measure, words, maxW, minPx, maxLines, true), fits: false };
}

// Greedy word wrap into at most n lines at `px`, or null if it won't fit (`force`: the overflow
// joins the last line instead).
function wrap(measure, words, maxW, px, n, force = false) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next, px) <= maxW || !cur) cur = next;
    else lines.push(cur), (cur = w);
  }
  if (cur) lines.push(cur);
  if (force) return lines.length > n ? [...lines.slice(0, n - 1), lines.slice(n - 1).join(' ')] : lines;
  return lines.length <= n && lines.every((l) => measure(l, px) <= maxW) ? lines : null;
}
