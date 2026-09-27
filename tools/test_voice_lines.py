"""tools/voice_lines.py: the headset's clip set, its manifest, and skip-unchanged rendering.

Run: python3 -m unittest tools/test_voice_lines.py (Python 3.11+). No network: every render here
goes through a fake synthesiser, except the checks on the committed clips, which only read files.
"""
import contextlib
import io
import json
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voice_lines  # noqa: E402

REPO = voice_lines.REPO
KEY = "k3y-that-must-never-leave-the-request-header-0123456789"


class FakeSynth:
    """Stands in for Azure: returns bytes derived from the SSML, and counts calls."""

    def __init__(self):
        self.calls = []

    def __call__(self, ssml, fmt):
        self.calls.append(ssml)
        return b"OggS-fake-" + voice_lines.sha256(ssml.encode())[:16].encode() + fmt.encode()


def lines_of(*pairs):
    return [{"id": i, "text": t} for i, t in pairs]


CONFIG = {"voice": "en-US-Test:DragonHDLatestNeural", "format": "webm-24khz-16bit-mono-opus", "ext": "webm"}


def quiet(fn, *a, **kw):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        return fn(*a, **kw), out.getvalue()


class Source(unittest.TestCase):
    def setUp(self):
        self.config, self.lines = voice_lines.load_lines(voice_lines.SOURCE)

    def test_ids_and_texts_are_unique(self):
        ids = [l["id"] for l in self.lines]
        texts = [l["text"] for l in self.lines]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(texts), len(set(texts)))

    def test_card_lines_are_every_set1_card_a_hand_can_hold(self):
        names = []
        for p in sorted((REPO / "game" / "cards" / "set1").glob("*.toml")):
            card = tomllib.loads(p.read_text())
            if card["type"] != "castle":
                names.append(card["name"])
        self.assertEqual(len(names), 18)  # set 1 since #147: 18 playable designs, plus the two castles
        got = {l["text"] for l in self.lines if l["id"].startswith("card-")}
        self.assertEqual(got, {f"{n}: touch a pad." for n in names})

    def test_levels_are_the_shrine_level_ups(self):
        want = set()
        for row in (REPO / "game" / "voice" / "clips.tsv").read_text().splitlines():
            f = row.split("\t")
            if len(f) >= 4 and f[2] == "level_up":
                want.add(f"Level {f[0].removeprefix('level_up.')}.")
        self.assertGreaterEqual(len(want), 5)
        self.assertEqual({l["text"] for l in self.lines if l["id"].startswith("level-")}, want)

    def test_duplicate_id_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.toml"
            p.write_text('voice="v"\nformat="f"\next="webm"\n[[line]]\nid="a"\ntext="x"\n[[line]]\nid="a"\ntext="y"\n')
            with self.assertRaises(ValueError):
                voice_lines.load_lines(p)


