// The battlefield (arena spec §9). Draws the view model the arena pushes over SSE; no rules here.
//
// Every colour comes from a token in style.css, and every text colour is a `--X-ink` drawn on its
// ground `--X` — tests/web_contrast.rs holds each pair to its floor in both themes.
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const banner = document.getElementById("banner");
const params = new URLSearchParams(location.search);
const perspective = params.get("seat"); // null | "0" | "1"
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let view = null;
let prev = null;
let replayTag = ""; // dev replay only: "replay 12/79 · "
const flashes = new Map(); // "seat:lane:cell" -> expiry ms
let arrivals = new Set(); // "seat:lane:cell": units new since the previous model

// A chip's keyword in two letters: Ranged and Rush both start with R, and both are in set 1.
const KEYWORD_CODE = { Ranged: "Ra", Rush: "Ru", Haste: "Ha", Taunt: "Ta", Shield1: "Sh" };

// The remote seat's join code (0038), while joining is open: shown so the table can read it out.
// The still-open remote slots' join codes (one per slot; two when two players join from Roblox).
const codeTag = (v) => {
  const codes = (v && (v.remote_codes || (v.remote_code ? [v.remote_code] : []))) || [];
  if (!codes.length) return "";
  return ` · remote join code${codes.length > 1 ? "s" : ""} ${codes.join(" / ")}`;
};

function fit() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
}

// A font size in device pixels, never under 11 CSS px: the canvas scales with the window, and a
// phone must still read (JP's web rule: pages work at ~400 px).
const px = (size) => Math.max(Math.round(size), Math.round(11 * devicePixelRatio));
const font = (size, weight = "") => `${weight} ${px(size)}px system-ui`;

// Draw `text` at `size`, shrinking toward the floor and then compressing, so it never overruns
// `maxW` — a castle band's line must fit a phone.
function fitText(text, x, y, maxW, size, weight = "") {
  let s = size;
  ctx.font = font(s, weight);
  while (ctx.measureText(text).width > maxW && px(s) > px(0)) {
    s *= 0.92;
    ctx.font = font(s, weight);
  }
  ctx.fillText(text, x, y, maxW);
}

// State only the view needs is computed by diffing consecutive models (0027 amendment, spec §9):
// the strike flash, arrival markers, and the commander's "returns in N".
function diff(a, b) {
  arrivals = new Set();
  if (!a || !b || !a.seats.length || !b.seats.length) return;
  const now = performance.now();
  b.seats.forEach((seat, s) => seat.cells.forEach((lane, l) => lane.forEach((u, c) => {
    const was = a.seats[s].cells[l][c];
    const key = `${s}:${l}:${c}`;
    const arrived = u && (!was || u.name !== was.name);
    if (arrived) arrivals.add(key);
    if (arrived || (u && was && u.damage !== was.damage)) flashes.set(key, now + 150);
  })));
}

function returnsText(seat, round) {
  if (!seat.commander_returns) return "";
  const n = seat.commander_returns - round;
  if (n > 0) return `♛ returns in ${n}`;
  if (n === 0) return "♛ returns now";
  return "♛ waiting"; // past its round: its back cell is taken (0029)
}

