#!/usr/bin/env python3
"""Plays the fake arena to the end over HTTP, as the Roblox server would, and checks the contract
it relies on: codes, 403 on a wrong code, 429 for a source past ten wrong codes (that source
only: the real seats still join), 409 on a second join, 401 without a token, 404 off
/remote/, 415 without JSON, numbered views with no gaps, per-seat menus, 409 on a stale menu,
and 401 on choices after the match with views still readable. Exit 0 pass, 1 fail.

    python3 tools/fake_arena_check.py                  # slots are seats
    python3 tools/fake_arena_check.py --slot0-second   # slot 0 claims second: its code plays seat 1
"""
import atexit, json, os, subprocess, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
SWAPPED = "--slot0-second" in sys.argv  # slot 0 claims second: slot 0's code plays seat 1


def free_port():
    """A port nothing holds right now. A fixed port once collided with an ssh -L forward to the
    real arena, and the check talked to the real arena instead of the fake."""
    import socket
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


PORT = free_port()
proc = subprocess.Popen([sys.executable, os.path.join(HERE, "fake_arena.py"), "--bind", f"127.0.0.1:{PORT}",
                         "--hold", "0.5"] + (["--slot0-second"] if SWAPPED else []), stdout=subprocess.PIPE, text=True)
atexit.register(proc.kill)  # a check that dies halfway must not leave the fake holding its port
codes = []
while len(codes) < 2:
    line = proc.stdout.readline()
    if line.startswith("remote join code: "):
        codes.append(line.split(": ")[1].strip())
time.sleep(0.3)
BASE = f"http://127.0.0.1:{PORT}"
fails = []


def call(method, path, body=None, token=None, ctype="application/json", client=None, with_headers=False):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode())
    if client:
        req.add_header("CF-Connecting-IP", client)
    if body is not None and ctype:
        req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            data = r.read()
            out = r.status, (json.loads(data) if data else None)
            return out + (r.headers,) if with_headers else out
    except urllib.error.HTTPError as e:
        return (e.code, None, e.headers) if with_headers else (e.code, None)


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        fails.append(what)


check(call("POST", "/remote/join", {"code": "ZZZZZZ"})[0] == 403, "a wrong code is 403")
# A URL-holder guessing through the tunnel: ten wrong codes, then that source waits (429), and
# only that source. The joins below come from another source and must still succeed.
TROLL = "198.51.100.7"
check([call("POST", "/remote/join", {"code": "ZZZZZZ"}, client=TROLL)[0] for _ in range(10)] == [403] * 10,
      "ten wrong codes from one source are each 403")
st, _, hdrs = call("POST", "/remote/join", {"code": codes[0]}, client=TROLL, with_headers=True)
check(st == 429 and hdrs.get("Retry-After") == "1", f"then that source gets 429, Retry-After 1, even with a right code ({st})")
check(call("POST", "/remote/join", {"code": codes[0]}, ctype="text/plain")[0] == 415, "a join without JSON is 415")
check(call("GET", "/remote/view?after=0")[0] == 401, "a view without a token is 401")
check(call("GET", "/dev/tap")[0] == 404, "/dev/tap is 404")
s0, j0 = call("POST", "/remote/join", {"code": codes[0]})
s1, j1 = call("POST", "/remote/join", {"code": codes[1]})
check(s0 == 200 and s1 == 200, "both codes join")
check(call("POST", "/remote/join", {"code": codes[1]})[0] == 409, "a second join is 409")
# The arena seat of each token, from choices: the authority (a code names a slot, not a seat).
seat_a = call("GET", "/remote/choices", token=j0["token"])[1]["seat"]
seat_b = call("GET", "/remote/choices", token=j1["token"])[1]["seat"]
if SWAPPED:
    check(j0["seat"] is None and j1["seat"] is None, "joins answer seat null (the claim lands later)")
    check((seat_a, seat_b) == (1, 0), f"slot 0's token plays seat 1, per choices ({seat_a}, {seat_b})")
else:
    check(j0["seat"] == 0 and j1["seat"] == 1, "each code joins its own seat")
    check((seat_a, seat_b) == (0, 1), f"choices names each token's seat ({seat_a}, {seat_b})")
tok = {seat_a: j0["token"], seat_b: j1["token"]}
n, seen, moves, stale_checked = 0, [], 0, False
while True:
    st, v = call("GET", f"/remote/view?after={n}", token=tok[0])
    if st == 204:
        break
    seen.append(v["n"])
    n = v["n"]
    for seat in (0, 1):
        cs, m = call("GET", "/remote/choices", token=tok[seat])
        if cs != 200 or not m["menu"]:
            continue
        if not stale_checked:
            check(call("POST", "/remote/propose", {"n": m["n"] - 1, "i": 0}, token=tok[seat])[0] == 409, "a stale menu is 409")
            check(call("POST", "/remote/propose", {"n": m["n"], "i": 5}, token=tok[seat])[0] == 400, "a bad index is 400")
            stale_checked = True
        if call("POST", "/remote/propose", {"n": m["n"], "i": 0}, token=tok[seat])[0] == 202:
            moves += 1
check(seen == list(range(seen[0], seen[0] + len(seen))), f"views numbered with no gap ({len(seen)} views)")
check(moves == 77, f"every committed fixture record was proposed ({moves} of 77)")
check(call("GET", "/remote/choices", token=tok[1])[0] == 401, "after the match, choices is 401")
check(call("GET", f"/remote/view?after={n - 1}", token=tok[1])[0] == 200, "after the match, views are still readable")
proc.terminate()
print(f"{'PASS' if not fails else 'FAIL'}: {len(fails)} failed")
sys.exit(1 if fails else 0)
