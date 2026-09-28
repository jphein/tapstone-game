#!/usr/bin/env python3
"""The scry tap bridge (tapstone#132): real card taps at the scry station become seat B's taps in a
desk arena match (runbook docs/runbooks/radio-match.md, "Real card taps via scry").

The scry station (CC:64) POSTs every tap to scry-glass on ubox0 as `POST /tap/<UID>?k=<token>`,
and scry-glass's journald records each request. This bridge only READS that journal
(`journalctl -u scry-glass -f -o short-unix` over ssh) and scry's `uid-map.json`; it never POSTs to
scry and never writes its files. The station token (`k=`) is stripped on ubox0 before the line
leaves it, and again at parse time: no line this bridge stores, prints or logs carries it.

- A UID bound in scry's uid-map.json is REFUSED (logged by UID only): a bound tag triggers the
  station's own action, so it must never double as a game card.
- Every other UID maps to a copy of the seat's deck through a SCRATCH registry (never
  registry/copies.jsonl). Registration is inline: the first fresh tag becomes the seat's castle,
  and each fresh tag after it is bound to the next copy of the deck list (the 30-card list), and
  then played like any other tap.
- The seat is the arena's remote seat (0038) in desk mode, beside the desk bot: the bridge starts
  `tapstone-arena --desk --remote <deck> --once --ledger <run>/ledger.sqlite` and plays seat B
  through `/remote/*`, as tools/remote_smoke.py does. A tap is read the way 0009 reads a card:
  an owed draw draws the tapped copy; on the seat's own move a card in hand is cast with 0009's
  defaults (a unit into the legal lane with the fewest of the seat's units, a spell at the menu's
  first useful target), a second tap of the same card within 3 s charges it instead, and the
  castle tag passes.

    scry_bridge.py play --arena <tapstone-arena> --run-dir <new dir> [--deck tide-neutral]
        [--source ssh:ubox0 | <journal file>] [--uid-map ssh:ubox0 | <file>] [--registry <jsonl>]

A file source is a REPLAY: its lines are fed one at a time, each only once the seat has a move, as
a person tapping when the console prompts would. Exit 0 when the arena finished the match (and
wrote the ledger `radio_verify.py` then checks), 3 when it stalled (no result), 2 on bad input.
"""
import argparse
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import tomllib
import urllib.error
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
UID_MAP_PATH = "~/scry-glass/uid-map.json"  # on ubox0 (scry-glass.py's UID_MAP_FILE)
# 0009: "a second tap of the same card within 3 s means charge".
SECOND_TAP_S = 3.0

# A scry-glass request line as journald prints it with -o short-unix, e.g.
#   1790042519.137736 ubox0 python3[2553520]: 192.0.2.145 - - [21/Sep/2026 19:01:59] "POST /tap/04:77:…?k=… HTTP/1.0" 200 -
# scry-glass's early-September builds logged `<ip> - "POST …"` (no identity field, no date), and
# ubox0's journal still holds those lines, so both shapes parse. The query is matched and thrown
# away: it is never captured.
TAP_RE = re.compile(
    r"^(?P<ts>\d+(?:\.\d+)?) \S+ [^:]+: \S+ (?:- )+(?:\[[^\]]*\] )?"
    r'"POST /tap/(?P<uid>[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){1,9})(?:\?[^ "]*)? HTTP/[0-9.]+" (?P<status>\d{3})'
)
TOKEN_RE = re.compile(r"([?&])k=[^&\s\"]*")
# Run on ubox0, in the pipe, so the token never crosses the wire (sed -u: line-buffered).
REMOTE_STRIP = r"""sed -u -E 's/([?&])k=[^ &"]*/\1k=/g'"""


def strip_token(line):
    """`line` without the value of any `k=` query parameter."""
    return TOKEN_RE.sub(r"\1k=", line)


def parse_line(line):
    """A tap `(t, uid)` from one journal line, or None. Only a 200 is a tap the station made with a
    good token (403 is scry refusing it). The UID is upper-cased, as scry-glass does."""
    m = TAP_RE.match(line)
    if not m or m.group("status") != "200":
        return None
    return float(m.group("ts")), m.group("uid").upper()


