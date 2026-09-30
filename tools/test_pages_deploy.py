"""Tests for tools/pages_deploy.py. Run: python3 -m unittest tools/test_pages_deploy.py"""
import json
import shutil
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
        self.github = self.d / "gh-bundle"
        shutil.copytree(self.bundle, self.github)
        for b, base in ((self.bundle, pd.BASES["cloudflare"]), (self.github, pd.BASES["github"])):
            (b / freeze_contest.BUILDINFO).write_text(json.dumps({"base": base}))
            freeze_contest.write_manifest(b)

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

    def test_a_bundle_built_for_the_other_host_is_refused_and_nothing_is_staged(self):
        for target, bundle in (("github", self.bundle), ("cloudflare", self.github)):
            out = self.d / ("out-" + target)
            with self.assertRaises(pd.Refusal):
                pd.stage(out, site=self.site, bundle=bundle, target=target)
            self.assertFalse(out.exists())

    def test_github_staging_carries_its_bundle_and_a_nojekyll(self):
        out = self.d / "out"
        pd.stage(out, site=self.site, bundle=self.github, target="github")
        self.assertTrue((out / ".nojekyll").exists())
        self.assertEqual(freeze_contest.verify(out / "competition" / "v1"), [])
        cf = self.d / "out-cf"
        pd.stage(cf, site=self.site, bundle=self.bundle)
        self.assertFalse((cf / ".nojekyll").exists())

    def _gh_deploy(self, out, env=None, **kw):
        ran = []
        kw.setdefault("identity", ("jp", "jp@example.invalid"))
        pd.deploy(out, env=env or {}, run=lambda cmd, **k: ran.append((cmd, k.get("cwd"), k.get("env"))),
                  target="github", **kw)
        return ran

    def test_github_deploy_ignores_an_inherited_git_dir(self):
        out = self.d / "out"
        pd.stage(out, site=self.site, bundle=self.github, target="github")
        ran = self._gh_deploy(out, env={"GIT_DIR": "/parent/.git", "GIT_WORK_TREE": "/parent", "HOME": "/h"})
        for cmd, _, env in ran:
            self.assertEqual({k for k in env if k.startswith("GIT_")}, set())
            self.assertEqual(env["HOME"], "/h")
        for cmd, _, _ in ran[1:]:
            self.assertIn(f"--git-dir={out / '.git'}", cmd)

    def test_github_deploy_takes_the_public_repos_author_when_none_is_given(self):
        out = self.d / "out"
        pd.stage(out, site=self.site, bundle=self.github, target="github")
        real = pd.public_identity
        pd.public_identity = lambda repo=None: ["Pub Author", "pub@example.invalid"]
        try:
            ran = self._gh_deploy(out, identity=None)
        finally:
            pd.public_identity = real
        self.assertIn("user.email=pub@example.invalid", ran[2][0])

    def test_github_deploy_runs_git_in_the_staging_dir_with_no_shell_and_force_pushes_gh_pages(self):
        out = self.d / "R x"  # a space once made `sh -c "cd R x"` land in R and publish R's own branch
        pd.stage(out, site=self.site, bundle=self.github, target="github")
        ran = self._gh_deploy(out)
        self.assertTrue(all(cwd == out for _, cwd, _ in ran))
        self.assertTrue(all(cmd[0] == "git" for cmd, _, _ in ran))
        self.assertEqual(ran[0][0], ["git", "init", "-q", "-b", "gh-pages", str(out)])
        self.assertEqual(ran[-1][0][-4:], ["push", "-f", f"https://github.com/{pd.PUBLIC_REPO}.git", "gh-pages"])
        self.assertIn("user.email=jp@example.invalid", ran[2][0])

    def test_github_deploy_rechecks_the_staging_dir(self):
        with self.assertRaises(pd.Refusal):  # not staged for github
            self._gh_deploy(self.d)
        out = self.d / "out"
        pd.stage(out, site=self.site, bundle=self.github, target="github")
        (out / ".git").mkdir()
        with self.assertRaisesRegex(pd.Refusal, r"already holds a \.git"):
            self._gh_deploy(out)
        (out / ".git").rmdir()
        (out / "late.html").write_text("scryfall")  # added after staging
        with self.assertRaises(pd.Refusal):
            self._gh_deploy(out)

    def test_the_guard_reads_every_file_ignoring_case_and_refuses_dotfiles(self):
        me = "jphein/" + "tapstone"
        for name, body in (("a.mjs", "https://github.com/" + me), ("b.map", "Wizards of the Coast"),
                           ("UPPER.HTML", "HTTPS://GITHUB.COM/" + me.upper()), ("NOSUFFIX", "x"),
                           ("c.js", "https://api.scryfall.com/cards"), (".env", "K=v"),
                           ("d.txt", "Pri" + "vate Tapstone repo"),
                           ("e.json", "https:\\/\\/github.com\\/" + me.replace("/", "\\/"))):
            site = self.d / ("site-" + name.strip("."))
            shutil.copytree(self.site, site)
            (site / name).write_text(body)
            if name == "NOSUFFIX":
                (site / name).write_bytes(b"\x00\x01" + ("github.com/" + me).encode() + b"\x00")
            out = self.d / ("out-" + name.strip("."))
            with self.assertRaises(pd.Refusal, msg=name):
                pd.stage(out, site=site, bundle=self.github, target="github")
            self.assertFalse(out.exists(), name)

    def test_a_crash_mid_copy_leaves_nothing_staged(self):
        (self.site / "dangling").symlink_to(self.d / "nowhere")
        out = self.d / "out"
        with self.assertRaises(Exception):
            pd.stage(out, site=self.site)
        self.assertFalse(out.exists())

    def test_github_refuses_private_content_and_leaves_nothing_staged(self):
        me = "jphein/" + "tapstone"
        for leak in ('{"repo": "https://github.com/%s"}' % me, "Card and art © Wizards of the Coast",
                     "<footer>Design notes live in the " + "pri" + "vate Tapstone repo.</footer>"):
            (self.site / "leak.html").write_text(leak)
            out = self.d / "out"
            with self.assertRaises(pd.Refusal):
                pd.stage(out, site=self.site, bundle=self.github, target="github")
            self.assertFalse(out.exists())
        (self.site / "leak.html").write_text('{"repo": "https://github.com/%s-game"}' % me)
        pd.stage(self.d / "out", site=self.site, bundle=self.github, target="github")

    def test_an_unknown_target_is_refused(self):
        with self.assertRaises(pd.Refusal):
            pd.stage(self.d / "out", site=self.site, target="netlify")

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
