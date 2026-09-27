#!/usr/bin/env python3
"""Print-ready card faces for a Tapstone set: one PDF per card (trim + bleed) and 3x3 US Letter sheets with cut marks.

  tools/print_cards.py --art <dir> --out <dir>           every card in game/cards/set1
  tools/print_cards.py --art <dir> --out <dir> st1-002   just these ids

Art: <art>/<slug>/scene.png, where slug is the card name lower-cased and hyphenated ("Cinder Whelp" → cinder-whelp);
the 1536x1024 painted scenes from the cardart run. Nothing is sent to a printer.

The pipeline is realm-cards' (~/Projects/printing/realm-cards/make-cards.py, printing@9be9b57): the face is laid out
in HTML (tools/print_card.html, adapted from realm-cards/card.html) and rendered by headless Chrome at 8x, then
downsampled once onto the Epson's native 360 dpi grid; the sheet is Letter at 360 dpi, 3x3 with 2 mm gutters centred
in the printable area, with chop-cutter guide lines like ../photocards.py. What is new here is the bleed:

  card PDF  69 x 94 mm = 63 x 88 mm trim + 3 mm bleed a side. The frame ground runs out to the bleed edge, so a cut
            up to 3 mm off still lands on frame, never on white.
  sheet     trim boxes on realm-cards' grid; each card keeps 1 mm of its bleed into each 2 mm gutter (so the gutters
            are fully inked), 3 mm at the sheet's left and right, and at top and bottom only what the printable area
            leaves after room for the cut marks (Letter is 279.4 mm; three 88 mm cards plus gutters take 268).

Frame colours: the card's realm door in roblox/src/shared/TeaHouseLayout.luau, read from that file rather than copied
(all three are JP's rulings, 0039: Ember ↔ the Forge Peaks and Tide ↔ the Deep Tides on 2026-09-26, neutral ↔ the
Hearthlands on 2026-09-27). Rules text is derived from the engine (rust/tapstone-rules/src/rules.rs): Rush enters the mid cell,
Haste may advance the round it enters, Shield 1 takes 1 less combat damage, Taunt draws the lane's attackers, Ranged
hits the nearest enemy in the lane. Cards on game/cards/awaiting-art.toml have no painting yet
and are skipped.
"""
import sys

if sys.version_info < (3, 11):
    sys.exit("print_cards.py needs Python 3.11+ (tomllib)")

import argparse
import os
import re
import subprocess
import tempfile
import tomllib
import urllib.parse
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent
TEMPLATE = Path(__file__).resolve().parent / "print_card.html"
LAYOUT = REPO / "roblox/src/shared/TeaHouseLayout.luau"
CHROME = os.environ.get("CHROME_BIN", "google-chrome")

DPI = 360                          # the Epson's native grid (realm-cards)
TRIM_MM = (63.0, 88.0)             # 0014: the realm-cards template
BLEED_MM = 3.0
CARD_MM = (TRIM_MM[0] + 2 * BLEED_MM, TRIM_MM[1] + 2 * BLEED_MM)
PAGE_PX = (3060, 3960)             # Letter at 360 dpi (realm-cards)
PRINTABLE = (42, 42, 3018, 3918)   # 8.4 pt margins (realm-cards)
COLS, ROWS, GUTTER_MM = 3, 3, 2.0  # realm-cards
MARK_MM = 1.0                      # cut-mark room kept at the top and bottom of the printable area
SCALE = 8                          # Chrome device scale factor (realm-cards)

AWAITING_ART = frozenset(tomllib.loads((REPO / "game/cards/awaiting-art.toml").read_text())["set1"])
FACTION_DOOR = {"ember": "forgepeaks", "tide": "deeptides", "neutral": "hearthlands"}
KEYWORD_TEXT = {
    "haste": ("Haste", "may advance the round it enters."),
    "rush": ("Rush", "enters its lane's mid cell."),
    "taunt": ("Taunt", "enemy attackers in its lane must strike it."),
    "ranged": ("Ranged", "strikes the nearest enemy in its lane."),
    "shield1": ("Shield 1", "takes 1 less damage each combat."),
}
EFFECT_TEXT = [
    (re.compile(r"^damage:([0-9]+):castle$"), lambda m: f"Deal {m[1]} damage to a unit or a castle."),
    (re.compile(r"^damage:([0-9]+):unit$"), lambda m: f"Deal {m[1]} damage to a unit."),
    (re.compile(r"^heal:([0-9]+):unit$"), lambda m: f"Heal {m[1]} damage from a unit."),
    (re.compile(r"^destroy:([0-9]+)$"), lambda m: f"Destroy a unit with toughness {m[1]} or less."),
    (re.compile(r"^shift$"), lambda m: "Move a unit one lane over."),
    (re.compile(r"^draw:([0-9]+)$"), lambda m: f"Draw {['no', 'one', 'two', 'three'][int(m[1])]} cards."
                                                  if int(m[1]) != 1 else "Draw a card."),
]


