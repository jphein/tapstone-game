#!/usr/bin/env python3
"""Card art for set 1: paint prompts from the TOML, WebP downscales, and the promo cards' art swap.

The paintings come from grimoire's tools/cardart.py (`paint-azure`, gpt-image-1.5 on Azure Foundry),
run on katana, whose outputs stay in scratch/cardart-run/art/<slug>/ (full size, not in git). This
tool holds what tapstone owns: what each card's painting shows, and how it's cut down for the site
and the headset.

    tools/card_art.py prompts                      # JSON: one prompt per card in game/cards/set1/
    tools/card_art.py sidecar SIDECAR.json ID      # add the card's realm fields to a cardart sidecar
    tools/card_art.py webp SRC.png OUT.webp --box 550x440 [--max-bytes 80000]
    tools/card_art.py promo SVG ART.png            # put ART in the SVG card's picture window
    tools/card_art.py build ART_DIR [--video slug,…]   # all of the below, from ART_DIR/<slug>/scene.png

`build` writes site/c/<slug>/{index.html,art.webp} (960x640), the headset's
rust/tapstone-web/www/xr/public/cards/<id>.webp (twice its art window) and the two promo cards'
art (Cinder Whelp, Reef Archer). A slug in --video gets a <video> from /media/<slug>.mp4, which is
gitignored and deployed like the other clips (site/README.md).

Art direction: 0014 (painted scenes; the card's own subject). Realms: 0039. Tide's cards come from
the Deep Tides and Ember's from the Forge Peaks (JP's ruling, 2026-09-26); neutral cards from the
Hearthlands (JP's ruling, 2026-09-27). No other names are used.

Cards listed in game/cards/awaiting-art.toml have a prompt but no art yet: `build` skips them.
Python 3.11+ (tomllib) and Pillow with WebP.
"""
import argparse
import base64
import io
import json
import re
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

