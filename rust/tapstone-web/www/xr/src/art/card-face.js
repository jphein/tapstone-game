// card-face.js: the card faces and the card back, painted on canvases (0014's paintings, framed).
// A face is logic/card-art.js's FACE layout at FACE_SCALE (labels.js): the painting's window keeps
// FACE.art, so the WebPs (twice the window) still map 2:1. The frame is the card's plane (the Deep
// Tides, the Forge Peaks, the Hearthlands: 0039), with a cost gem, a name ribbon, a text box and stat
// shields; the text follows labels.js's cardName and cardText guard floors.
import { FACE } from '../logic/card-art.js';
import { cardArt } from '../card-art.js';
import { FACE_SCALE } from './labels.js';
import { FONTS } from './type.js';
import { ART, css, factionOf, PLACE_PALETTE } from './palette.js';
import { canvasTexture, drawText, gold, roundRect } from './plates.js';
import { rulesText } from './card-text.js';
import { isContrast, onArtTheme, ready } from './contrast.js';
import { FACTION_MARK, THEMES } from '../logic/theme.js';

// Every painted face (canvas -> { tex, card }), so a theme switch repaints them in place.
const painted = new Map();

const S = FACE_SCALE;
// The face's text sizes, in FACE units (x S on the canvas): at or over the guard floors (labels.js).
export const FACE_TYPE = { name: 22, nameMin: 16, text: 16, stat: 27, cost: 25 };

// One canvas and texture per hand slot (logic/face-slots.js makes them once).
export function blankFace() {
  const { c, tex } = canvasTexture(Math.round(FACE.w * S), Math.round(FACE.h * S));
  painted.set(c, { tex: ready(tex), card: null });
  return { canvas: c, texture: tex };
}

// The faction's sigil, centred at (x, y), radius r: a flame, a wave or a leaf (PROPOSAL marks).
export function sigil(g, kind, x, y, r, fill) {
  g.save();
  g.translate(x, y);
  g.scale(r / 10, r / 10);
  g.beginPath();
  if (kind === 'flame') {
    g.moveTo(0, -10);
    g.bezierCurveTo(6, -4, 9, 1, 7, 5);
    g.bezierCurveTo(5, 9, -5, 9, -7, 5);
    g.bezierCurveTo(-9, 0, -4, -2, -3, -6);
    g.bezierCurveTo(-1, -2, 1, -3, 0, -10);
  } else if (kind === 'wave') {
    g.moveTo(-10, 4);
    g.bezierCurveTo(-8, -6, 4, -10, 8, -3);
    g.bezierCurveTo(4, -6, -1, -3, 1, 1);
    g.bezierCurveTo(3, 4, 7, 3, 10, 1);
    g.lineTo(10, 6);
    g.lineTo(-10, 6);
  } else {
    g.moveTo(0, -10);
    g.bezierCurveTo(8, -6, 9, 4, 0, 10);
    g.bezierCurveTo(-9, 4, -8, -6, 0, -10);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (kind === 'leaf') {
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(0, 8);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1.2;
    g.stroke();
  }
  g.restore();
}

function gem(g, x, y, r, pal) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, css(pal.light));
  gr.addColorStop(0.55, css(pal.mid));
  gr.addColorStop(1, css(pal.base));
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 2.4;
  g.strokeStyle = gold(g, y - r, y + r);
  g.stroke();
}

function shield(g, x, y, r, fill) {
  g.beginPath();
  g.moveTo(x - r, y - r * 0.8);
  g.lineTo(x + r, y - r * 0.8);
  g.lineTo(x + r, y + r * 0.1);
  g.quadraticCurveTo(x + r * 0.9, y + r * 0.8, x, y + r * 1.05);
  g.quadraticCurveTo(x - r * 0.9, y + r * 0.8, x - r, y + r * 0.1);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 2.2;
  g.strokeStyle = gold(g, y - r, y + r);
  g.stroke();
}