function unitRect(x, y, w, h, u, asChip, lit, isNew) {
  ctx.fillStyle = css("--tile");
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = css(`--${u.faction}`) || css("--neutral");
  ctx.lineWidth = (u.commander ? 4 : 2) * devicePixelRatio;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = css("--tile-ink");
  const hp = u.toughness - u.damage;
  const crest = u.commander ? "♛ " : "";
  if (asChip) {
    // 0027: theirs are entries. A chip reads quieter than the viewer's own objects (its line is
    // no bigger than an object's stat line) and keeps the crest, one of spec §9's ownership cues.
    const kw = u.keyword ? ` ${KEYWORD_CODE[u.keyword] || u.keyword}` : "";
    fitText(`${crest}${u.attack}/${hp}${kw}`, x + 6, y + h * 0.62, w - 12, h * 0.26);
  } else {
    fitText(crest + u.name, x + 6, y + h * 0.25, w - 12, h * 0.18);
    fitText(`${u.attack} / ${hp}`, x + 6, y + h * 0.62, w - 12, h * 0.3);
    if (u.keyword) fitText(u.keyword, x + 6, y + h * 0.88, w - 12, h * 0.16);
    // damage bar
    ctx.fillStyle = css("--danger");
    ctx.fillRect(x, y + h - 4 * devicePixelRatio, w * (u.damage / Math.max(1, u.toughness)), 4 * devicePixelRatio);
  }
  if (isNew) {
    // Arrival marker: a small tag on the tile's top-right corner, in the rim colour.
    const t = "new";
    ctx.font = font(h * 0.16, "700");
    const tw = ctx.measureText(t).width + 8;
    ctx.fillStyle = css("--tag");
    ctx.fillRect(x + w - tw, y, tw, px(h * 0.16) + 6);
    ctx.fillStyle = css("--tag-ink");
    ctx.fillText(t, x + w - tw + 4, y + px(h * 0.16) + 1);
  }
  if (lit) {
    // The strike flash is a rim, never a fill: a fill over the numbers washed them from ~13:1 to
    // ~4.5:1 and, on the light theme, changed the tile by 1.06:1 — invisible.
    ctx.strokeStyle = css("--tile-rim-ink");
    ctx.lineWidth = 5 * devicePixelRatio;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  }
}

function draw() {
  fit();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!view || !view.seats.length) {
    const seated = view ? view.lobby.length : 0;
    // The finished board stays up until someone claims for the next match; then the lobby wins.
    const shown = view && seated === 0 && view.last_over;
    if (shown) { const v = view; view = shown; draw(); view = v; statusEl.textContent += codeTag(v); return; }
    ctx.fillStyle = css("--board-ink");
    fitText(`Lobby: ${seated} of 2 castles set on their stones`, W * 0.06, H * 0.5, W * 0.88, H * 0.05);
    statusEl.textContent = replayTag + "lobby" + codeTag(view);
    return;
  }
  const portrait = H > W;
  const pad = W * 0.02, band = H * (portrait ? 0.09 : 0.1);
  const laneW = (W - pad * 4) / 3;
  // A gutter between the two seats' tracks holds the lane labels (they used to sit on the cell
  // borders) and marks the front line where the two sides meet.
  const gutter = H * 0.045;
  const cellH = (H - band * 2 - pad * 2 - gutter) / 6;
  const now = performance.now();
  // Seat 1's castle band at the top, seat 0's at the bottom: the side of the board is one of the
  // three ownership cues (spec §9).
  [1, 0].forEach((s, i) => {
    const seat = view.seats[s];
    const y = i === 0 ? pad : H - pad - band;
    const active = view.active === s;
    ctx.fillStyle = css(active ? "--band-active" : "--band-idle");
    ctx.fillRect(pad, y, W - pad * 2, band);
    ctx.fillStyle = css(active ? "--band-active-ink" : "--band-idle-ink");
    const owed = seat.owed_draws ? `drawing ${seat.owed_draws}` : ""; // 0036, spec §5.3
    const parts = [`${seat.castle}  ♥ ${seat.life}`, `mana ${seat.charged - seat.spent}/${seat.charged}`,
      `hand ${seat.hand}`, `deck ${seat.deck_left}`, owed, returnsText(seat, view.round)].filter(Boolean);
    if (portrait) {
      // Two lines on a phone: who and how alive, then the rest.
      fitText(parts[0], pad * 2, y + band * 0.42, W - pad * 4, band * 0.34, "600");
      fitText(parts.slice(1).join("   "), pad * 2, y + band * 0.82, W - pad * 4, band * 0.26);
    } else {
      fitText(parts.join("   "), pad * 2, y + band * 0.65, W - pad * 4, band * 0.4);
    }
  });
  for (let l = 0; l < 3; l++) {
    const x = pad * 2 + l * laneW;
    ctx.fillStyle = css("--board-ink");
    fitText(`lane ${l + 1}`, x + 4, pad + band + cellH * 3 + gutter * 0.72, laneW - pad, gutter * 0.62);
    // Seat 0's track runs up from the bottom (back cell nearest its castle), seat 1's down from the top.
    for (let s = 0; s < 2; s++) {
      for (let c = 0; c < 3; c++) {
        const row = s === 0 ? 5 - c : c;
        const y = pad + band + row * cellH + (row >= 3 ? gutter : 0);
        const u = view.seats[s].cells[l][c];
        ctx.strokeStyle = css("--grid");
        ctx.lineWidth = devicePixelRatio;
        ctx.strokeRect(x, y + 2, laneW - pad, cellH - 4);
        if (u) {
          const asChip = perspective !== null && Number(perspective) !== s; // 0027: theirs are entries
          const w = asChip ? (laneW - pad) * 0.5 : laneW - pad;
          const key = `${s}:${l}:${c}`;
          unitRect(x, y + 2, w, cellH - 4, u, asChip, (flashes.get(key) || 0) > now, arrivals.has(key));
        }
      }
    }
  }
  statusEl.textContent = replayTag +
    `match ${view.match_id} · round ${view.round} · seat ${view.active} to act · #${view.seq}` +
    (view.head ? ` · ${view.head}` : "") + codeTag(view);
}

