"""Tests for tools/pages_deploy.py. Run: python3 -m unittest tools/test_pages_deploy.py"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import freeze_contest  # noqa: E402
import pages_deploy as pd  # noqa: E402


class Stage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.site = self.d / "site"
        (self.site / "c" / "x").mkdir(parents=True)
        (self.site / "index.html").write_text("<html>home</html>")
        (self.site / "c" / "x" / "index.html").write_text("<html>card</html>")
        (self.site / "media").mkdir()
        (self.site / "media" / "clip.mp4").write_bytes(b"not for pages")
        (self.site / "README.md").write_text("ops notes")
        self.bundle = self.d / "bundle"
        (self.bundle / "assets").mkdir(parents=True)
        (self.bundle / "index.html").write_text("<html>contest</html>")
        (self.bundle / "assets" / "a.js").write_text("x")
        freeze_contest.write_manifest(self.bundle)

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_site_is_staged_without_media_or_ops_notes(self):
        out = self.d / "out"
        pd.stage(out, site=self.site)
        self.assertTrue((out / "index.html").exists())
        self.assertTrue((out / "c" / "x" / "index.html").exists())
        self.assertFalse((out / "media").exists())
        self.assertFalse((out / "README.md").exists())

    def test_a_verified_bundle_lands_at_competition_v1(self):
        out = self.d / "out"
        pd.stage(out, site=self.site, bundle=self.bundle)
        self.assertEqual((out / "competition" / "v1" / "index.html").read_text(), "<html>contest</html>")
        self.assertEqual(freeze_contest.verify(out / "competition" / "v1"), [])

    def test_a_tampered_bundle_is_refused_and_nothing_is_left_staged(self):
        (self.bundle / "assets" / "a.js").write_text("y")
        out = self.d / "out"
        with self.assertRaises(pd.Refusal):
            pd.stage(out, site=self.site, bundle=self.bundle)
        self.assertFalse(out.exists())

    def test_an_existing_staging_dir_is_refused(self):
        out = self.d / "out"
        out.mkdir()
        with self.assertRaises(pd.Refusal):
            pd.stage(out, site=self.site)

    def test_deploy_refuses_without_both_cloudflare_variables(self):
        ran = []
        for env in ({}, {"CLOUDFLARE_API_TOKEN": "t"}, {"CLOUDFLARE_ACCOUNT_ID": "a"}):
            with self.assertRaises(pd.Refusal):
                pd.deploy(self.d, env=env, run=lambda *a, **k: ran.append(a))
        self.assertEqual(ran, [])

    def test_deploy_runs_wrangler_pages_deploy_for_the_tapstone_project(self):
        ran = []
        pd.deploy(self.d, env={"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"},
                  run=lambda cmd, **k: ran.append(cmd))
        self.assertEqual(ran[0][:5], ["npx", "--yes", "wrangler", "pages", "deploy"])
        self.assertIn("tapstone", ran[0])

    def test_the_default_is_a_dry_run(self):
        out = self.d / "out"
        import contextlib, io
        buf = io.StringIO()
        called = []
        real = pd.deploy
        pd.deploy = lambda *a, **k: called.append(1)
        try:
            with contextlib.redirect_stdout(buf):
                pd.main(["--out", str(out)])
        finally:
            pd.deploy = real
        self.assertEqual(called, [])
        self.assertIn("dry run", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