// The frame every face and the castle share: the plane's colours, a gilt border, a faint sigil field.
function frame(g, pal) {
  const W = FACE.w, H = FACE.h;
  g.clearRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, css(pal.mid));
  bg.addColorStop(0.5, css(pal.base));
  bg.addColorStop(1, css(pal.mid));
  roundRect(g, 0, 0, W, H, 12);
  g.fillStyle = bg;
  g.fill();
  g.globalAlpha = 0.07;
  for (let y = 14; y < H; y += 26) for (let x = (y / 26) % 2 ? 14 : 27; x < W; x += 26) sigil(g, pal.sigil, x, y, 6, '#ffffff');
  g.globalAlpha = 1;
  roundRect(g, 4.5, 4.5, W - 9, H - 9, 9);
  g.lineWidth = 2;
  g.strokeStyle = gold(g, 0, H);
  g.stroke();
}

// The painting's window: a dark bed, the WebP, an inner shadow and a gilt rule.
function artWindow(g, card, pal) {
  const a = FACE.art;
  const bed = g.createLinearGradient(0, a.y, 0, a.y + a.h);
  bed.addColorStop(0, css(pal.mid));
  bed.addColorStop(1, css(pal.base));
  g.fillStyle = bed;
  g.fillRect(a.x, a.y, a.w, a.h);
  const art = cardArt(card.card); // the painting (0014), fetched during load; else the plane's sigil
  if (art) g.drawImage(art, a.x, a.y, a.w, a.h);
  else sigil(g, pal.sigil, a.x + a.w / 2, a.y + a.h / 2, 34, css(pal.light, 0.55));
  const sh = g.createLinearGradient(0, a.y, 0, a.y + 16);
  sh.addColorStop(0, 'rgba(0,0,0,0.45)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(a.x, a.y, a.w, 16);
  g.lineWidth = 1.6;
  g.strokeStyle = gold(g, a.y, a.y + a.h);
  g.strokeRect(a.x - 0.8, a.y - 0.8, a.w + 1.6, a.h + 1.6);
}

function ribbon(g, y, h) {
  const W = FACE.w;
  g.beginPath();
  g.moveTo(4, y);
  g.lineTo(W - 4, y);
  g.lineTo(W - 12, y + h / 2);
  g.lineTo(W - 4, y + h);
  g.lineTo(4, y + h);
  g.lineTo(12, y + h / 2);
  g.closePath();
  const p = g.createLinearGradient(0, y, 0, y + h);
  p.addColorStop(0, css(ART.parchment));
  p.addColorStop(1, '#d9c7a0');
  g.fillStyle = p;
  g.fill();
  g.lineWidth = 1.4;
  g.strokeStyle = gold(g, y, y + h);
  g.stroke();
}

// High contrast (contrast.js): a white face, black ink and rules, the painting kept, the stats in
// black on white, and the faction's letter where its sigil was (colour is never the only signal).
function drawFaceContrast(g, card, T) {
  const W = FACE.w, H = FACE.h, a = FACE.art, ink = css(T['card.ink']), face = css(T['card.face']);
  g.clearRect(0, 0, W, H);
  roundRect(g, 0, 0, W, H, 12);
  g.fillStyle = face;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = ink;
  roundRect(g, 2.5, 2.5, W - 5, H - 5, 10);
  g.stroke();
  g.fillStyle = ink;
  g.fillRect(a.x - 3, a.y - 3, a.w + 6, a.h + 6);
  const art = cardArt(card.card);
  if (art) g.drawImage(art, a.x, a.y, a.w, a.h);
  const nameTop = FACE.nameY - 34;
  drawText(g, card.name, { x: 12, y: nameTop, w: W - 24, h: 34, fg: ink, font: 'display', weight: 700, maxPx: FACE_TYPE.name, minPx: FACE_TYPE.nameMin, outline: false });
  const tb = { x: 12, y: FACE.nameY + 8, w: W - 24, h: 84 };
  roundRect(g, tb.x, tb.y, tb.w, tb.h, 6);
  g.lineWidth = 2;
  g.strokeStyle = ink;
  g.stroke();
  const words = rulesText(card);
  if (words) drawText(g, words, { x: tb.x + 6, y: tb.y + 2, w: tb.w - 12, h: tb.h - 4, fg: ink, font: 'text', weight: 700, maxPx: card.kind === 'unit' ? 20 : FACE_TYPE.text, minPx: FACE_TYPE.text, maxLines: 4, outline: false });
  const disc = (x, y, r, text) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = face;
    g.fill();
    g.lineWidth = 3.5;
    g.strokeStyle = ink;
    g.stroke();
    drawText(g, text, { x: x - r, y: y - r, w: 2 * r, h: 2 * r, fg: ink, font: 'numeral', maxPx: FACE_TYPE.stat, minPx: FACE_TYPE.cost - 2, outline: false });
  };
  if (card.kind !== 'castle') disc(27, 27, 18, String(card.cost ?? ''));
  const footY = H - 26;
  drawText(g, FACTION_MARK[card.faction] ?? FACTION_MARK.neutral, { x: W / 2 - 16, y: footY - 16, w: 32, h: 32, fg: ink, font: 'numeral', maxPx: 26, minPx: 24, outline: false });
  if (card.kind === 'unit') {
    disc(30, footY, 19, String(card.attack));
    disc(W - 30, footY, 19, String(card.toughness));
  }
}