# ---- the seat's deck and the scratch registry ------------------------------------------------


def design_num(card_id):
    """`st1-042` -> 42 (tapstone-sim's deck.rs reads ids the same way)."""
    return int(card_id.rsplit("-", 1)[1])


def load_deck(stem):
    """`decks/<stem>.toml` as (castle id, [(card id, name), ...]) in list order."""
    with open(os.path.join(REPO, "decks", f"{stem}.toml"), "rb") as f:
        d = tomllib.load(f)
    names = {}
    for cid in set(d["cards"]):
        with open(os.path.join(REPO, "game", "cards", "set1", f"{cid}.toml"), "rb") as f:
            names[cid] = tomllib.load(f)["name"]
    return d["castle"], [(cid, names[cid]) for cid in d["cards"]]


class Registry:
    """UID -> the castle or copy k of one deck, appended to a scratch JSONL as tags are bound."""

    def __init__(self, path, stem, cards):
        real = os.path.realpath(path)
        if real.endswith(os.path.join(os.sep, "registry", "copies.jsonl")):
            raise SystemExit(f"{path}: the bridge's registry is scratch, never registry/copies.jsonl")
        self.path, self.stem, self.cards = path, stem, cards
        self.castle, self.copies = None, {}
        if os.path.exists(path):
            for line in open(path):
                row = json.loads(line)
                if row["deck"] != stem:
                    raise SystemExit(f"{path}: holds deck {row['deck']}, not {stem}")
                if row["role"] == "castle":
                    self.castle = row["uid"]
                else:
                    self.copies[row["uid"]] = row["copy"]

    def full(self):
        return self.castle is not None and len(self.copies) == len(self.cards)

    def bind(self, uid):
        """Bind a fresh `uid`: the castle first, then the next unbound copy. None when full."""
        if self.castle is None:
            self.castle = uid
            row = {"uid": uid, "role": "castle", "deck": self.stem}
        else:
            taken = set(self.copies.values())
            k = next((k for k in range(len(self.cards)) if k not in taken), None)
            if k is None:
                return None
            self.copies[uid] = k
            cid, name = self.cards[k]
            row = {"uid": uid, "role": "copy", "deck": self.stem, "copy": k, "design": cid, "name": name}
        with open(self.path, "a") as f:
            f.write(json.dumps(row) + "\n")
        return row


def load_bound(source):
    """The UIDs bound in scry's uid-map.json (upper-case), read-only: a local file, or
    `ssh:<host>` for ubox0's own copy."""
    if source.startswith("ssh:"):
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", source[4:], "cat", UID_MAP_PATH],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise SystemExit(f"uid-map from {source}: ssh exit {r.returncode}")
        text = r.stdout
    else:
        text = open(source).read()
    return {u.upper() for u in json.loads(text)}


# ---- the arena's remote seat -------------------------------------------------------------------


class Arena:
    """The remote seat's HTTP face (/remote/*), with one bearer token."""

    def __init__(self, base):
        self.base, self.token = base, None

    def call(self, method, path, body=None, timeout=15):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()
        except (urllib.error.URLError, ConnectionError, OSError):
            return 0, ""

    def choices(self):
        """(menu number, seat, menu items) or None when the arena did not answer."""
        status, body = self.call("GET", "/remote/choices")
        if status != 200:
            return None
        m = json.loads(body)
        return m["n"], m.get("seat"), m["menu"]

    def propose(self, n, i):
        return self.call("POST", "/remote/propose", {"n": n, "i": i})[0]


def lane_counts(view, seat):
    """Units in each lane on `seat`'s side of `view`, or None without a view."""
    try:
        return [sum(1 for c in lane if c) for lane in view["seats"][seat]["cells"]]
    except (TypeError, KeyError, IndexError):
        return None


