"""tools/freeze_contest.py: the manifest, its verifier, the refusals, the stamp and the tarball.

Run: python3 -m unittest tools/test_freeze_contest.py
The two-build reproducibility test builds the real wasm and xr dist twice (a few minutes, needs
cargo, the wasm32 target, Node 20+ and the network for npm ci); it runs only with
TAPSTONE_FREEZE_FULL=1 and says so when skipped. Temp dirs honour TMPDIR (never /tmp on familiar).
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import freeze_contest as fc  # noqa: E402

TOOL = Path(__file__).resolve().parent / "freeze_contest.py"


def tree(root, files):
    for rel, data in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


FILES = {
    "index.html": b"<html><head></head><body>hi</body></html>\n",
    "assets/index-abc.js": b"console.log(1)\n",
    "assets/deep/x.wasm": bytes(range(256)),
    "name with space.txt": b"spaces are legal\n",
}


class Manifest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "bundle"
        tree(self.root, FILES)
        fc.write_manifest(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip_is_clean(self):
        self.assertEqual(fc.verify(self.root), [])

    def test_manifest_lists_every_file_sorted_and_not_itself(self):
        lines = (self.root / fc.MANIFEST).read_text().splitlines()
        paths = [l.split("  ", 1)[1] for l in lines]
        self.assertEqual(paths, sorted(FILES))
        for l in lines:
            h, p = l.split("  ", 1)
            self.assertEqual(h, hashlib.sha256(FILES[p]).hexdigest())

    def test_sha256sum_agrees(self):
        # An instrument that is not this module: coreutils reads the same file.
        r = subprocess.run(["sha256sum", "--strict", "-c", fc.MANIFEST], cwd=self.root,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout.count(": OK"), len(FILES))

    def test_a_flipped_byte_is_caught(self):
        p = self.root / "assets/deep/x.wasm"
        b = bytearray(p.read_bytes())
        b[100] ^= 0x01
        p.write_bytes(bytes(b))
        problems = fc.verify(self.root)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("MISMATCH", problems[0])
        self.assertIn("assets/deep/x.wasm", problems[0])

    def test_a_flipped_byte_deep_in_a_large_file_is_caught(self):
        # The real wasm is megabytes; a hash that read only a prefix passed every small-file test
        # (lead gate, 2026-09-27: sha256 of the first 4 KB stayed green 30/30). The manifest must
        # hash every byte, checked against an independent sha256 of the whole file.
        p = self.root / "assets/big.bin"
        data = bytes(range(256)) * 4096  # 1 MiB
        p.write_bytes(data)
        fc.write_manifest(self.root)
        line = next(l for l in (self.root / "MANIFEST.sha256").read_text().splitlines()
                    if l.endswith("assets/big.bin"))
        self.assertEqual(line.split()[0], hashlib.sha256(data).hexdigest())
        b = bytearray(data)
        b[-1] ^= 0x01
        p.write_bytes(bytes(b))
        problems = fc.verify(self.root)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("MISMATCH assets/big.bin", problems[0])

    def test_a_missing_file_is_caught(self):
        (self.root / "assets/index-abc.js").unlink()
        problems = fc.verify(self.root)
        self.assertEqual(problems, ["MISSING assets/index-abc.js"])

    def test_an_extra_file_is_caught(self):
        (self.root / "assets/late.js").write_bytes(b"x")
        problems = fc.verify(self.root)
        self.assertEqual(problems, ["EXTRA assets/late.js"])

    def test_an_extra_empty_dir_is_caught(self):
        (self.root / "assets/empty").mkdir()
        self.assertEqual(fc.verify(self.root), ["EXTRA assets/empty/"])

    def test_a_symlink_is_caught(self):
        (self.root / "link.html").symlink_to("index.html")
        problems = fc.verify(self.root)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("link.html", problems[0])

    def test_an_empty_manifest_fails(self):
        # A verifier that checked nothing must not pass (the skip-guard floor).
        (self.root / fc.MANIFEST).write_text("")
        problems = fc.verify(self.root)
        self.assertTrue(any("empty" in p for p in problems), problems)

    def test_no_manifest_fails(self):
        (self.root / fc.MANIFEST).unlink()
        self.assertTrue(fc.verify(self.root))

    def test_a_malformed_line_fails(self):
        m = self.root / fc.MANIFEST
        m.write_text(m.read_text() + "not a manifest line\n")
        self.assertTrue(any("malformed" in p for p in fc.verify(self.root)))

    def test_a_path_escaping_the_bundle_fails(self):
        m = self.root / fc.MANIFEST
        m.write_text(m.read_text() + f"{'0' * 64}  ../outside\n")
        self.assertTrue(any("unsafe" in p for p in fc.verify(self.root)))

    def test_a_duplicate_entry_fails(self):
        m = self.root / fc.MANIFEST
        first = m.read_text().splitlines()[0]
        m.write_text(m.read_text() + first + "\n")
        self.assertTrue(any("duplicate" in p for p in fc.verify(self.root)))

    def test_cli_exit_status(self):
        ok = subprocess.run([sys.executable, TOOL, "--verify", self.root], capture_output=True)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        (self.root / "index.html").write_bytes(b"tampered")
        bad = subprocess.run([sys.executable, TOOL, "--verify", self.root], capture_output=True)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn(b"MISMATCH index.html", bad.stdout + bad.stderr)


class Tarball(unittest.TestCase):
    def test_same_tree_same_bytes_whatever_the_mtimes(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t) / "b"
            tree(root, FILES)
            fc.write_manifest(root)
            a = Path(t) / "a.tar.gz"
            fc.make_tarball(root, a, "vr-competition-v1", 1_760_000_000)
            for p in root.rglob("*"):
                os.utime(p, (1, 1))
            os.chmod(root / "index.html", 0o600)
            b = Path(t) / "b.tar.gz"
            fc.make_tarball(root, b, "vr-competition-v1", 1_760_000_000)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            with tarfile.open(a) as tf:
                names = tf.getnames()
                self.assertIn("vr-competition-v1/index.html", names)
                self.assertIn(f"vr-competition-v1/{fc.MANIFEST}", names)
                self.assertTrue(all(n == "vr-competition-v1" or n.startswith("vr-competition-v1/")
                                    for n in names))
                self.assertEqual({m.mtime for m in tf.getmembers()}, {1_760_000_000})
                self.assertEqual({(m.uid, m.gid, m.uname, m.gname) for m in tf.getmembers()},
                                 {(0, 0, "", "")})

    def test_unpacked_tarball_verifies(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t) / "b"
            tree(root, FILES)
            fc.write_manifest(root)
            a = Path(t) / "a.tar.gz"
            fc.make_tarball(root, a, "v1", 1_760_000_000)
            with tarfile.open(a) as tf:
                tf.extractall(Path(t) / "x", filter="data")
            self.assertEqual(fc.verify(Path(t) / "x" / "v1"), [])


def git(cwd, *args, env=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
                          env=env).stdout.strip()


COMMIT_EPOCH = 1_763_000_000  # a fixed commit time, so the stamp's expected value is known


def make_repo(root):
    root.mkdir(parents=True)
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "t@example.invalid")
    git(root, "config", "user.name", "t")
    (root / "a.txt").write_text("a\n")
    (root / "index.html").write_text("<html><head></head><body></body></html>\n")
    git(root, "add", "a.txt", "index.html")
    env = {**os.environ, "GIT_AUTHOR_DATE": f"@{COMMIT_EPOCH} +0000",
           "GIT_COMMITTER_DATE": f"@{COMMIT_EPOCH} +0000"}
    git(root, "commit", "-q", "-m", "one", env=env)
    git(root, "tag", "-a", "vr-competition-v1", "-m", "freeze")
    git(root, "tag", "light-tag")
    return root


class Refusals(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = make_repo(Path(self.tmp.name) / "repo")
        self.out = Path(self.tmp.name) / "out"

    def tearDown(self):
        self.tmp.cleanup()

    def run_tool(self, *args):
        return subprocess.run([sys.executable, TOOL, "--repo", self.repo, "--out", self.out, *args],
                              capture_output=True, text=True)

    def test_clean_tag_passes_the_preconditions(self):
        src = fc.resolve_source(self.repo, "vr-competition-v1", allow_untagged=False)
        self.assertEqual(src.commit, git(self.repo, "rev-parse", "HEAD"))
        self.assertEqual(src.epoch, COMMIT_EPOCH)
        self.assertTrue(src.tagged)

    def test_a_lightweight_tag_counts_as_a_tag(self):
        self.assertTrue(fc.resolve_source(self.repo, "light-tag", allow_untagged=False).tagged)

    def test_a_modified_tracked_file_refuses(self):
        (self.repo / "a.txt").write_text("changed\n")
        r = self.run_tool("vr-competition-v1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("dirty", r.stderr)
        self.assertFalse(self.out.exists(), "refusal must come before anything is written")

    def test_an_untracked_file_refuses(self):
        (self.repo / "stray.txt").write_text("x\n")
        r = self.run_tool("vr-competition-v1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("dirty", r.stderr)
        self.assertFalse(self.out.exists())

    def test_a_branch_refuses_without_allow_untagged(self):
        r = self.run_tool("main")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not a tag", r.stderr)
        self.assertFalse(self.out.exists())
        src = fc.resolve_source(self.repo, "main", allow_untagged=True)
        self.assertFalse(src.tagged)

    def test_a_sha_refuses_without_allow_untagged(self):
        r = self.run_tool(git(self.repo, "rev-parse", "HEAD"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not a tag", r.stderr)

    def test_an_unknown_ref_refuses(self):
        with self.assertRaises(fc.Refusal):
            fc.resolve_source(self.repo, "no-such-ref", allow_untagged=True)

    def test_an_existing_out_dir_refuses(self):
        # A frozen bundle is never overwritten in place.
        self.out.mkdir()
        (self.out / "keep").write_text("x")
        r = self.run_tool("vr-competition-v1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("exists", r.stderr)
        self.assertEqual([p.name for p in self.out.iterdir()], ["keep"])


class Stamp(unittest.TestCase):
    """The realm-sigil stamp, through realm-sigil's own static/build.sh."""

    def setUp(self):
        if not (fc.DEFAULT_SIGIL / "static" / "build.sh").is_file():
            self.fail(f"realm-sigil not at {fc.DEFAULT_SIGIL}; the freeze needs it")
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = make_repo(Path(self.tmp.name) / "repo")
        self.sha = git(self.repo, "rev-parse", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def stamp(self, name):
        html = Path(self.tmp.name) / name / "index.html"
        html.parent.mkdir()
        html.write_text("<html><head><title>t</title></head><body></body></html>\n")
        info = fc.stamp(self.repo, html, fc.DEFAULT_SIGIL, COMMIT_EPOCH)
        return info, html.read_text(), (html.parent / "version.json").read_text()

    def test_stamp_takes_the_commit_time_and_the_short_sha(self):
        info, html, vj = self.stamp("one")
        self.assertEqual(info["built"], "2025-11-13T02:13:20Z")  # COMMIT_EPOCH, not now
        self.assertEqual(info["hash"], self.sha[:7])
        self.assertIs(info["dirty"], False)
        self.assertEqual(json.loads(vj), info)
        self.assertIn('<meta name="realm-version"', html)

    def test_two_stamps_are_byte_identical(self):
        a = self.stamp("one")
        b = self.stamp("two")
        self.assertEqual(a[1], b[1])
        self.assertEqual(a[2], b[2])


class Checks(unittest.TestCase):
    def test_base_path_check(self):
        good = '<script type="module" src="/competition/v1/assets/i.js"></script><link href="data:,">'
        self.assertEqual(fc.check_base(good, "/competition/v1/"), [])
        rel = '<script type="module" src="./assets/i.js"></script>'
        self.assertTrue(fc.check_base(rel, "/competition/v1/"))  # nothing under the base: floor
        root = '<script src="/competition/v1/a.js"></script><script src="/assets/i.js"></script>'
        self.assertTrue(fc.check_base(root, "/competition/v1/"))

    def test_gate_record_drops_only_the_timing(self):
        out = "ok   nobody seated equals the fixture (79 lines, 12.9 ms)\nok   a person finishes (27 taps)"
        self.assertEqual(fc.gate_record(out), ["ok   nobody seated equals the fixture (79 lines)",
                                               "ok   a person finishes (27 taps)"])

    def test_leak_check_finds_a_build_path(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            tree(root, {"ok.js": b"fine", "bad.wasm": b"\x00/home/someone/.cargo/registry\x00"})
            self.assertEqual(fc.find_leaks(root, [b"/home/someone"]), ["bad.wasm"])
            self.assertEqual(fc.find_leaks(root, [b"/nowhere"]), [])


@unittest.skipUnless(os.environ.get("TAPSTONE_FREEZE_FULL") == "1",
                     "SKIPPED the two real builds: set TAPSTONE_FREEZE_FULL=1 to run them")
class Reproducible(unittest.TestCase):
    """Two real freezes of this repo's HEAD give the same manifest and the same tarball."""

    def test_two_builds_match(self):
        here = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            # A fresh clone at HEAD: clean by construction, whatever state this worktree is in.
            git(t, "clone", "-q", str(here), "repo")
            outs = []
            for name in ("one", "two"):
                out = t / name
                r = subprocess.run([sys.executable, TOOL, "HEAD", "--allow-untagged",
                                    "--repo", t / "repo", "--out", out],
                                   capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-3000:])
                outs.append(out)
            (a,), (b,) = (list(o.glob("*.tar.gz")) for o in outs)
            ma = next(o for o in outs[0].iterdir() if o.is_dir()) / fc.MANIFEST
            mb = next(o for o in outs[1].iterdir() if o.is_dir()) / fc.MANIFEST
            self.assertGreater(len(ma.read_text().splitlines()), 10)
            diff = sorted(set(ma.read_text().splitlines()) ^ set(mb.read_text().splitlines()))
            self.assertEqual(diff, [], "files that differ between the two builds")
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(fc.verify(ma.parent), [])


if __name__ == "__main__":
    unittest.main()
