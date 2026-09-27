"""tools/card_art.py: prompts from the set's TOML, WebP downscales, the promo cards' art swap.

Run: python3 -m unittest tools/test_card_art.py (Python 3.11+, Pillow with WebP).
"""
import io
import json
import random
import re
import sys
import tomllib
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import card_art  # noqa: E402

from PIL import Image  # noqa: E402

SET1 = sorted((card_art.REPO / "game" / "cards" / "set1").glob("*.toml"))
# The realms 0039 names; nothing else may appear as a proper name in a prompt.
REALMS_0039 = ("the Hearthlands", "the Deep Tides", "the Forge Peaks", "the Wandering Courts",
               "the Star Fields", "the Dreaming")


class Prompts(unittest.TestCase):
    def setUp(self):
        self.cards = card_art.prompts()
        self.by_id = {c["id"]: c for c in self.cards}

    def test_one_prompt_per_card_file(self):
        ids = [tomllib.loads(p.read_text())["id"] for p in SET1]
        self.assertEqual(len(ids), 14)
        self.assertEqual(sorted(self.by_id), sorted(ids))

    def test_realm_follows_faction_per_0039(self):
        for p in SET1:
            t = tomllib.loads(p.read_text())
            c = self.by_id[t["id"]]
            want = {"tide": "the Deep Tides", "ember": "the Forge Peaks", "neutral": "the Hearthlands"}[t["faction"]]
            self.assertEqual(c["realm"], want, t["id"])
            self.assertIn(want, c["prompt"], t["id"])
            self.assertEqual(c["faction"], t["faction"])
            self.assertEqual(c["name"], t["name"])

    def test_neutral_realm_is_a_proposal_and_factions_are_rulings(self):
        n = [c for c in self.cards if c["faction"] == "neutral"]
        self.assertEqual(len(n), 2)  # Deep Breath, Mend
        for c in self.cards:
            if c["faction"] == "neutral":
                self.assertTrue(c["realm_basis"].startswith("PROPOSAL"), c["id"])
            else:
                self.assertIn("ruled by JP", c["realm_basis"], c["id"])
                self.assertNotIn("PROPOSAL", c["realm_basis"], c["id"])

    def test_no_invented_proper_names(self):
        # Every capitalised word must come from the card's own name or its 0039 realm.
        for c in self.cards:
            allowed = set(c["name"].split()) | set(c["realm"].split())
            caps = set(re.findall(r"\b[A-Z][a-z]+\b", c["prompt"]))
            self.assertEqual(caps - allowed, set(), c["id"])
            self.assertIn(c["realm"], REALMS_0039)

    def test_painted_scene_without_text(self):
        # 0014: a painted scene; the frame, name and stats are drawn by us, never by the model.
        for c in self.cards:
            self.assertIn("painted", c["prompt"])
            self.assertIn("no text", c["prompt"])

    def test_slug_matches_cardart(self):
        self.assertEqual(self.by_id["st1-008"]["slug"], "pearl-shieldbearer")
        self.assertEqual(self.by_id["st1-000"]["slug"], "ember-castle")


def _noisy(w, h, seed=1):
    r = random.Random(seed)
    return Image.frombytes("RGB", (w, h), bytes(r.randrange(256) for _ in range(w * h * 3)))


class Webp(unittest.TestCase):
    def test_fits_budget_and_box(self):
        # Pure noise is the worst case for any encoder: the budget must still hold.
        out = card_art.webp(_noisy(1536, 1024), (550, 440), card_art.BUDGET)
        self.assertLessEqual(len(out), card_art.BUDGET)
        im = Image.open(io.BytesIO(out))
        self.assertEqual((im.format, im.size), ("WEBP", (550, 440)))

    def test_crop_is_centred(self):
        src = Image.new("RGB", (300, 100), "red")
        src.paste(Image.new("RGB", (100, 100), "blue"), (100, 0))
        im = Image.open(io.BytesIO(card_art.webp(src, (50, 50), card_art.BUDGET))).convert("RGB")
        r, g, b = im.getpixel((25, 25))
        self.assertGreater(b, 200)
        self.assertLess(r, 60)