// A text summary of the board for assistive tech (and anyone with the canvas off). A cardless
// event (advance, pass, mulligan) carries no card, so none is named.
function summarise(v) {
  const board = v.phase === "lobby" && !v.lobby.length && v.last_over ? v.last_over : v;
  if (!board.seats || !board.seats.length) return `Lobby: ${v.lobby.length} of 2 castles set on their stones.`;
  const castles = board.seats.map((s) => `${s.castle} ${s.life} life`).join(", ");
  const last = board.last ? ` Last: seat ${board.last.seat} ${board.last.kind}${board.last.card ? " " + board.last.card : ""}.` : "";
  if (board.phase === "over") {
    const who = board.winner !== null && board.winner !== undefined ? `Seat ${board.winner} wins` : "The match is void";
    return `${who}. ${castles}.`;
  }
  return `Round ${board.round}, seat ${board.active} to act. ${castles}.${last}`;
}

function show(v) {
  prev = view;
  view = v;
  diff(prev, view);
  // After a result the arena is back in the lobby with the finished board kept (last_over): the
  // banner follows the board on screen, so "Seat N wins" shows until the next match forms.
  const board = v.phase === "lobby" && !v.lobby.length && v.last_over ? v.last_over : v;
  const bannerText = { paused: "Link lost: the match is paused", resuming: "The arena is back: catching up…", over: board.winner !== null && board.winner !== undefined ? `Seat ${board.winner} wins` : "Desync: the match is void" }[board.phase];
  banner.hidden = !bannerText;
  banner.textContent = bannerText || "";
  summaryEl.textContent = summarise(v);
  draw();
  setTimeout(draw, 160); // clear the flash
}

function connect() {
  const es = new EventSource("events");
  es.onmessage = (e) => show(JSON.parse(e.data));
  es.onerror = () => { statusEl.textContent = "arena unreachable: retrying"; es.close(); setTimeout(connect, 1000); };
}

// Dev only: replay a recorded match (JSON lines, one view model per committed record) instead of
// the live stream, so the page can be checked against real engine output without the arena (0027's
// method). ?replay=<url> steps through it; &at=N holds frame N (diffed against N-1, so its flashes
// and arrivals show); &hold keeps flashes lit for a still screenshot. Absent ?replay, nothing here
// runs. The arena serves only the page's four files, so replay needs a local static server.
async function replay(url) {
  const lines = (await (await fetch(url)).text()).trim().split("\n").map((l) => JSON.parse(l));
  const at = params.get("at");
  if (at !== null) {
    const n = Math.max(0, Math.min(lines.length - 1, Number(at)));
    replayTag = `replay ${n + 1}/${lines.length} · `;
    if (n > 0) view = lines[n - 1];
    show(lines[n]);
    if (params.has("hold")) for (const k of flashes.keys()) flashes.set(k, Infinity);
    draw();
    return;
  }
  let n = 0;
  const step = () => {
    replayTag = `replay ${n + 1}/${lines.length} · `;
    show(lines[n]);
    n = (n + 1) % lines.length;
    setTimeout(step, 600);
  };
  step();
}

addEventListener("resize", draw);
// Colours are read from the CSS at draw time, so a theme switch mid-match must redraw now, not at
// the next committed record.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
if (params.has("replay")) replay(params.get("replay"));
else connect();