REALMS = {
    "tide": ("the Deep Tides", "ruled by JP, 2026-09-26 (0039): Tide's cards come from the Deep Tides"),
    "ember": ("the Forge Peaks", "ruled by JP, 2026-09-26 (0039): Ember's cards come from the Forge Peaks"),
    "neutral": ("the Hearthlands", "ruled by JP, 2026-09-27 (0039): the neutral cards come from the Hearthlands"),
}
# The cards with no art yet (0014 art costs Foundry credit and waits for JP): one list, which the
# headset's card-art test reads too.
AWAITING_ART = frozenset(tomllib.loads((REPO / "game" / "cards" / "awaiting-art.toml").read_text())["set1"])
# What each realm looks like. Only 0039's names; the look is ours, from the faction rulings.
SETTING = {
    "tide": "a realm of deep blue ocean water, drowned light, coral and pearl-pale sand",
    "ember": "a volcanic realm of black basalt peaks, rivers of lava and forge-glow under an ash-dark sky",
    "neutral": "a warm realm of green rolling hills, stone cottages and hearth-lit windows",
}
# The card's own subject (0014), by card id. Lower case, so every capital in a prompt is a name.
SUBJECTS = {
    "st1-000": "a fortress of dark basalt built into the flank of a volcano, lava channels glowing "
               "along its walls, ember-red banners snapping in the hot wind",
    "st1-001": "a castle of white coral and mother-of-pearl rising out of the sea, waves breaking "
               "against its towers, blue light glowing from its windows",
    "st1-002": "a small young fire dragon, a whelp, leaping from a lava ledge with its wings spread, "
               "sparks trailing from its jaws",
    "st1-003": "an armoured warrior in ash-grey plate with glowing ember seams, charging down a "
               "volcanic slope through a storm of falling ash, sword raised",
    "st1-004": "a broad, steadfast guardian with a great iron shield, standing firm before a forge-lit "
               "gate, planted and unmoving",
    "st1-005": "a bolt of fire bursting from a volcanic crater and arcing toward distant castle walls",
    "st1-006": "a hooded archer on a coral rock drawing a bow, the arrow made of shining seawater, "
               "waves beneath",
    "st1-007": "a robed sea-mage on a wave-washed rock, arms raised, calling the tide up into a "
               "towering wall of water",
    "st1-008": "a warrior holding a great round shield of iridescent pearl, a shimmering barrier of "
               "light around them, sunlight filtering down through the water",
    "st1-009": "a whip of seawater lashing out of a breaking wave, spray flying",
    "st1-010": "a spiralling undercurrent beneath the surface, dragging sand, shells and a fallen spear "
               "sideways through the dim water",
    "st1-011": "a traveller on a hillside at dawn, eyes closed, taking a slow deep breath of cool air, "
               "two softly glowing cards drifting down toward their open hands",
    "st1-012": "a healer's hands wrapping a softly glowing bandage around a wounded arm, beside a "
               "cottage hearth fire",
    "st1-013": "a violent rip current tearing out to sea, sweeping away small wooden rafts and "
               "driftwood in its churning foam",
    # #147's six (2026-09-27): prompts only. Their art waits for JP's OK (awaiting-art.toml).
    "st1-014": "a lean young runner sprinting along a narrow basalt ridge, a glowing ingot clutched to "
               "their chest, sparks streaming behind them",
    "st1-015": "a wiry raider bursting through a curtain of forge smoke, a great leather bellows on their "
               "back blasting a gout of flame ahead",
    "st1-016": "a hulking brute of cooled black slag with molten orange seams, lumbering out of a lava "
               "field, its fists dripping glowing rock",
    "st1-017": "a fountain of molten magma erupting from a split in the ground, glowing boulders arcing "
               "high toward distant fortress walls",
    "st1-018": "a small, nimble skimmer gliding over the wave tops on a shell board, flicking a sling of "
               "salt-crystal shot",
    "st1-019": "a vast armoured sea creature rising from a dark ocean trench, barnacled shell plates like "
               "a shield, pale eyes glowing in the deep",
}
STYLE = ("painted fantasy card illustration, rich visible brushwork, oil and gouache texture, "
         "dramatic light, the subject centred with room to crop the edges; no text, no letters, "
         "no border, no frame, no watermark")