def pick_cast(menu, design, counts):
    """0009's default cast of `design`: a unit into the legal lane with the fewest of the seat's
    units (lowest lane on a tie), a spell at the menu's first useful target (else its first).
    Returns a menu index or None when it cannot be cast now."""
    units = [(i, int(c["key"].split("/")[2])) for i, c in enumerate(menu) if c["key"].startswith(f"u/{design}/")]
    if units:
        return min(units, key=lambda x: ((counts or [0, 0, 0])[x[1]], x[1]))[0]
    spells = [i for i, c in enumerate(menu) if c["key"].startswith(f"s/{design}/")]
    useful = [i for i in spells if menu[i]["useful"]]
    return (useful or spells or [None])[0]


def my_turn(c, view):
    """The seat has a move on its OWN turn: `c` is `Arena.choices()`, `view` the latest board.
    A seat also owes opening draws during the other seat's turn, while the desk bot plays in real
    time, so a draw tapped then races the bot. A replay taps only on its own turn, where the bot
    is idle, so the same lines make the same match."""
    return bool(c and c[1] is not None and c[2] and view and view.get("phase") == "playing"
                and view.get("active") == c[1])


class Settle:
    """`my_turn`, and the menu number unchanged for `quiet` seconds: a prompt a person could read."""

    def __init__(self, quiet=0.15):
        self.quiet, self.seen = quiet, None

    def ready(self, c, views, now):
        """`views` is `Table.views`: the latest board view and when it arrived. The view must be
        quiet too, since the lane a unit is cast into is read from it."""
        if not my_turn(c, views["board"]()):
            self.seen = None
            return False
        if self.seen is None or self.seen[0] != c[0]:
            self.seen = (c[0], now)
        return now - self.seen[1] >= self.quiet and now - views["at"] >= self.quiet


def find(menu, key):
    return next((i for i, c in enumerate(menu) if c["key"] == key), None)


