#!/usr/bin/env python3
"""A stand-in for the arena's remote API (Part A's contract), for Studio work without the arena.

    python3 tools/fake_arena.py [--bind 127.0.0.1:7791] [--hold 10]

It serves the four /remote/* routes for TWO remote seats and replays one real match, the desk
fixture (rust/tapstone-arena/web/fixtures/desk-seed11.jsonl), one view per accepted move:
- it prints one `remote join code: XXXXXX` line per slot (slot 0 first), and shows them in the
  lobby view as `remote_codes`; a slot is not a seat: with --slot0-second, slot 0's code plays
  arena seat 1, and only `/remote/choices` (its `seat`) says so, as in the real arena;
- once both seats have joined, the match starts at the fixture's first view;
- the seat that committed the fixture's next record gets a one-item menu ("next"); proposing it
  publishes the next view; the other seat's menu is empty;
- at the fixture's "over" view both tokens get 401 on choices and propose (views stay readable),
  and the fixture's closing lobby frame (with last_over) follows on its own.
It holds no rules: it exists to exercise the Roblox place (polling, drawing, menus, seating, the
relay), never to judge a move. Stdlib only.
"""
import argparse, json, math, os, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # Part A's: no 0/O/1/I
HERE = os.path.dirname(os.path.abspath(__file__))

ap = argparse.ArgumentParser()
ap.add_argument("--bind", default="127.0.0.1:7791")
ap.add_argument("--hold", type=float, default=10.0, help="long-poll hold in seconds")
ap.add_argument("--null-seat", action="store_true", help='answer joins with "seat": null (claim not landed yet)')
ap.add_argument("--slot0-second", action="store_true",
                help="slot 0 claims SECOND, so slot 0's code plays arena seat 1 (implies --null-seat)")
ap.add_argument("--fixture", default=os.path.join(HERE, "../../rust/tapstone-arena/web/fixtures/desk-seed11.jsonl"))
args = ap.parse_args()

FIXTURE = [json.loads(line) for line in open(args.fixture) if line.strip()]
lock = threading.Condition()
codes = ["".join(secrets.choice(ALPHABET) for _ in range(6)) for _ in range(2)]
tokens = [None, None]  # by SLOT (the code's index); a slot is not a seat
SEAT_OF_SLOT = [1, 0] if args.slot0_second else [0, 1]  # arena seat by slot, from claim order
NULL_SEAT = args.null_seat or args.slot0_second
wrong = {}  # by source: [wrong codes, not evaluated before this time.monotonic()] (0038, amended 2026-09-27)
FREE_WRONG, BACKOFF_CAP = 10, 60
views = []  # [(n, view)]
cursor = [-1]  # index into FIXTURE of the last published view; -1 = lobby
menu_n = [0, 0]
over = [False]


def lobby_view():
    return {"phase": "lobby", "match_id": None, "round": 0, "active": 0, "seq": 0, "seats": [],
            "lobby": [], "last": None, "winner": None, "head": None, "last_over": None,
            "remote_codes": [c if tokens[i] is None else None for i, c in enumerate(codes)]}


def publish(view):
    views.append((len(views) + 1, view))
    menu_n[0] += 1
    menu_n[1] += 1
    lock.notify_all()


def mover():
    """The seat whose move is next: the seat that committed the fixture's next record."""
    nxt = cursor[0] + 1
    if cursor[0] < 0 or nxt >= len(FIXTURE) or over[0]:
        return None
    last = FIXTURE[nxt].get("last") or {}
    return last.get("seat")


def menu(seat):
    if mover() != seat:
        return []
    return [{"key": "next", "label": f"move {cursor[0] + 2} of {len(FIXTURE)} (fake)", "kind": "Pass", "useful": True}]


with lock:
    publish(lobby_view())
for slot, c in enumerate(codes):
    print(f"remote join code: {c}", flush=True)


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        print(f"{self.command} {self.path} -> {a[1] if len(a) > 1 else ''}", flush=True)

    def reply(self, status, body=None, headers=()):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        if body is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def seat_of(self, may_view=False):
        """The ARENA seat of the caller's token (through its slot), or None."""
        auth = self.headers.get("Authorization", "")
        for slot, t in enumerate(tokens):
            if t and auth == f"Bearer {t}":
                if over[0] and not may_view:
                    return None
                return SEAT_OF_SLOT[slot]
        return None

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if self.headers.get("Content-Type", "") != "application/json":
            return "415"
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return None

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/remote/view":
            if self.seat_of(may_view=True) is None:
                return self.reply(401)
            after = int(parse_qs(u.query).get("after", ["0"])[0])
            deadline = time.time() + args.hold
            with lock:
                while True:
                    later = [v for v in views if v[0] > after]
                    if later:
                        n, view = later[0]
                        return self.reply(200, {"n": n, "view": view})
                    left = deadline - time.time()
                    if left <= 0:
                        return self.reply(204)
                    lock.wait(left)
        if u.path == "/remote/choices":
            seat = self.seat_of()
            if seat is None:
                return self.reply(401)
            with lock:
                return self.reply(200, {"n": menu_n[seat], "seat": seat, "menu": menu(seat)})
        return self.reply(404)

    def do_POST(self):
        u = urlparse(self.path)
        b = self.body()
        if b == "415":
            return self.reply(415)
        if u.path == "/remote/join":
            with lock:
                # the arena's source: Cloudflare's client address behind a loopback peer
                peer = self.client_address[0]
                cf = self.headers.get("CF-Connecting-IP")
                src = cf.strip() if cf and peer in ("127.0.0.1", "::1") else peer
                strikes = wrong.setdefault(src, [0, 0.0])
                now = time.monotonic()
                if now < strikes[1]:
                    return self.reply(429, headers=[("Retry-After", str(math.ceil(strikes[1] - now)))])
                code = (b or {}).get("code")
                if code not in codes:
                    strikes[0] += 1
                    if strikes[0] >= FREE_WRONG:
                        strikes[1] = now + min(BACKOFF_CAP, 2 ** (strikes[0] - FREE_WRONG))
                    return self.reply(403)
                slot = codes.index(code)
                if tokens[slot] is not None:
                    return self.reply(409)
                tokens[slot] = secrets.token_hex(16)
                if all(tokens):
                    cursor[0] = 0
                    publish(FIXTURE[0])
                else:
                    publish(lobby_view())
                return self.reply(200, {"token": tokens[slot], "seat": None if NULL_SEAT else SEAT_OF_SLOT[slot]})
        if u.path == "/remote/propose":
            seat = self.seat_of()
            if seat is None:
                return self.reply(401)
            with lock:
                if not isinstance(b, dict) or b.get("n") != menu_n[seat]:
                    return self.reply(409)
                items = menu(seat)
                if not isinstance(b.get("i"), int) or not 0 <= b["i"] < len(items):
                    return self.reply(400)
                cursor[0] += 1
                publish(FIXTURE[cursor[0]])
                if FIXTURE[cursor[0]].get("phase") == "over":
                    # The match is over: tokens stop playing, and the arena returns to the lobby
                    # with the finished board (the fixture's last frame, which no seat commits).
                    over[0] = True
                    while cursor[0] + 1 < len(FIXTURE):
                        cursor[0] += 1
                        publish(FIXTURE[cursor[0]])
                return self.reply(202)
        return self.reply(404)


host, port = args.bind.rsplit(":", 1)
print(f"fake arena on http://{args.bind}/remote/ ({len(FIXTURE)} fixture views)", flush=True)
ThreadingHTTPServer((host, int(port)), H).serve_forever()