def slug(name: str) -> str:
    """The same slug as grimoire's cardart.py, so art/<slug>/ lines up."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def prompts(set_dir: Path = REPO / "game" / "cards" / "set1") -> list[dict]:
    out = []
    for p in sorted(set_dir.glob("*.toml")):
        t = tomllib.loads(p.read_text())
        realm, basis = REALMS[t["faction"]]
        subject = SUBJECTS[t["id"]]
        out.append({
            "id": t["id"], "slug": slug(t["name"]), "name": t["name"], "faction": t["faction"],
            "type": t["type"], "realm": realm, "realm_basis": basis, "subject": subject, "toml": t,
            "prompt": f"{subject}, in {realm}, {SETTING[t['faction']]}. {STYLE}",
        })
    return out


def sidecar(meta: dict, card: dict) -> dict:
    """cardart's sidecar plus the card's id, name, faction and realm (and whether that is ruled)."""
    return {**meta, "card": card["id"], "name": card["name"], "faction": card["faction"],
            "realm": card["realm"], "realm_basis": card["realm_basis"],
            "art_direction": "docs/decisions/0014-art-direction.md, 0039-the-nexus-teahouse.md"}


def webp(im, box: tuple[int, int], max_bytes: int) -> bytes:
    """Centre-crop `im` to the box's aspect, resize to the box, and encode WebP within max_bytes."""
    from PIL import Image

    im = im.convert("RGB")
    bw, bh = box
    w, h = im.size
    if w * bh > h * bw:  # too wide: crop the sides
        cw = h * bw // bh
        im = im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h))
    else:
        ch = w * bh // bw
        im = im.crop((0, (h - ch) // 2, w, (h - ch) // 2 + ch))
    im = im.resize(box, Image.LANCZOS)
    for q in range(86, 4, -6):
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    raise ValueError(f"can't fit {box} in {max_bytes} bytes")


# Rules words, from the engine (tapstone-rules rules.rs; 0021 for targeting) and the promo page.
KEYWORDS = {
    "haste": "Haste: it can march forward on the very turn you summon it.",
    "rush": "Rush: it enters one cell forward of the back of its lane.",
    "taunt": "Taunt: every enemy attacker in its lane must hit it first.",
    "ranged": "Ranged: it shoots from anywhere in its lane and hits the nearest enemy.",
    "shield1": "Shield 1: it ignores one damage in each combat.",
}


def effect_text(effect: str) -> str:
    """The v0 effect grammar (docs/design/card-data-format.md) in words."""
    kind, *arg = effect.split(":")
    if kind == "damage":
        return f"Deal {arg[0]} damage to a unit{' or a castle' if arg[1] == 'castle' else ''}."
    if kind == "heal":
        return f"Heal a unit by {arg[0]}."
    if kind == "destroy":
        return f"Destroy a unit with toughness {arg[0]} or less."
    if kind == "shift":
        return "Move a unit one lane sideways."
    if kind == "draw":
        return f"Draw {arg[0]} cards."
    raise ValueError(f"no words for effect {effect}")


def rules_text(card: dict) -> str:
    t = card["toml"]
    if t["type"] == "castle":
        return "Your castle. Set it on your shrine to claim your seat. It starts with 20 health."
    if t["type"] == "spell":
        return effect_text(t["effect"])
    return " ".join(KEYWORDS[k] for k in t.get("keywords", [])) or "No keyword: a plain, sturdy unit."


def page(card: dict, video: bool) -> str:
    """site/c/<slug>/index.html, in the pattern of the other card pages. The sigil's meta tag
    is added at deploy by realm-sigil's build.sh (site/README.md)."""
    from html import escape

    t, s = card["toml"], card["slug"]
    kind = t["type"].capitalize()
    stats = f", {t['attack']} attack, {t['toughness']} toughness" if t["type"] == "unit" else ""
    art = f"/c/{s}/art.webp"
    alt = escape(f"Painted art for {card['name']}: {card['subject']}.")
    if video:
        media = (f'  <video src="/media/{s}.mp4" autoplay muted loop playsinline controls poster="{art}"></video>\n')
        clip = ("The animation was made from the painting with Veo on Vertex AI. ")
    else:
        media = f'  <img class="scene" src="{art}" alt="{alt}" width="960" height="640">\n'
        clip = ""
    realm = escape(card["realm"])
    ruled = re.search(r"\d{4}-\d\d-\d\d", card["realm_basis"])[0]
    basis = f"JP's ruling of {ruled} (decision 0039)."
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(card['name'])} · Tapstone</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/style.css">
</head><body><main>
<header><img src="/favicon.svg" alt=""><h1>{escape(card['name'])}<small>Tapstone set 1 · {t['id']} · {kind} · {t['faction'].capitalize()}</small></h1></header>
<section class="card">
{media}  <div class="text">
    <div>
      <p><strong>{kind} · {t['faction'].capitalize()}, cost {t['cost']}{stats}.</strong> {escape(rules_text(card))}</p>
      <p class="meta">The painting shows {escape(card['subject'])}, in {realm}. {clip}Painted with gpt-image-1.5 on Azure AI Foundry for Tapstone's first set. Not for sale.</p>
      <p class="meta">Realm: {realm}. {basis}</p>
    </div>
  </div>
</section>
<footer>Tapstone is a collectible card game played on small NFC shrines. This page is what the card's tag points at. <a href="/">Tapstone</a> · <a href="/promo/">What is Tapstone?</a></footer>
</main></body></html>
"""


PIC_OPEN = '<g clip-path="url(#pic)">'


def svg_with_art(svg: str, art_webp: bytes) -> str:
    """Replace the promo card's painting (the group clipped to #pic) with `art_webp`, filling the
    window. The frame, banner, sprite inset, cost, type line, keyword and stats are untouched."""
    start = svg.index(PIC_OPEN)
    depth, i = 0, start
    for m in re.finditer(r"<g[\s>]|</g>", svg[start:]):
        depth += -1 if m.group() == "</g>" else 1
        if depth == 0:
            i = start + m.end()
            break
    else:
        raise ValueError("unbalanced painting group")
    x, y, w, h = re.search(r'<clipPath id="pic"><rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"', svg).groups()
    b64 = base64.b64encode(art_webp).decode()
    group = (f'{PIC_OPEN}\n  <image href="data:image/webp;base64,{b64}" x="{x}" y="{y}" width="{w}" '
             f'height="{h}" preserveAspectRatio="xMidYMid slice"/>\n</g>')
    return svg[:start] + group + svg[i:]


BUDGET = 80_000  # "≤ 80 KB" each, read strictly: decimal bytes, not KiB
XR_CARDS = REPO / "rust" / "tapstone-web" / "www" / "xr" / "public" / "cards"
XR_ART = (392, 300)  # twice the hand face's art window (www/xr/src/logic/card-art.js; its test checks)
PROMO = {"st1-002": "card-ember.svg", "st1-006": "card-tide.svg"}


def build(art_dir: Path, video: set[str]) -> None:
    from PIL import Image

    cards = prompts()
    unknown = video - {c["slug"] for c in cards}
    if unknown:
        sys.exit(f"--video names no card: {', '.join(sorted(unknown))}")
    XR_CARDS.mkdir(parents=True, exist_ok=True)
    for c in cards:
        if c["id"] in AWAITING_ART:
            print(c["id"], c["slug"], "awaiting art (game/cards/awaiting-art.toml): skipped")
            continue
        im = Image.open(art_dir / c["slug"] / "scene.png")
        d = REPO / "site" / "c" / c["slug"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "art.webp").write_bytes(webp(im, (960, 640), BUDGET))
        (d / "index.html").write_text(page(c, video=c["slug"] in video))
        (XR_CARDS / f"{c['id']}.webp").write_bytes(webp(im, XR_ART, BUDGET))
        if c["id"] in PROMO:
            svg = REPO / "site" / "promo" / "art" / PROMO[c["id"]]
            svg.write_text(svg_with_art(svg.read_text(), webp(im, (550, 440), BUDGET)))
        print(c["id"], c["slug"], "video" if c["slug"] in video else "")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prompts")
    p = sub.add_parser("sidecar"); p.add_argument("path", type=Path); p.add_argument("id")
    p = sub.add_parser("webp"); p.add_argument("src", type=Path); p.add_argument("out", type=Path)
    p.add_argument("--box", required=True); p.add_argument("--max-bytes", type=int, default=BUDGET)
    p = sub.add_parser("promo"); p.add_argument("svg", type=Path); p.add_argument("art", type=Path)
    p = sub.add_parser("build"); p.add_argument("art_dir", type=Path); p.add_argument("--video", default="")
    a = ap.parse_args(argv)
    if a.cmd == "prompts":
        print(json.dumps(prompts(), indent=2))
    elif a.cmd == "sidecar":
        card = next(c for c in prompts() if c["id"] == a.id)
        a.path.write_text(json.dumps(sidecar(json.loads(a.path.read_text()), card), indent=2) + "\n")
    else:
        from PIL import Image

        if a.cmd == "build":
            build(a.art_dir, {v for v in a.video.split(",") if v})
        elif a.cmd == "webp":
            box = tuple(int(v) for v in a.box.split("x"))
            data = webp(Image.open(a.src), box, a.max_bytes)
            a.out.write_bytes(data)
            print(f"{a.out} {len(data)} B")
        else:
            data = webp(Image.open(a.art), (550, 440), BUDGET)
            a.svg.write_text(svg_with_art(a.svg.read_text(), data))
            print(f"{a.svg} art {len(data)} B")


if __name__ == "__main__":
    sys.exit(main())
