"""tools/voice_pack.py: the shrine's SD voice pack (0033), its codec, manifest and skip-unchanged rendering.

Run: python3 -m unittest tools/test_voice_pack.py (Python 3.11+). No Piper here: every render goes
through a fake synthesiser that returns deterministic 16-bit PCM at the pack's rate.
"""
import contextlib
import io
import math
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voice_pack as vp  # noqa: E402


class FakeSynth:
    """Stands in for Piper: a tone whose pitch comes from the text, 1/18 s per character."""

    voice = "fake-voice"
    rate = vp.RATE

    def __init__(self, seconds_per_char=1 / 18):
        self.calls = []
        self.spc = seconds_per_char

    def __call__(self, text):
        self.calls.append(text)
        n = max(1, int(len(text) * self.spc * self.rate))
        f = 200 + int(vp.sha256(text.encode())[:2], 16)
        return b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * f * i / self.rate))) for i in range(n))


def clips_of(*pairs):
    return [{"id": i, "text": t} for i, t in pairs]


CLIPS = clips_of(("invite", "set your castle on the stone"), ("pass", "you pass"),
                 ("level_up.2", "level two"))


def quiet(fn, *a, **kw):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        return fn(*a, **kw), out.getvalue()


class Source(unittest.TestCase):
    def test_the_real_table_has_every_fixed_clip_and_nothing_streamed(self):
        clips = vp.load_clips(vp.SOURCE)
        rows = [r.split("\t") for r in vp.SOURCE.read_text().splitlines() if r and not r.startswith("#")][1:]
        want = {r[0] for r in rows if r[1] == "clip"}
        self.assertGreaterEqual(len(want), 280)  # 280 after #166; the count comes from the table itself
        self.assertEqual({c["id"] for c in clips}, want)
        self.assertNotIn("heard", {c["id"] for c in clips})  # streamed: the arena speaks it, not the pack
        self.assertNotIn("silent", {c["id"] for c in clips})

    def test_file_names_are_8_3_and_unique_across_the_real_table(self):
        clips = vp.load_clips(vp.SOURCE)
        names = [vp.file_name(c["id"]) for c in clips]
        self.assertEqual(len(names), len(set(names)))
        for n in names:
            self.assertRegex(n, r"^[0-9A-F]{8}\.WAV$")

    def test_a_tab_in_the_text_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.tsv"
            p.write_text("key\tkind\tvariant\ttext\na\tclip\ta\tx\ty\n")
            with self.assertRaises(ValueError):
                vp.load_clips(p)

    def test_duplicate_key_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.tsv"
            p.write_text("key\tkind\tvariant\ttext\na\tclip\ta\tx\na\tclip\ta\ty\n")
            with self.assertRaises(ValueError):
                vp.load_clips(p)


