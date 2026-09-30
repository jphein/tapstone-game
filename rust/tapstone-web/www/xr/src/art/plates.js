// plates.js: the in-scene type treatment (the design note's "Type"). Every label is an engraved plate
// on a canvas: a lacquered ground with a gilt rule and lozenge ends, and its text in the serif (names,
// sentences) or the condensed sans (numbers), with a dark outline so it holds over passthrough.
// Sizes come from labels.js (LABELS), and a line is fitted by type.js's fitText, never under the
// guard's floor: it wraps instead of being squashed.
import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import { FONTS, fitText } from './type.js';
import { LABELS, minPxOf } from './labels.js';
import { ART, css } from './palette.js';
import { THEMES } from '../logic/theme.js';
import { isContrast, onArtTheme, ready } from './contrast.js';

const GOLD = ['#f6e2a4', '#c9a55a', '#8a6a2c'];

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function gold(g, y0, y1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, GOLD[0]);
  gr.addColorStop(0.5, GOLD[1]);
  gr.addColorStop(1, GOLD[2]);
  return gr;
}

// The plate itself: `bg` a CSS colour (null for none), a gilt rule inset, lozenges at its ends.
export function paintPlate(g, w, h, bg, { rule = true, hc = false } = {}) {
  g.clearRect(0, 0, w, h);
  if (!bg) return;
  const r = Math.min(h * 0.22, 18), u = Math.max(1, h / 48);
  roundRect(g, u, u, w - 2 * u, h - 2 * u, r);
  g.fillStyle = bg;
  g.fill();
  if (hc) {
    // High contrast: a flat plate and a plain white rule, no sheen.
    g.lineWidth = Math.max(2, 2.5 * u);
    g.strokeStyle = '#ffffff';
    roundRect(g, 3.5 * u, 3.5 * u, w - 7 * u, h - 7 * u, Math.max(2, r - 2 * u));
    g.stroke();
    return;
  }
  // A lacquer sheen: lighter at the top edge, darker at the foot.
  const sh = g.createLinearGradient(0, 0, 0, h);
  sh.addColorStop(0, 'rgba(255,240,210,0.16)');
  sh.addColorStop(0.45, 'rgba(255,240,210,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = sh;
  g.fill();
  if (!rule) return;
  const i = 3.5 * u;
  roundRect(g, i, i, w - 2 * i, h - 2 * i, Math.max(2, r - i * 0.6));
  g.lineWidth = Math.max(1.2, 1.4 * u);
  g.strokeStyle = gold(g, 0, h);
  g.stroke();
  for (const x of [i, w - i]) {
    const s = 3.2 * u;
    g.beginPath();
    g.moveTo(x, h / 2 - s);
    g.lineTo(x + s, h / 2);
    g.lineTo(x, h / 2 + s);
    g.lineTo(x - s, h / 2);
    g.closePath();
    g.fillStyle = GOLD[1];
    g.fill();
  }
}

// Numbers and symbols take the sans; anything with a word in it takes the serif.
export const fontFor = (text) => (/[A-Za-z]{2,}/.test(text) ? 'text' : 'numeral');

// Draws `text` centred in (x, y, w, h), fitted; returns the fit ({ px, lines, fits }).
export function drawText(g, text, { x = 0, y = 0, w, h, fg = '#f4ead2', font = fontFor(String(text)), weight = font === 'numeral' ? 700 : 600, maxPx, minPx, maxLines = 1, outline = true, spacing = font === 'display' ? 0.06 : 0.01 }) {
  const family = FONTS[font] ?? FONTS.text;
  const measure = (line, px) => {
    g.font = `${weight} ${px}px ${family}`;
    g.letterSpacing = `${(spacing * px).toFixed(1)}px`;
    return g.measureText(line).width;
  };
  const fit = fitText(measure, text, { maxW: w, maxPx: Math.min(maxPx, Math.floor(h)), minPx, maxLines });
  // Wrapped lines share the height: shrink toward the floor (never under it) until they fit it.
  if (fit.lines.length > 1) fit.px = Math.max(minPx, Math.min(fit.px, Math.floor(h / (fit.lines.length * 1.08))));
  const lead = fit.px * 1.06, top = y + h / 2 - (lead * (fit.lines.length - 1)) / 2;
  g.font = `${weight} ${fit.px}px ${family}`;
  g.letterSpacing = `${(spacing * fit.px).toFixed(1)}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  fit.lines.forEach((line, k) => {
    const ly = top + k * lead + fit.px * 0.04;
    if (outline) {
      g.lineWidth = Math.max(2, fit.px * 0.16);
      g.strokeStyle = 'rgba(8,6,4,0.85)';
      g.strokeText(line, x + w / 2, ly);
    }
    g.fillStyle = fg === 'gold' ? gold(g, ly - fit.px / 2, ly + fit.px / 2) : fg;
    g.fillText(line, x + w / 2, ly);
  });
  return fit;
}

// A canvas and its texture, sRGB (the plate is painted in sRGB; without it, it renders washed out),
// anisotropic (most plates are seen at a slant).
export function canvasTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return { c, tex };
}

// A labelled plate, redrawn in place: label(w, h, bg, fg) as before (board.js re-exports it), or
// label(name) for a LABELS entry, whose size and guard floor it takes. opts: { font, lines, rule }.
// In high contrast (contrast.js) every plate redraws black with white text (label.bg, label.fg),
// a refusal in label.refuse; draw(text, { refuse }) marks a refusal.
export function label(w = 256, h = 96, bg = css(ART.labelBg, 0.94), fg = css(ART.labelFg), opts = {}) {
  const spec = typeof w === 'string' ? { name: w, ...LABELS[w] } : null;
  if (spec) [w, h] = spec.canvas;
  const { c, tex } = canvasTexture(w, h);
  const minPx = spec ? minPxOf(spec.name) : Math.ceil(h * 0.34);
  const maxPx = spec ? spec.maxPx : Math.floor(h * 0.62);
  const lines = opts.lines ?? spec?.lines ?? 1;
  let last = null, shown = null;
  const draw = (text, how = {}) => {
    shown = [text, how];
    const g = c.getContext('2d'), hc = isContrast(), T = THEMES.contrast;
    paintPlate(g, w, h, hc ? css(T['label.bg']) : bg, { ...opts, hc });
    const pad = h * 0.26;
    const ink = hc ? css(how.refuse ? T['label.refuse'] : T['label.fg']) : how.refuse ? css(ART.labelRefuse) : fg;
    const box = { x: pad, y: h * 0.06, w: w - 2 * pad, h: h * 0.88, fg: ink, font: opts.font ?? fontFor(String(text)), maxPx, minPx, maxLines: lines, outline: !hc };
    last = drawText(g, String(text), box);
    // A plate with no LABELS entry (another lane's tile) has no guard floor to hold: rather than
    // clip a line that overflows it, wrap to two lines, then shrink it until it fits.
    if (!last.fits && !spec) {
      paintPlate(g, w, h, hc ? css(T['label.bg']) : bg, { ...opts, hc });
      last = drawText(g, String(text), { ...box, minPx: Math.ceil(h * 0.18), maxLines: Math.max(2, lines) });
    }
    tex.needsUpdate = true;
    return last;
  };
  ready(tex);
  onArtTheme(() => shown && draw(...shown));
  return { tex, draw, canvas: c, fit: () => last };
}