class Bridge:
    """Taps -> the remote seat's proposals. `arena` has `choices()` and `propose(n, i)`; `say`
    prints for the person at the station. `view()` returns the latest board view (lane counts)."""

    def __init__(self, cards, registry, bound, arena, say, view=lambda: None, reload_bound=None):
        self.cards, self.reg, self.bound, self.arena = cards, registry, bound, arena
        self.say, self.view, self.reload_bound = say, view, reload_bound
        self.hand, self.played = set(), set()  # copy indices
        self.pending = None  # (uid, k, t, recv): a first tap awaiting a second
        self.refused, self.proposed = [], []

    # -- helpers
    def name(self, k):
        return f"{self.cards[k][1]} (copy {k})"

    def seat_menu(self):
        c = self.arena.choices()
        return c if c else (None, None, [])

    def send(self, i, n, what):
        status = self.arena.propose(n, i)
        if status == 202:
            self.proposed.append(what)
            self.say(f"-> {what}")
            self.wait_commit(n)
            return True
        self.say(f"!! {what} not sent (HTTP {status})")
        return False

    def wait_commit(self, n, timeout=5.0):
        """Until the proposal made from menu `n` is committed: a new menu with moves in it, or the
        board says the seat's turn (or the match) is over. An empty menu alone is not enough: it
        is also what the seat shows while its tap is still pending."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            c = self.arena.choices()
            if c is None or (c[0] != n and c[2]):
                return
            v = self.view()
            if c[0] != n and v and (v.get("phase") != "playing" or v.get("active") != c[1]):
                return
            time.sleep(0.02)

    def refuse(self, uid, why):
        self.refused.append((uid, why))
        self.say(f"refused {uid}: {why}")

    # -- the tap grammar
    def tap(self, t, uid, recv=None):
        recv = time.monotonic() if recv is None else recv
        if self.reload_bound:
            self.bound = self.reload_bound() | self.bound
        if uid in self.bound:
            # Never a game card, and never resolved further: at scry this tag summons.
            self.refuse(uid, "bound in scry's uid-map (not a game card)")
            return
        if self.pending:
            puid, pk, pt, _ = self.pending
            if uid == puid and t - pt <= SECOND_TAP_S:
                self.pending = None
                self.charge(pk)
                return
            self.resolve()
        if uid != self.reg.castle and uid not in self.reg.copies:
            row = self.reg.bind(uid)
            if row is None:
                self.refuse(uid, "every copy of the deck is bound already")
                return
            if row["role"] == "castle":
                self.say(f"registered {uid} as the castle (tap it to pass)")
                return
            self.say(f"registered {uid} as {self.name(row['copy'])}")
        if uid == self.reg.castle:
            self.pass_turn(uid)
            return
        k = self.reg.copies[uid]
        n, seat, menu = self.seat_menu()
        if not menu:
            self.refuse(uid, "not your move")
            return
        design = design_num(self.cards[k][0])
        if k not in self.hand and k not in self.played:
            i = find(menu, f"d/{design}")
            if i is None:
                self.refuse(uid, f"{self.name(k)} is not in hand, and no draw is owed")
                return
            if self.send(i, n, f"draw {self.name(k)}"):
                self.hand.add(k)
            return
        if k in self.played:
            self.refuse(uid, f"{self.name(k)} was played already")
            return
        if any(c["kind"] == "Draw" for c in menu):
            self.refuse(uid, f"a draw is owed: tap a card not yet drawn ({self.name(k)} is in hand)")
            return
        self.pending = (uid, k, t, recv)
        self.say(f"cast {self.name(k)} in {SECOND_TAP_S:.0f} s; tap it again to charge instead")

    def tick(self, now=None):
        """Time passing: a first tap whose window has lapsed is cast."""
        now = time.monotonic() if now is None else now
        if self.pending and now - self.pending[3] > SECOND_TAP_S:
            self.resolve()

    def resolve(self):
        _, k, _, _ = self.pending
        self.pending = None
        n, seat, menu = self.seat_menu()
        i = pick_cast(menu, design_num(self.cards[k][0]), lane_counts(self.view(), seat) if seat is not None else None)
        if i is None:
            self.refuse(self.uid_of(k), f"{self.name(k)} cannot be cast now")
            return
        if self.send(i, n, f"cast {self.name(k)}: {menu[i]['label']}"):
            self.hand.discard(k)
            self.played.add(k)

    def charge(self, k):
        n, seat, menu = self.seat_menu()
        i = find(menu, f"c/{design_num(self.cards[k][0])}")
        if i is None:
            self.refuse(self.uid_of(k), f"{self.name(k)} cannot be charged now")
            return
        if self.send(i, n, f"charge {self.name(k)}"):
            self.hand.discard(k)
            self.played.add(k)

    def pass_turn(self, uid):
        n, seat, menu = self.seat_menu()
        i = find(menu, "p")
        if i is None:
            self.refuse(uid, "cannot pass now" + (" (not your move)" if not menu else " (a draw is owed?)"))
            return
        self.send(i, n, "pass")

    def uid_of(self, k):
        return next((u for u, c in self.reg.copies.items() if c == k), "?")


def last_line(path):
    """The last complete JSON line of `path`, or None (reads only the file's tail)."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 65536))
            tail = f.read().split(b"\n")
    except OSError:
        return None
    for line in reversed(tail):
        if line.strip():
            try:
                return json.loads(line)
            except ValueError:
                return None  # a line still being written
    return None


class Table:
    """`tapstone-arena --desk --remote <deck> --once` with a scratch ledger in `run`, joined as the
    remote seat. `views["last"]` is the latest board view, `views["final"]` the finished match's."""

    def __init__(self, arena_bin, run, deck, desk_seed, port):
        board, remote = f"127.0.0.1:{port}", f"127.0.0.1:{port + 1}"
        args = [arena_bin, "--desk", "--desk-seed", str(desk_seed), "--remote", deck, "--once",
                "--ledger", os.path.join(run, "ledger.sqlite"), "--bind", board, "--remote-bind", remote,
                "--record", os.path.join(run, "views.jsonl")]
        self.proc = proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.winner, code, got = [None], [], threading.Event()

        def drain():
            with open(os.path.join(run, "arena.log"), "w") as f:
                for line in proc.stdout:
                    f.write(line)
                    f.flush()
                    if line.startswith("remote join code:") and not code:
                        code.append(line.split(":", 1)[1].strip())
                        got.set()
                    if " over, winner " in line:
                        self.winner[0] = line.strip()

        threading.Thread(target=drain, daemon=True).start()
        if not got.wait(30):
            proc.kill()
            raise RuntimeError("the arena printed no join code in 30 s (see arena.log)")
        self.arena = arena = Arena(f"http://{remote}")
        status, body = arena.call("POST", "/remote/join", {"code": code[0]})
        if status != 200:
            proc.kill()
            raise RuntimeError(f"join: HTTP {status}")
        arena.token = json.loads(body)["token"]
        record = os.path.join(run, "views.jsonl")
        # The board as the arena committed it: `--record` is written in the same loop turn as the
        # commit and BEFORE the remote menus are refreshed, so any menu the seat sees already has
        # its view in the file. The HTTP view below can lag the menu (a thread and a round trip),
        # which made two replays of one journal cast into different lanes.
        self.views = views = {"last": None, "final": None, "at": 0.0, "board": lambda: last_line(record)}

        def watch():
            after = 0
            while proc.poll() is None:
                s, b = arena.call("GET", f"/remote/view?after={after}", timeout=15)
                if s == 200:
                    v = json.loads(b)
                    after = v["n"]
                    views["last"], views["at"] = v["view"], time.monotonic()
                    if v["view"].get("phase") == "over" or v["view"].get("last_over"):
                        views["final"] = v["view"].get("last_over") or v["view"]
                elif s == 0:
                    time.sleep(0.1)

        threading.Thread(target=watch, daemon=True).start()


# ---- sources -----------------------------------------------------------------------------------


STREAMS = []  # the live ssh streams, killed on exit


def live_lines(host, q):
    """Every new scry-glass journal line, token already stripped on `host`, into `q`."""
    # `journalctl -f` only notices a closed ssh when it next writes, which may be hours: the remote
    # side holds our stdin, and when it closes (we exited, or ssh died) kills its whole group.
    cmd = f"(journalctl -u scry-glass -f -o short-unix -n 0 | {REMOTE_STRIP}) & cat >/dev/null; kill 0"
    p = subprocess.Popen(["ssh", "-o", "BatchMode=yes", host, cmd], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, text=True)
    STREAMS.append(p)
    for line in p.stdout:
        q.put((strip_token(line.rstrip("\n")), time.monotonic()))
    q.put((None, time.monotonic()))
    return p


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("play")
    p.add_argument("--arena", required=True, help="the tapstone-arena binary")
    p.add_argument("--run-dir", required=True, help="a new directory (refused if it exists)")
    p.add_argument("--deck", default="tide-neutral")
    p.add_argument("--desk-seed", type=int, default=11)
    p.add_argument("--source", default="ssh:ubox0", help="ssh:<host> (live) or a journal file (replay)")
    p.add_argument("--uid-map", default="ssh:ubox0", help="ssh:<host> or a local uid-map.json")
    p.add_argument("--registry", help="the scratch registry (default <run-dir>/scry-registry.jsonl)")
    p.add_argument("--port", type=int, default=17890, help="board port; the remote seat is port+1")
    p.add_argument("--deadline-s", type=float, default=3600)
    p.add_argument("--idle-s", type=float, default=20, help="replay: after the last line, wait this long")
    a = ap.parse_args(argv)

    run = os.path.abspath(a.run_dir)
    if os.path.exists(run):
        print(f"{run} exists: a run dir is fresh", file=sys.stderr)
        return 2
    os.makedirs(run)
    log = open(os.path.join(run, "bridge.log"), "a")

    def say(msg):
        line = strip_token(f"[scry] {msg}")
        print(line, flush=True)
        log.write(f"{time.time():.3f} {line}\n")
        log.flush()

    castle_id, cards = load_deck(a.deck)
    reg = Registry(a.registry or os.path.join(run, "scry-registry.jsonl"), a.deck, cards)
    bound = load_bound(a.uid_map)
    say(f"deck {a.deck}: {len(cards)} copies; {len(bound)} scry-bound UIDs refused; "
        f"registry {reg.path} ({len(reg.copies)} copies bound, castle {'bound' if reg.castle else 'not yet'})")

    try:
        table = Table(a.arena, run, a.deck, a.desk_seed, a.port)
    except RuntimeError as e:
        say(str(e))
        return 2
    proc, arena, views, winner = table.proc, table.arena, table.views, table.winner
    # Re-read scry's map before taps, so a tag bound during the match is refused too: a local file
    # every tap, ubox0's at most every 30 s (an ssh round trip).
    cache = {"at": time.monotonic(), "bound": bound}

    def reload():
        if a.uid_map.startswith("ssh:") and time.monotonic() - cache["at"] < 30:
            return cache["bound"]
        try:
            fresh = load_bound(a.uid_map)
        except (SystemExit, OSError, subprocess.TimeoutExpired, ValueError) as e:
            say(f"uid-map reload failed ({e}); keeping the last one")
            fresh = cache["bound"]
        cache["at"], cache["bound"] = time.monotonic(), fresh
        return fresh

    bridge = Bridge(cards, reg, bound, arena, say, view=views["board"], reload_bound=reload)

    replay = not a.source.startswith("ssh:")
    q = queue.Queue()
    if replay:
        lines = iter(open(a.source).read().splitlines())
    else:
        threading.Thread(target=live_lines, args=(a.source[4:], q), daemon=True).start()
        say("listening to scry-glass on " + a.source[4:])
    start, eof_at, fed, last_prompt, settle = time.monotonic(), None, 0, None, Settle()
    while proc.poll() is None:
        now = time.monotonic()
        if now - start > a.deadline_s or (eof_at is not None and now - eof_at > a.idle_s):
            break
        bridge.tick(now)
        c = arena.choices()
        menu = c[2] if c else []
        prompt = None
        if c and c[1] is not None and menu:
            draws = sum(1 for m in menu if m["kind"] == "Draw")
            hand = ", ".join(bridge.name(k) for k in sorted(bridge.hand)) or "empty"
            prompt = (f"YOUR MOVE (seat {c[1]}): " + ("DRAW: tap a fresh tag or an undrawn card" if draws
                      else f"tap a card in hand to cast (twice to charge), the castle to pass; hand: {hand}"))
        if prompt and prompt != last_prompt:
            say(prompt)
        last_prompt = prompt
        if replay:
            if eof_at is None and settle.ready(c, views, now):
                line = next(lines, None)
                while line is not None and parse_line(line) is None:
                    line = next(lines, None)
                if line is None:
                    eof_at = now
                    say(f"replay: end of journal after {fed} taps")
                else:
                    t, uid = parse_line(line)
                    fed += 1
                    bridge.tap(t, uid, now)
        else:
            try:
                while True:
                    line, recv = q.get_nowait()
                    if line is None:
                        say("the journal stream ended")
                        eof_at = now
                        break
                    tap = parse_line(line)
                    if tap:
                        fed += 1
                        bridge.tap(tap[0], tap[1], recv)
            except queue.Empty:
                pass
        time.sleep(0.02)

    for stream in STREAMS:
        stream.kill()
    stalled = proc.poll() is None
    if stalled:
        proc.kill()
    rc = proc.wait()
    time.sleep(0.2)
    board = views["board"]() or {}
    final = views["final"] or board.get("last_over") or (board if board.get("phase") == "over" else {})
    summary = {
        "match_id": final.get("match_id"),
        "head": final.get("head"),
        "heard_result": bool(final) and not stalled,
        "winner": final.get("winner"),
        "source": "the board the remote seat saw (--record / /remote/view), from the arena's process: not independent of it",
        "taps": fed,
        "proposed": len(bridge.proposed),
        "refused": [u for u, _ in bridge.refused],
        "arena_exit": rc,
    }
    with open(os.path.join(run, "shrine.json"), "w") as f:
        json.dump(summary, f, indent=1)
    if stalled:
        say(f"STALLED: no result ({fed} taps fed, {len(bridge.proposed)} proposed)")
        return 3
    say(f"arena exit {rc}: {winner[0]}; {fed} taps, {len(bridge.proposed)} proposed, {len(bridge.refused)} refused")
    return 0 if rc == 0 and summary["match_id"] else 1


if __name__ == "__main__":
    sys.exit(main())