class Codec(unittest.TestCase):
    def tone(self, n, amp=12000, f=440):
        return [int(amp * math.sin(2 * math.pi * f * i / vp.RATE)) for i in range(n)]

    def test_round_trip_keeps_speech_band_audio(self):
        pcm = self.tone(vp.RATE)  # one second
        wav = vp.encode_wav(struct.pack(f"<{len(pcm)}h", *pcm))
        got = vp.decode_wav(wav)
        self.assertEqual(len(got), len(pcm))
        noise = sum((a - b) ** 2 for a, b in zip(pcm, got))
        snr = 10 * math.log10(sum(a * a for a in pcm) / noise)
        self.assertGreater(snr, 20.0, snr)

    def test_header_is_ima_adpcm_mono_at_the_codec_floor(self):
        wav = vp.encode_wav(b"\0\0" * 1000)
        info = vp.wav_info(wav)
        self.assertEqual(info["format_tag"], 0x11)
        self.assertEqual(info["channels"], 1)
        self.assertEqual(info["rate"], 22050)  # BOARD.md L5: the codec refuses anything slower
        self.assertEqual(info["bits"], 4)
        self.assertEqual(info["block_align"], vp.BLOCK)
        self.assertEqual(info["samples_per_block"], vp.SAMPLES_PER_BLOCK)
        self.assertEqual(info["samples"], 1000)

    def test_size_is_exactly_whole_blocks_plus_header(self):
        for n in (1, 505, 506, 22050):
            wav = vp.encode_wav(b"\0\0" * n)
            self.assertEqual(len(wav), vp.HEADER_BYTES + math.ceil(n / vp.SAMPLES_PER_BLOCK) * vp.BLOCK, n)

    def walk(self):
        """A signal that drives the step index through the whole table: silence (index 0), a slow
        exponential ramp from 1 to 30,000 on a 5 kHz carrier (large per-sample differences climb to
        88), the same ramp back down (the index falls by one at a time, so it passes every entry), then
        quiet speech-like noise. Loud tones alone climb in jumps of up to 8 and skip most of the low
        table, which is how a changed STEPS entry once stayed green."""
        rng = random.Random(33)
        n = vp.RATE * 2
        ramp = [math.exp(math.log(30000) * i / n) for i in range(n)]
        env = [0.0] * 2000 + ramp + ramp[::-1]
        pcm = [int(a * math.sin(2 * math.pi * 5000 * i / vp.RATE)) for i, a in enumerate(env)]
        return pcm + [int(rng.gauss(0, 150)) for _ in range(vp.RATE // 2)]

    def test_ffmpeg_decodes_the_same_samples_as_the_reference_decoder(self):
        # An instrument that can disagree: ffmpeg's adpcm_ima_wav is an independent implementation of
        # the header, block, nibble layout and step table. It decodes whole blocks, so compare the
        # fact samples. Coverage is proven here, not assumed: every step index must be used.
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg not installed: the independent decoder check did not run")
        pcm = self.walk()
        seen, delta = set(), vp._delta

        def recording(nib, idx):
            seen.add(idx)
            return delta(nib, idx)

        vp._delta = recording
        try:
            wav = vp.encode_wav(struct.pack(f"<{len(pcm)}h", *pcm))
        finally:
            vp._delta = delta
        self.assertEqual(sorted(set(range(len(vp.STEPS))) - seen), [], "step indices the encoder never used")
        self.assertEqual(len(vp.STEPS), 89)
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "a.wav").write_bytes(wav)
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(Path(d) / "a.wav"), "-f", "s16le", "-"],
                                 capture_output=True, check=True).stdout
        theirs = struct.unpack(f"<{len(raw) // 2}h", raw)
        ours = vp.decode_wav(wav)
        self.assertEqual(len(ours), len(pcm))
        self.assertEqual(list(theirs[:len(ours)]), ours)

    def test_a_truncated_wav_is_refused(self):
        wav = vp.encode_wav(b"\0\0" * 2000)
        with self.assertRaises(ValueError):
            vp.wav_info(wav[:-10])


