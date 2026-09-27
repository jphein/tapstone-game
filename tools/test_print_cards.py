#!/usr/bin/env python3
"""Tests for tools/print_cards.py. Run: python3 tools/test_print_cards.py (needs google-chrome, or CHROME_BIN).

Renders a real set-1 card through the real template and Chrome, with a synthetic scene in place of the painted art
(the paintings live outside git), then reads the page size back out of the PDF bytes.
"""
import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import print_cards as pc  # noqa: E402

TOL_MM = 0.001   # realm-cards' plain resolution=360 gives 69.003 x 93.980 mm; this must see that


class PrintCards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR", "/var/tmp"))   # /tmp is small RAM
        cls.dir = Path(cls.tmp.name)
        cls.card = tomllib.loads((pc.REPO / "game/cards/set1/st1-008.toml").read_text())   # longest name in set 1
        art = cls.dir / "art" / pc.slug(cls.card["name"])
        art.mkdir(parents=True)
        Image.new("RGB", (1536, 1024), (90, 140, 200)).save(art / "scene.png")
        pc.main(["--art", str(cls.dir / "art"), "--out", str(cls.dir / "out"), cls.card["id"]])
        cls.pdf = cls.dir / "out" / f"{cls.card['id']}-{pc.slug(cls.card['name'])}.pdf"

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_card_pdf_page_is_69_by_94_mm(self):
        pages = pc.page_mm(self.pdf)
        self.assertEqual(len(pages), 1)
        (w, h), = pages
        self.assertAlmostEqual(w, 69.0, delta=TOL_MM)
        self.assertAlmostEqual(h, 94.0, delta=TOL_MM)

    def test_sheet_pdf_pages_are_us_letter(self):
        pages = pc.page_mm(self.dir / "out" / "set1-sheet.pdf")
        self.assertEqual(len(pages), 1)
        for w, h in pages:
            self.assertAlmostEqual(w, 215.9, delta=TOL_MM)
            self.assertAlmostEqual(h, 279.4, delta=TOL_MM)

    def test_sheet_keeps_bleed_and_room_for_marks(self):
        cw, ch, g, x0, y0, gw, gh, inner, ox, oy = pc.sheet_geometry()
        self.assertGreater(oy, 0, "no bleed at all top and bottom")
        self.assertGreaterEqual(y0 - oy - pc.PRINTABLE[1], pc.mm(pc.MARK_MM), "no room left for cut marks")
        self.assertEqual(2 * inner, g, "the two neighbours' bleed must fill the gutter exactly")

    def test_part_filled_sheet_keeps_full_bleed_where_no_neighbour(self):
        cw, ch, g, x0, y0, gw, gh, inner, ox, oy = pc.sheet_geometry()
        face = Image.new("RGB", (pc.mm(pc.CARD_MM[0]), pc.mm(pc.CARD_MM[1])), (200, 0, 0))
        page = pc.compose_sheet([face] * 5)            # row 0 full, row 1 holds columns 0 and 1
        two_mm = pc.mm(2.0)
        below_row1 = y0 + 2 * ch + g + two_mm           # 2 mm under card 3's trim, in the empty row
        right_of_k4 = x0 + 2 * cw + g + two_mm           # 2 mm right of card 4's trim, beside the empty slot
        self.assertEqual(page.getpixel((x0 + cw // 2, below_row1)), (200, 0, 0), "bottom of card 3 lost its bleed")
        self.assertEqual(page.getpixel((right_of_k4, y0 + ch + g + ch // 2)), (200, 0, 0), "card 4 lost its right bleed")
        self.assertEqual(page.getpixel((x0 + cw // 2, y0 + 2 * (ch + g) + ch // 2)), (255, 255, 255), "ink in the empty row")

    def test_clipped_text_is_refused(self):
        p = pc.card_params(self.card, self.dir / "art" / pc.slug(self.card["name"]) / "scene.png", pc.doors())
        p["ability"] = "|".join(["**Shield 1** — takes 1 less damage each combat."] * 12)
        with self.assertRaisesRegex(RuntimeError, "CLIPPED"):
            pc.render_face(p, self.tmp.name)

    def test_clipped_footer_is_refused(self):
        # the footer arm: a neutral card's PROPOSAL tag squeezed the collector line to "st1-011 · comm…" (2026-09-27)
        neutral = tomllib.loads((pc.REPO / "game/cards/set1/st1-011.toml").read_text())
        p = pc.card_params(neutral, self.dir / "art" / pc.slug(self.card["name"]) / "scene.png", pc.doors())
        p["left"] = neutral["id"] + " · " + "common " * 6
        with self.assertRaisesRegex(RuntimeError, "CLIPPED"):
            pc.render_face(p, self.tmp.name)

    def test_every_card_prints_its_own_name_cost_and_stats(self):
        # A misprinted stat is the costly mistake on a physical card, and nothing else here reads
        # the numbers (lead gate, 2026-09-27: attack/toughness swapped in card_params stayed green).
        doors = pc.doors()
        cards = [tomllib.loads(f.read_text()) for f in sorted((pc.REPO / "game/cards/set1").glob("*.toml"))]
        self.assertEqual(len(cards), 14)
        for c in cards:
            p = pc.card_params(c, __file__, doors)
            self.assertEqual(p["name"], c["name"])
            self.assertEqual(p["cost"], str(c["cost"]), c["name"])
            want = f"{c['attack']}/{c['toughness']}" if c["type"] == "unit" else ""
            self.assertEqual(p["pt"], want, c["name"])
        # a control the swap cannot pass: some unit's attack differs from its toughness
        self.assertTrue(any(c["type"] == "unit" and c["attack"] != c["toughness"] for c in cards))

    def test_every_faction_has_a_door(self):
        table = pc.doors()
        for door in pc.FACTION_DOOR.values():
            self.assertIn(door, table)


if __name__ == "__main__":
    unittest.main(verbosity=2)
