#!/usr/bin/env python3
"""Tests for the scry tap bridge (scry_bridge.py; runbook docs/runbooks/radio-match.md).

    python3 -m unittest tapstone-arena/tools/test_scry_bridge.py      # from rust/

The unit tests need nothing built. The replay tests run the arena and tapstone-sim debug builds
(`cargo build -p tapstone-arena --bin tapstone-arena -p tapstone-sim`), found in
$CARGO_TARGET_DIR/debug or rust/target/debug; a missing binary FAILS them rather than skipping,
so a green run always includes the match. Their run dirs go under $SCRY_TEST_DIR (default
~/.cache/tapstone-scry-test): the arena refuses a ledger under /tmp or /var/tmp.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scry_bridge as sb  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
JOURNAL = os.path.join(FIX, "scry-replay.journal")
UID_MAP = os.path.join(FIX, "scry-uid-map.json")
FAKE_K = "FAKE-k-9f3e1c7a0b"
LINE = ('1790042519.137736 ubox0 python3[2553520]: 192.0.2.145 - - [21/Sep/2026 19:01:59] '
        '"POST /tap/04:77:ab:10:20:30:40?k=' + FAKE_K + ' HTTP/1.0" 200 -')


def binary(name):
    target = os.environ.get("CARGO_TARGET_DIR") or os.path.join(HERE, "..", "..", "target")
    return os.path.join(target, "debug", name)


class FakeArena:
    """The remote seat: a menu, and every proposal recorded (a commit bumps the menu number)."""

    def __init__(self, menu, seat=1):
        self.n, self.seat, self.menu, self.sent = 1, seat, menu, []

    def choices(self):
        return self.n, self.seat, self.menu

    def propose(self, n, i):
        self.sent.append(self.menu[i]["key"])
        self.n += 1
        return 202


def item(key, kind, useful=True):
    return {"key": key, "label": key, "kind": kind, "useful": useful}


class Parse(unittest.TestCase):
    def test_a_real_format_line_is_a_tap_and_carries_no_token(self):
        tap = sb.parse_line(LINE)
        self.assertEqual(tap, (1790042519.137736, "04:77:AB:10:20:30:40"))
        self.assertNotIn(FAKE_K, repr(tap))

    def test_the_older_scry_glass_line_shape_parses_too(self):
        old = ('1788309462.544828 ubox0 python3[1723549]: 192.0.2.129 - "POST /tap/04:0A:0B:0C:0D:0E:0F?k='
               + FAKE_K + ' HTTP/1.1" 200 -')
        self.assertEqual(sb.parse_line(old), (1788309462.544828, "04:0A:0B:0C:0D:0E:0F"))

    def test_only_a_200_post_to_tap_is_a_tap(self):
        self.assertIsNone(sb.parse_line(LINE.replace('" 200 -', '" 403 -')))
        self.assertIsNone(sb.parse_line(LINE.replace("POST /tap/", "GET /tap/")))
        self.assertIsNone(sb.parse_line('1790567470.386715 ubox0 python3[1]: 127.0.0.1 - - '
                                        '[27/Sep/2026 20:51:10] "GET / HTTP/1.1" 404 -'))
        self.assertIsNone(sb.parse_line("1790567470.3 ubox0 python3[1]: imbued 04:77 -> bound-tag"))

    def test_strip_token(self):
        out = sb.strip_token(LINE)
        self.assertNotIn(FAKE_K, out)
        self.assertIn("?k= HTTP/1.0", out)
        self.assertEqual(sb.strip_token("/x?a=1&k=SECRET&b=2"), "/x?a=1&k=&b=2")

    def test_the_fixture_has_the_journal_shape_and_one_fake_token(self):
        taps = [sb.parse_line(x) for x in open(JOURNAL)]
        self.assertGreaterEqual(sum(1 for t in taps if t), 30)
        tokens = {x.split("k=", 1)[1].split(" ", 1)[0] for x in open(JOURNAL) if "k=" in x}
        self.assertEqual(tokens, {FAKE_K, "wrong-" + FAKE_K})


class Registry(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.cards = sb.load_deck("tide-neutral")[1]

    def test_never_the_real_copy_registry(self):
        os.makedirs(os.path.join(self.dir, "registry"))
        with self.assertRaises(SystemExit):
            sb.Registry(os.path.join(self.dir, "registry", "copies.jsonl"), "tide-neutral", self.cards)
        with self.assertRaises(SystemExit):
            sb.Registry(os.path.join(sb.REPO, "registry", "copies.jsonl"), "tide-neutral", self.cards)

    def test_castle_first_then_copies_in_list_order_and_it_persists(self):
        path = os.path.join(self.dir, "r.jsonl")
        r = sb.Registry(path, "tide-neutral", self.cards)
        self.assertEqual(len(self.cards), 30)
        self.assertEqual(r.bind("AA:01")["role"], "castle")
        self.assertEqual(r.bind("AA:02")["copy"], 0)
        self.assertEqual(r.bind("AA:03")["copy"], 1)
        again = sb.Registry(path, "tide-neutral", self.cards)
        self.assertEqual((again.castle, again.copies), ("AA:01", {"AA:02": 0, "AA:03": 1}))
        with self.assertRaises(SystemExit):
            sb.Registry(path, "ember-neutral", sb.load_deck("ember-neutral")[1])


class Grammar(unittest.TestCase):
    def setUp(self):
        self.cards = sb.load_deck("tide-neutral")[1]
        self.reg = sb.Registry(os.path.join(tempfile.mkdtemp(), "r.jsonl"), "tide-neutral", self.cards)
        self.said = []
        self.bound = sb.load_bound(UID_MAP)

    def bridge(self, menu, view=None):
        self.arena = FakeArena(menu)
        b = sb.Bridge(self.cards, self.reg, set(self.bound), self.arena, self.said.append,
                      view=lambda: view)
        b.wait_commit = lambda n, timeout=0: None
        return b

    def test_a_uid_bound_in_scry_is_refused_and_never_registered(self):
        b = self.bridge([item("p", "Pass")])
        bound = sorted(self.bound)[0]
        b.tap(1.0, bound)
        b.tap(2.0, bound)
        self.assertEqual(b.refused, [(bound, "bound in scry's uid-map (not a game card)")] * 2)
        self.assertIsNone(self.reg.castle)
        self.assertEqual(self.reg.copies, {})
        self.assertEqual(self.arena.sent, [])
        self.assertFalse(os.path.exists(self.reg.path))

    def test_a_uid_bound_after_registration_is_refused_too(self):
        b = self.bridge([item("p", "Pass")])
        b.tap(1.0, "CA:57")
        b.reload_bound = lambda: {"CA:57"}
        b.tap(2.0, "CA:57")
        self.assertEqual(self.arena.sent, [])
        self.assertEqual(b.refused[0][0], "CA:57")

    def test_castle_passes_fresh_tag_draws_next_copy(self):
        d0 = sb.design_num(self.cards[0][0])
        b = self.bridge([item(f"d/{d0}", "Draw"), item("p", "Pass")])
        b.tap(1.0, "CA:57")  # registers the castle, plays nothing
        self.assertEqual(self.arena.sent, [])
        b.tap(2.0, "C0:00")
        self.assertEqual(self.arena.sent, [f"d/{d0}"])
        self.assertEqual(b.hand, {0})
        b.tap(3.0, "CA:57")
        self.assertEqual(self.arena.sent[-1], "p")

    def test_second_tap_within_3s_charges_else_cast_into_fewest_lane(self):
        d0, d1 = (sb.design_num(self.cards[k][0]) for k in (0, 1))  # Reef Archer, Tidecaller: units
        view = {"seats": [{}, {"cells": [[{"x": 1}, None, None], [None, None, None], [{"x": 1}, None, None]]}]}
        b = self.bridge([item(f"d/{d0}", "Draw"), item(f"d/{d1}", "Draw")], view)
        b.tap(1.0, "CA:57")
        b.tap(2.0, "C0:00")
        b.tap(2.5, "C0:01")
        self.assertEqual(b.hand, {0, 1})
        self.arena.menu = [item(f"c/{d0}", "Charge")] + [item(f"u/{d1}/{lane}", "CastUnit") for lane in range(3)]
        b.tap(10.0, "C0:00")
        b.tap(12.9, "C0:00")  # 2.9 s later: charge
        self.assertEqual(self.arena.sent[-1], f"c/{d0}")
        b.tap(20.0, "C0:01")
        self.assertEqual(self.arena.sent[-1], f"c/{d0}", "nothing is cast inside the window")
        b.tick(b.pending[3] + 3.1)  # the window lapses: cast, and lane 1 has none of ours
        self.assertEqual(self.arena.sent[-1], f"u/{d1}/1")
        self.assertEqual(b.played, {0, 1})

    def test_a_card_in_hand_while_a_draw_is_owed_is_refused(self):
        d0 = sb.design_num(self.cards[0][0])
        b = self.bridge([item(f"d/{d0}", "Draw")])
        b.tap(1.0, "CA:57")
        b.tap(2.0, "C0:00")
        b.tap(3.0, "C0:00")
        self.assertEqual(self.arena.sent, [f"d/{d0}"])
        self.assertIn("a draw is owed", b.refused[-1][1])


def run_dir():
    base = os.environ.get("SCRY_TEST_DIR") or os.path.expanduser("~/.cache/tapstone-scry-test")
    os.makedirs(base, exist_ok=True)
    return os.path.join(tempfile.mkdtemp(dir=base), "run")


class Replay(unittest.TestCase):
    """The recorded journal replayed through the bridge into a desk arena match."""

    def play(self, journal, *extra):
        arena, sim = binary("tapstone-arena"), binary("tapstone-sim")
        for b in (arena, sim):
            self.assertTrue(os.path.exists(b), f"{b}: build it first (see the module docstring)")
        run = run_dir()
        p = subprocess.run([sys.executable, os.path.join(HERE, "scry_bridge.py"), "play", "--arena", arena,
                            "--run-dir", run, "--source", journal, "--uid-map", UID_MAP, *extra],
                           capture_output=True, text=True, timeout=600)
        v = subprocess.run([sys.executable, os.path.join(HERE, "radio_verify.py"), run, sim],
                           capture_output=True, text=True, timeout=120)
        return run, p, v

    def assert_no_token(self, run, p):
        self.assertNotIn("FAKE-k", p.stdout + p.stderr)
        files = [os.path.join(d, n) for d, _, ns in os.walk(run) for n in ns]
        self.assertGreaterEqual(len(files), 6, files)  # bridge.log, arena.log, the ledger, …
        for path in files:
            with open(path, "rb") as f:
                self.assertNotIn(b"FAKE-k", f.read(), path)

    def test_the_whole_journal_makes_a_verified_match(self):
        run, p, v = self.play(JOURNAL)
        self.assertEqual(p.returncode, 0, p.stdout[-2000:])
        self.assertEqual(v.returncode, 0, v.stdout)
        self.assertIn("VERIFIED: match", v.stdout)
        s = json.load(open(os.path.join(run, "shrine.json")))
        bound = sorted(sb.load_bound(UID_MAP))[0]
        self.assertEqual(s["refused"], [bound, bound])
        self.assertGreaterEqual(s["proposed"], 25)
        db = sqlite3.connect(f"file:{os.path.join(run, 'ledger.sqlite')}?mode=ro", uri=True)
        self.assertGreaterEqual(db.execute("SELECT COUNT(*) FROM match_records").fetchone()[0], 40)
        self.assert_no_token(run, p)

    def test_control_the_journal_cut_mid_match_stalls(self):
        lines = open(JOURNAL).read().splitlines()
        taps = [i for i, x in enumerate(lines) if sb.parse_line(x)]
        cut = os.path.join(os.path.dirname(run_dir()), "cut.journal")
        with open(cut, "w") as f:
            f.write("\n".join(lines[: taps[len(taps) // 2]]) + "\n")
        run, p, v = self.play(cut, "--idle-s", "10")
        self.assertEqual(p.returncode, 3, p.stdout[-2000:])
        self.assertIn("STALLED", p.stdout)
        self.assertNotEqual(v.returncode, 0, v.stdout)
        db = sqlite3.connect(f"file:{os.path.join(run, 'ledger.sqlite')}?mode=ro", uri=True)
        self.assertGreaterEqual(db.execute("SELECT COUNT(*) FROM match_records").fetchone()[0], 10)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM match WHERE state = 'over'").fetchone()[0], 0)
        self.assert_no_token(run, p)


if __name__ == "__main__":
    unittest.main()