// A hand card's face (hand.js hands this to FaceSlots.show).
export function drawFace(c, card) {
  const g = c.getContext('2d');
  const rec = painted.get(c);
  if (rec) rec.card = card;
  g.setTransform(S, 0, 0, S, 0, 0);
  if (isContrast()) {
    drawFaceContrast(g, card, THEMES.contrast);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  const pal = factionOf(card.faction);
  frame(g, pal);
  artWindow(g, card, pal);
  // The name ribbon, across the painting's foot.
  const nameTop = FACE.nameY - 34;
  ribbon(g, nameTop, 34);
  drawText(g, card.name, { x: 18, y: nameTop, w: FACE.w - 36, h: 34, fg: css(ART.ink), font: 'display', maxPx: FACE_TYPE.name, minPx: FACE_TYPE.nameMin, outline: false });
  // The text box.
  const tb = { x: 14, y: FACE.nameY + 8, w: FACE.w - 28, h: 84 };
  roundRect(g, tb.x, tb.y, tb.w, tb.h, 6);
  g.fillStyle = css(ART.parchment, 0.93);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(138,106,44,0.9)';
  g.stroke();
  const words = rulesText(card);
  if (words) drawText(g, words, { x: tb.x + 6, y: tb.y + 2, w: tb.w - 12, h: tb.h - 4, fg: css(ART.ink), font: 'text', weight: card.kind === 'unit' ? 700 : 500, maxPx: card.kind === 'unit' ? 20 : FACE_TYPE.text, minPx: FACE_TYPE.text, maxLines: 4, outline: false });
  // Cost, top left; the plane's sigil at the foot; a unit's attack and toughness at the corners.
  if (card.kind !== 'castle') {
    gem(g, 27, 27, 17, pal);
    drawText(g, String(card.cost ?? ''), { x: 10, y: 10, w: 34, h: 34, fg: '#fffaf0', font: 'numeral', maxPx: FACE_TYPE.cost, minPx: FACE_TYPE.cost });
  }
  const footY = FACE.h - 26;
  sigil(g, pal.sigil, FACE.w / 2, footY, 9, gold(g, footY - 9, footY + 9));
  if (card.kind === 'unit') {
    gem(g, 30, footY, 19, { light: 0xffb08a, mid: 0xb8322a, base: 0x4a1410 });
    drawText(g, String(card.attack), { x: 11, y: footY - 19, w: 38, h: 38, fg: '#fffaf0', font: 'numeral', maxPx: FACE_TYPE.stat, minPx: FACE_TYPE.stat });
    shield(g, FACE.w - 30, footY - 2, 18, '#34465e');
    drawText(g, String(card.toughness), { x: FACE.w - 49, y: footY - 21, w: 38, h: 38, fg: '#fffaf0', font: 'numeral', maxPx: FACE_TYPE.stat, minPx: FACE_TYPE.stat });
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// The card back, shared by the deck and every face-down card: the Dueling Grounds' night with a
// gilt stepped-fret border (the Mayan influence) and the red door's torii at its heart (PROPOSAL).
export function drawBack(c) {
  const g = c.getContext('2d');
  g.setTransform(S, 0, 0, S, 0, 0);
  const W = FACE.w, H = FACE.h, P = PLACE_PALETTE;
  if (isContrast()) {
    // High contrast: the deck's colour (deck.top), a black border and the torii drawn in black line.
    const T = THEMES.contrast, ink = css(T['card.ink']);
    g.clearRect(0, 0, W, H);
    roundRect(g, 0, 0, W, H, 12);
    g.fillStyle = css(T['deck.top']);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = ink;
    roundRect(g, 3, 3, W - 6, H - 6, 10);
    g.stroke();
    g.fillStyle = ink;
    const cx = W / 2, cy = H / 2;
    for (const [x, y, w, h] of [[cx - 40, cy - 34, 80, 9], [cx - 30, cy - 20, 60, 7], [cx - 25, cy - 30, 9, 60], [cx + 16, cy - 30, 9, 60]]) g.fillRect(x, y, w, h);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  const bg = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * 0.62);
  bg.addColorStop(0, css(ART.back));
  bg.addColorStop(1, css(P.grounds.slate));
  roundRect(g, 0, 0, W, H, 12);
  g.fillStyle = bg;
  g.fill();
  const gl = gold(g, 0, H);
  roundRect(g, 5, 5, W - 10, H - 10, 9);
  g.lineWidth = 2;
  g.strokeStyle = gl;
  g.stroke();
  // Stepped frets along the border.
  g.fillStyle = gl;
  const fret = (x, y, s, flip) => {
    g.save();
    g.translate(x, y);
    if (flip) g.scale(1, -1);
    g.fillRect(0, 0, s, s * 0.25);
    g.fillRect(s * 0.25, -s * 0.25, s * 0.5, s * 0.25);
    g.fillRect(s * 0.4, -s * 0.5, s * 0.2, s * 0.25);
    g.restore();
  };
  for (let x = 14; x < W - 20; x += 16) fret(x, 20, 12, false), fret(x, H - 20, 12, true);
  // Stars.
  for (let k = 0; k < 40; k++) {
    const x = 16 + ((k * 73) % (W - 32)), y = 34 + ((k * 131) % (H - 68)), r = k % 5 === 0 ? 1.3 : 0.7;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = `rgba(230,220,255,${k % 3 ? 0.35 : 0.7})`;
    g.fill();
  }
  // The torii in a ring.
  const cx = W / 2, cy = H / 2;
  g.beginPath();
  g.arc(cx, cy, 52, 0, Math.PI * 2);
  g.lineWidth = 2.5;
  g.strokeStyle = gl;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 46, 0, Math.PI * 2);
  g.fillStyle = 'rgba(184,50,42,0.18)';
  g.fill();
  g.fillStyle = css(P.teahouse.lacquer);
  g.strokeStyle = '#1a0d0a';
  g.lineWidth = 1;
  const torii = [
    [cx - 36, cy - 30, 72, 7], // kasagi
    [cx - 28, cy - 19, 56, 5], // nuki
    [cx - 22, cy - 26, 6, 52], // pillars
    [cx + 16, cy - 26, 6, 52],
    [cx - 2.5, cy - 24, 5, 6], // the plaque strut
  ];
  for (const [x, y, w, h] of torii) g.fillRect(x, y, w, h), g.strokeRect(x, y, w, h);
  g.fillStyle = gl;
  g.font = `600 13px ${FONTS.display}`;
  g.textAlign = 'center';
  g.letterSpacing = '2px';
  g.fillText('TAPSTONE', cx, cy + 72);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// The shared back texture.
let back = null;
export function backTexture() {
  if (!back) {
    const { c, tex } = canvasTexture(Math.round(FACE.w * S), Math.round(FACE.h * S));
    drawBack(c);
    tex.needsUpdate = true;
    back = ready(tex);
    onArtTheme(() => {
      drawBack(c);
      tex.needsUpdate = true;
    });
  }
  return back;
}

// A theme switch repaints every face that has a card on it.
onArtTheme(() => {
  for (const [c, rec] of painted) {
    if (!rec.card) continue;
    drawFace(c, rec.card);
    rec.tex.needsUpdate = true;
  }
});