def mm(x):
    return round(x / 25.4 * DPI)


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def doors(path=LAYOUT):
    """{door id: ((r, g, b) door colour, (r, g, b) weather)} parsed from the Tea House layout, the one source."""
    out = {}
    for m in re.finditer(r'id = "(\w+)", realm = "([^"]+)".*?color = \{ ([\d, ]+) \}, weather = \{ ([\d, ]+) \}',
                         Path(path).read_text()):
        out[m[1]] = (m[2], tuple(int(x) for x in m[3].split(",")), tuple(int(x) for x in m[4].split(",")))
    missing = set(FACTION_DOOR.values()) - out.keys()
    if missing:
        raise SystemExit(f"!! {path}: no door for {sorted(missing)} — the frame colours have no source")
    return out


def rules_text(card):
    if card["type"] == "unit":
        kws = card.get("keywords", [])
        return "|".join(f"**{KEYWORD_TEXT[k][0]}** _— {KEYWORD_TEXT[k][1]}_" for k in kws) or "_A steady body in any lane._"
    if card["type"] == "spell":
        for rx, fn in EFFECT_TEXT:
            if m := rx.match(card["effect"]):
                return fn(m)
        raise SystemExit(f"!! {card['id']}: no rules text for effect {card['effect']!r}")
    return "Your castle stands behind your three lanes and starts the match at 20.|_Set it on your shrine._"


def card_params(card, art, door_table):
    realm, door, glow = door_table[FACTION_DOOR[card["faction"]]]
    realm = realm.removeprefix("The ")
    p = {
        "name": card["name"], "cost": str(card["cost"]), "art": Path(art).resolve().as_uri(),
        "type": f"{card['type'].capitalize()} — {realm}", "rarity": card.get("rarity", "common"),
        "ability": rules_text(card), "door": ",".join(map(str, door)), "glow": ",".join(map(str, glow)),
        "left": f"{card['id']} · {card.get('rarity', 'common')}", "right": "TAPSTONE · SET 1",
        "pt": f"{card['attack']}/{card['toughness']}" if card["type"] == "unit" else "",
    }
    return p


def _chrome(params, *args):
    w, h = CARD_MM
    url = TEMPLATE.as_uri() + "?" + urllib.parse.urlencode(params)
    return subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
                           f"--window-size={int(w / 25.4 * 96 + 1)},{int(h / 25.4 * 96 + 1)}",
                           f"--force-device-scale-factor={SCALE}", "--virtual-time-budget=15000", *args, url],
                          check=True, capture_output=True, text=True, timeout=120)


def render_face(params, tmp):
    """The card with bleed, CARD_MM on the 360 dpi grid. Raises if the template reports clipped text."""
    title = re.search(r"<title>(\w+)</title>", _chrome(params, "--dump-dom").stdout)
    if not title or title[1] != "READY":
        raise RuntimeError(f"{params['name']}: template says {title[1] if title else 'nothing'} (text does not fit)")
    png = os.path.join(tmp, slug(params["name"]) + ".png")
    _chrome(params, "--screenshot=" + png)
    try:
        shot = Image.open(png).convert("RGB")
    except OSError as e:   # seen on familiar, 2026-09-27: a full /tmp truncates the PNG and Chrome still exits 0
        raise RuntimeError(f"{params['name']}: unreadable screenshot {png} ({e}); is its filesystem full?") from e
    css = [round(x / 25.4 * 96 * SCALE) for x in CARD_MM]          # the card's own pixels, not the window's spare edge
    return shot.crop((0, 0, *css)).resize((mm(CARD_MM[0]), mm(CARD_MM[1])), Image.LANCZOS)


def save_pdf(im, path, size_mm):
    """PDF whose page is exactly size_mm: the resolution is chosen per axis so the pixel grid spans the page."""
    im.save(path, "PDF", dpi=(im.width * 25.4 / size_mm[0], im.height * 25.4 / size_mm[1]))


def page_mm(path):
    """(width, height) in mm of every page's MediaBox, read from the PDF bytes."""
    boxes = re.findall(rb"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]", Path(path).read_bytes())
    return [((float(x1) - float(x0)) * 25.4 / 72, (float(y1) - float(y0)) * 25.4 / 72) for x0, y0, x1, y1 in boxes]


def sheet_geometry():
    """Trim origin of the grid and the bleed the sheet keeps on each side of a card, in pixels."""
    cw, ch, g = mm(TRIM_MM[0]), mm(TRIM_MM[1]), mm(GUTTER_MM)
    gw, gh = COLS * cw + (COLS - 1) * g, ROWS * ch + (ROWS - 1) * g
    x0 = (PRINTABLE[0] + PRINTABLE[2] - gw) // 2
    y0 = (PRINTABLE[1] + PRINTABLE[3] - gh) // 2
    inner = g // 2
    outer_x = min(mm(BLEED_MM), x0 - PRINTABLE[0] - mm(MARK_MM))
    outer_y = min(mm(BLEED_MM), y0 - PRINTABLE[1] - mm(MARK_MM))
    return cw, ch, g, x0, y0, gw, gh, inner, outer_x, outer_y