class Pack(unittest.TestCase):
    def build(self, d, clips=CLIPS, synth=None):
        synth = synth or FakeSynth()
        stats, _ = quiet(vp.build, clips, d, synth)
        return stats, synth

    def test_manifest_matches_every_file(self):
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            m = vp.read_manifest(d)
            self.assertEqual([e["id"] for e in m["clips"]], sorted(c["id"] for c in CLIPS))
            self.assertEqual(m["voice"], "fake-voice")
            for e in m["clips"]:
                b = (Path(d) / e["file"]).read_bytes()
                self.assertEqual(len(b), e["bytes"])
                self.assertEqual(vp.sha256(b), e["sha256"])
                self.assertEqual(vp.sha256(e["text"].encode()), e["text_sha256"])
            self.assertEqual(vp.check(d, CLIPS, "fake-voice"), [])

    def test_unchanged_clips_are_not_rendered_again(self):
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            stats, synth = self.build(d)
            self.assertEqual((stats["rendered"], stats["skipped"]), (0, 3))
            self.assertEqual(synth.calls, [])
            edited = clips_of(("invite", "set your castle on the stone!"), ("pass", "you pass"),
                              ("level_up.2", "level two"))
            stats, synth = self.build(d, edited)
            self.assertEqual(synth.calls, ["set your castle on the stone!"])
            self.assertEqual(vp.check(d, edited, "fake-voice"), [])

    def test_another_voice_renders_everything_again(self):
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            s = FakeSynth()
            s.voice = "other-voice"
            stats, _ = self.build(d, synth=s)
            self.assertEqual(stats["rendered"], 3)

    def test_a_corrupted_clip_is_detected_and_re_rendered(self):
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            e = next(e for e in vp.read_manifest(d)["clips"] if e["id"] == "pass")
            p = Path(d) / e["file"]
            b = bytearray(p.read_bytes())
            b[len(b) // 2] ^= 0x01  # one bit in the middle of the audio, same size
            p.write_bytes(bytes(b))
            problems = vp.check(d, CLIPS, "fake-voice")
            self.assertEqual(problems, [f"pass: {e['file']} does not match the manifest"])
            stats, synth = self.build(d)
            self.assertEqual(synth.calls, ["you pass"])
            self.assertEqual(vp.check(d, CLIPS, "fake-voice"), [])

    def test_a_killed_render_keeps_what_it_finished(self):
        # familiar OOM-killed the first real render at clip 155 of 280 with no manifest written, so
        # every finished clip would have been rendered again. The manifest now follows each clip.
        class Dies(FakeSynth):
            def __call__(self, text):
                if len(self.calls) == 2:
                    raise KeyboardInterrupt
                return super().__call__(text)

        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(KeyboardInterrupt):
                self.build(d, synth=Dies())
            self.assertEqual(len(vp.read_manifest(d)["clips"]), 2)
            stats, synth = self.build(d)
            self.assertEqual(synth.calls, [CLIPS[2]["text"]])
            self.assertEqual(vp.check(d, CLIPS, "fake-voice"), [])

    def test_missing_stray_and_stale_are_reported(self):
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            e = vp.read_manifest(d)["clips"][0]
            (Path(d) / e["file"]).unlink()
            (Path(d) / "JUNK.WAV").write_bytes(b"x")
            problems = vp.check(d, CLIPS[:2] + clips_of(("new", "a new line")), "fake-voice")
            self.assertIn(f"{e['id']}: {e['file']} missing", problems)
            self.assertIn("JUNK.WAV: stray file", problems)
            self.assertIn("new: in the source, not rendered", problems)
            self.assertIn("level_up.2: rendered, not in the source", problems)

    def test_removed_clips_are_deleted_from_the_pack(self):
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            stats, _ = self.build(d, CLIPS[:2])
            self.assertEqual(stats["removed"], 1)
            self.assertEqual(vp.check(d, CLIPS[:2], "fake-voice"), [])

    def test_size_budget_holds_with_headroom_at_speaking_pace(self):
        with tempfile.TemporaryDirectory() as d:
            stats, _ = self.build(d)
            self.assertEqual(vp.budget_problems(d), [])
            self.assertLessEqual(stats["bytes"], (1 - vp.HEADROOM) * vp.budget_bytes(CLIPS))

    def test_size_budget_fails_a_pack_that_speaks_at_a_crawl(self):
        # A slow voice (or padded silence) doubles the bytes per character: the budget must see it.
        with tempfile.TemporaryDirectory() as d:
            self.build(d, synth=FakeSynth(seconds_per_char=1 / 6))
            self.assertEqual(len(vp.budget_problems(d)), 1)

    def test_manifest_is_what_the_rust_reader_parses(self):
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            lines = (Path(d) / vp.MANIFEST).read_text().splitlines()
            self.assertEqual(lines[0], "# tapstone voice pack v1")
            header = next(l for l in lines if not l.startswith("#"))
            self.assertEqual(header, "id\tfile\tbytes\tsha256\ttext_sha256\ttext")

    def test_the_rust_readers_fixture_is_this_builders_output(self):
        # shrine_render::pack's tests parse this file; the two sides stay one object only if the
        # builder still writes it byte for byte. A change here is a format change: bump VERSION.
        fixture = vp.REPO / "rust" / "shrine-render" / "tests" / "fixtures" / "voice-pack-manifest.tsv"
        with tempfile.TemporaryDirectory() as d:
            self.build(d)
            self.assertEqual((Path(d) / vp.MANIFEST).read_text(), fixture.read_text())


if __name__ == "__main__":
    unittest.main()