class PromoSvg(unittest.TestCase):
    SVG = (card_art.REPO / "site" / "promo" / "art" / "card-ember.svg").read_text()

    def test_painting_replaced_frame_and_stats_kept(self):
        art = card_art.webp(_noisy(64, 64), (550, 440), card_art.BUDGET)
        out = card_art.svg_with_art(self.SVG, art)
        self.assertIn('<image href="data:image/webp;base64,', out)
        self.assertNotIn('fill="url(#sky)"', out)  # the hand-drawn painting is gone
        for kept in ("Cinder Whelp", "Haste", "st1-002", 'clip-path="url(#pic)"', "pixel sprite inset",
                     "cost gem", "attack and toughness"):
            self.assertIn(kept, out)
        self.assertEqual(out.count("<g clip-path=\"url(#pic)\">"), 1)

    def test_idempotent_on_its_own_output(self):
        a = card_art.webp(_noisy(64, 64, 1), (550, 440), card_art.BUDGET)
        b = card_art.webp(_noisy(64, 64, 2), (550, 440), card_art.BUDGET)
        once = card_art.svg_with_art(self.SVG, a)
        twice = card_art.svg_with_art(once, b)
        self.assertEqual(twice, card_art.svg_with_art(self.SVG, b))


class Sidecar(unittest.TestCase):
    def test_merge_adds_card_fields(self):
        base = {"model": "gpt-image-1.5", "prompt": "p", "size": "1536x1024"}
        c = card_art.prompts()[11]
        out = card_art.sidecar(base, c)
        self.assertEqual(out["model"], "gpt-image-1.5")
        self.assertEqual((out["card"], out["realm"]), (c["id"], c["realm"]))
        self.assertTrue(out["realm_basis"].startswith("PROPOSAL"))
        json.dumps(out)


class Pages(unittest.TestCase):
    def setUp(self):
        self.by_id = {c["id"]: c for c in card_art.prompts()}

    def test_unit_page_has_rules_realm_and_art(self):
        c = self.by_id["st1-002"]
        html = card_art.page(c, video=False)
        for want in ("<title>Cinder Whelp · Tapstone</title>", "st1-002", "Unit · Ember", "cost 1",
                     "2 attack, 1 toughness", "Haste:", "the Forge Peaks", 'src="/c/cinder-whelp/art.webp"',
                     'href="/favicon.svg"', 'href="/style.css"'):
            self.assertIn(want, html)
        self.assertNotIn("<video", html)
        self.assertNotIn("PROPOSAL", html)
        # site/style.css sizes these: an unstyled 960 px img overflows the card on narrow screens
        self.assertIn('<img class="scene"', html)
        css = (card_art.REPO / "site" / "style.css").read_text()
        self.assertIn(".card>img.scene{", css.replace(" ", ""))
        self.assertIn(".card>.text{", css.replace(" ", ""))

    def test_spell_page_explains_its_effect(self):
        self.assertIn("Deal 3 damage to a unit.", card_art.page(self.by_id["st1-009"], video=False))
        self.assertIn("Deal 2 damage to a unit or a castle.", card_art.page(self.by_id["st1-005"], video=False))
        self.assertIn("Destroy a unit with toughness 2 or less.", card_art.page(self.by_id["st1-013"], video=False))

    def test_every_effect_and_keyword_has_words(self):
        for c in self.by_id.values():
            self.assertTrue(card_art.rules_text(c), c["id"])

    def test_neutral_page_says_proposal(self):
        self.assertIn("PROPOSAL", card_art.page(self.by_id["st1-012"], video=False))

    def test_video_only_when_asked_and_from_media(self):
        html = card_art.page(self.by_id["st1-006"], video=True)
        self.assertIn('<video src="/media/reef-archer.mp4"', html)
        self.assertIn('poster="/c/reef-archer/art.webp"', html)

    def test_no_third_party_requests(self):
        # Any attribute (src, href, poster), on both layouts.
        for c in self.by_id.values():
            for video in (False, True):
                self.assertNotRegex(card_art.page(c, video=video), r'[a-z]="(https?:)?//')


class Committed(unittest.TestCase):
    """What `build` wrote and git holds: stale or missing outputs fail here."""

    def test_pages_and_site_art(self):
        cards = card_art.prompts()
        self.assertEqual(len(cards), 14)
        for c in cards:
            d = card_art.REPO / "site" / "c" / c["slug"]
            html = (d / "index.html").read_text()
            self.assertEqual(html, card_art.page(c, video="<video" in html), c["slug"])
            self.assertLessEqual((d / "art.webp").stat().st_size, card_art.BUDGET, c["slug"])
            self.assertEqual(Image.open(d / "art.webp").size, (960, 640), c["slug"])

    def test_promo_cards_carry_the_painting(self):
        for svg in card_art.PROMO.values():
            text = (card_art.REPO / "site" / "promo" / "art" / svg).read_text()
            self.assertEqual(text.count('<image href="data:image/webp;base64,'), 1, svg)


if __name__ == "__main__":
    unittest.main()