class Render(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.lines = lines_of(("a", "Your move."), ("b", "You win."), ("c", "Tom & <Jerry>."))

    def tearDown(self):
        self.tmp.cleanup()

    def render(self, lines=None, config=CONFIG):
        synth = FakeSynth()
        stats, _ = quiet(voice_lines.render, lines or self.lines, config, self.out, synth)
        return synth, stats

    def test_first_render_writes_every_clip_and_a_consistent_manifest(self):
        synth, stats = self.render()
        self.assertEqual(len(synth.calls), 3)
        self.assertEqual(stats["rendered"], 3)
        self.assertEqual(stats["chars"], sum(len(l["text"]) for l in self.lines))
        self.assertEqual(voice_lines.check(self.out, self.lines, CONFIG), [])
        m = json.loads((self.out / "manifest.json").read_text())
        for e in m["lines"]:
            audio = (self.out / e["file"]).read_bytes()
            self.assertEqual(e["audio_sha256"], voice_lines.sha256(audio))
            self.assertEqual(e["bytes"], len(audio))
            self.assertEqual(e["text_sha256"], voice_lines.sha256(e["text"].encode()))
            self.assertEqual(e["voice"], CONFIG["voice"])

    def test_second_render_sends_nothing(self):
        self.render()
        synth, stats = self.render()
        self.assertEqual(synth.calls, [])
        self.assertEqual((stats["rendered"], stats["skipped"], stats["chars"]), (0, 3, 0))

    def test_only_the_changed_text_is_sent_again(self):
        self.render()
        changed = lines_of(("a", "Your move."), ("b", "You win!"), ("c", "Tom & <Jerry>."))
        synth, stats = self.render(changed)
        self.assertEqual(len(synth.calls), 1)
        self.assertIn("You win!", synth.calls[0])
        self.assertEqual(stats["chars"], len("You win!"))
        self.assertEqual(voice_lines.check(self.out, changed, CONFIG), [])

    def test_a_new_voice_renders_everything(self):
        self.render()
        synth, _ = self.render(config={**CONFIG, "voice": "en-US-Other:DragonHDLatestNeural"})
        self.assertEqual(len(synth.calls), 3)

    def test_a_damaged_clip_is_rendered_again(self):
        self.render()
        (self.out / "b.webm").write_bytes(b"truncated")
        self.assertTrue(voice_lines.check(self.out, self.lines, CONFIG))
        synth, _ = self.render()
        self.assertEqual(len(synth.calls), 1)
        self.assertEqual(voice_lines.check(self.out, self.lines, CONFIG), [])

    def test_a_removed_line_removes_its_clip(self):
        self.render()
        self.render(self.lines[:2])
        self.assertFalse((self.out / "c.webm").exists())
        self.assertEqual(voice_lines.check(self.out, self.lines[:2], CONFIG), [])

    def test_check_fails_closed_both_ways(self):
        self.render()
        extra = self.lines + lines_of(("d", "New line."))
        self.assertTrue(any("d" in p for p in voice_lines.check(self.out, extra, CONFIG)))
        self.assertTrue(any("c" in p for p in voice_lines.check(self.out, self.lines[:2], CONFIG)))

    def test_ssml_escapes_the_text(self):
        synth, _ = self.render()
        self.assertTrue(any("Tom &amp; &lt;Jerry&gt;." in s for s in synth.calls))
        self.assertFalse(any("<Jerry>" in s for s in synth.calls))


class Key(unittest.TestCase):
    def test_the_key_travels_only_in_the_request_header(self):
        seen = []

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def urlopen(req, timeout=None):
            seen.append(req)
            return Resp(b"OggS-audio")

        synth = voice_lines.azure_synth(KEY, "eastus", urlopen=urlopen)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            _, printed = quiet(voice_lines.render, lines_of(("a", "Your move.")), CONFIG, out, synth)
            self.assertEqual(len(seen), 1)
            req = seen[0]
            self.assertEqual(req.get_header("Ocp-apim-subscription-key"), KEY)
            self.assertNotIn(KEY, req.full_url)
            self.assertNotIn(KEY.encode(), req.data)
            self.assertNotIn(KEY, printed)
            self.assertNotIn(KEY, repr(synth))
            for f in out.iterdir():
                self.assertNotIn(KEY.encode(), f.read_bytes(), f.name)

    def test_the_committed_clips_carry_no_key(self):
        cfg = Path.home() / ".config" / "speech-to-cli" / "config.json"
        if not cfg.exists():
            self.skipTest("no speech config on this host")
        key = json.loads(cfg.read_text())["key"].encode()
        files = list(voice_lines.OUT.iterdir()) + [voice_lines.SOURCE]
        self.assertGreater(len(files), 30)
        for f in files:
            self.assertNotIn(key, f.read_bytes(), f.name)


class Committed(unittest.TestCase):
    """The clips in the repo, as shipped: complete, intact, and inside the budget with headroom."""

    def setUp(self):
        self.config, self.lines = voice_lines.load_lines(voice_lines.SOURCE)

    def test_manifest_matches_source_and_files(self):
        self.assertGreaterEqual(len(self.lines), 40)
        self.assertEqual(voice_lines.check(voice_lines.OUT, self.lines, self.config), [])

    def test_the_set_is_small(self):
        m = json.loads((voice_lines.OUT / "manifest.json").read_text())
        total = sum(e["bytes"] for e in m["lines"])
        # Headroom, not non-exceedance: half the ~4 MB budget, so the set can double before it matters.
        self.assertLess(total, voice_lines.BUDGET_BYTES // 2)
        on_disk = sum(p.stat().st_size for p in voice_lines.OUT.iterdir())
        self.assertLess(on_disk, voice_lines.BUDGET_BYTES // 2)


if __name__ == "__main__":
    unittest.main()