def compose_sheet(faces):
    """One Letter page: faces (with bleed) on realm-cards' 3x3 grid, cut lines at every trim edge in the margins."""
    cw, ch, g, x0, y0, gw, gh, inner, ox, oy = sheet_geometry()
    b = mm(BLEED_MM)
    page = Image.new("RGB", PAGE_PX, "white")
    for k, face in enumerate(faces):
        c, r = k % COLS, k // COLS
        # a gutter is shared only with a card actually there: on a part-filled sheet the last cards keep full bleed
        right_n, below_n = k + 1 < len(faces) and c < COLS - 1, k + COLS < len(faces)
        left, right = (ox if c == 0 else inner), (ox if c == COLS - 1 else inner if right_n else b)
        top, bottom = (oy if r == 0 else inner), (oy if r == ROWS - 1 else inner if below_n else b)
        piece = face.crop((b - left, b - top, b + cw + right, b + ch + bottom))
        page.paste(piece, (x0 + c * (cw + g) - left, y0 + r * (ch + g) - top))
    # Chop-cutter guides (photocards.py): every trim edge extended as a line through the page margin, outside the ink.
    d, ink, lw = ImageDraw.Draw(page), (40, 40, 40), mm(0.2)
    xs = sorted({x0 + c * (cw + g) for c in range(COLS)} | {x0 + c * (cw + g) + cw for c in range(COLS)})
    ys = sorted({y0 + r * (ch + g) for r in range(ROWS)} | {y0 + r * (ch + g) + ch for r in range(ROWS)})
    for x in xs:
        d.line([(x, PRINTABLE[1]), (x, y0 - oy - 1)], fill=ink, width=lw)
        d.line([(x, y0 + gh + oy + 1), (x, PRINTABLE[3])], fill=ink, width=lw)
    for y in ys:
        d.line([(PRINTABLE[0], y), (x0 - ox - 1, y)], fill=ink, width=lw)
        d.line([(x0 + gw + ox + 1, y), (PRINTABLE[2], y)], fill=ink, width=lw)
    return page


def load_cards(set_dir, ids=None):
    cards = [tomllib.loads(p.read_text()) for p in sorted(Path(set_dir).glob("*.toml"))]
    if ids:
        unknown = set(ids) - {c["id"] for c in cards}
        if unknown:
            raise SystemExit(f"!! no such card: {sorted(unknown)}")
        cards = [c for c in cards if c["id"] in ids]
    return cards


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--set", default=str(REPO / "game/cards/set1"))
    ap.add_argument("--art", required=True, help="dir holding <slug>/scene.png")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sheet-name", default="set1-sheet")
    a = ap.parse_args(argv)
    cards, table = load_cards(a.set, a.ids), doors()
    # A card on game/cards/awaiting-art.toml has no painting yet (#147): asked for by id it is refused,
    # in a whole-set run it is skipped and named. Any other card without its scene still stops the run.
    awaiting = [c for c in cards if c["id"] in AWAITING_ART]
    if awaiting and a.ids:
        raise SystemExit(f"!! awaiting art (game/cards/awaiting-art.toml): {', '.join(c['name'] for c in awaiting)}")
    for c in awaiting:
        print(f"  {c['id']} {c['name']:20s} skipped: awaiting art", file=sys.stderr)
    cards = [c for c in cards if c["id"] not in AWAITING_ART]
    missing = [c["name"] for c in cards if not (Path(a.art) / slug(c["name"]) / "scene.png").is_file()]
    if missing:
        raise SystemExit(f"!! no scene.png for: {', '.join(missing)}")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    faces = []
    with tempfile.TemporaryDirectory(dir=out) as tmp:   # ~4 MB a screenshot: beside the output, never a small /tmp
        for c in cards:
            s = slug(c["name"])
            face = render_face(card_params(c, Path(a.art) / s / "scene.png", table), tmp)
            base = out / f"{c['id']}-{s}"
            save_pdf(face, f"{base}.pdf", CARD_MM)
            face.save(f"{base}.png")
            faces.append(face)
            print(f"  {c['id']} {c['name']:20s} {base}.pdf", file=sys.stderr)
    per = COLS * ROWS
    pages = [compose_sheet(faces[i:i + per]) for i in range(0, len(faces), per)]
    sheet = out / f"{a.sheet_name}.pdf"
    pages[0].save(sheet, "PDF", save_all=True, append_images=pages[1:], resolution=DPI)
    for n, p in enumerate(pages, 1):
        p.save(out / f"{a.sheet_name}-{n}.png")
    print(sheet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
