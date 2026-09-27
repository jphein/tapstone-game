#!/usr/bin/env python3
"""End-to-end check of the remote seat (plan 2026-09-26, Task A7).

Starts `tapstone-arena --desk --remote ember-neutral --once`, joins with the code it prints, and
plays the remote seat through /remote/* only. Each time, it proposes the first useful
non-mulligan item, as the web gate does. It passes when the arena exits 0 after the match (--once)
and the remote seat made at least 5 taps.

--no-propose is the control: the same run with no proposals must stall, and the script then
exits 1 at its deadline.

--two is JP against a second player: `--desk --remote ember-neutral --remote tide-neutral --once`, no bot.
It joins both slots' codes and drives both tokens; it passes when the arena exits 0 and each slot
made at least 5 taps. With --two, --no-propose leaves slot 1 alone (joined, never proposing) while
slot 0 plays: that run must stall.

usage: remote_smoke.py <path/to/tapstone-arena> [--two] [--no-propose]
"""
import http.client
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ARENA = sys.argv[1]
NO_PROPOSE = "--no-propose" in sys.argv
TWO = "--two" in sys.argv
DECKS = ["ember-neutral", "tide-neutral"] if TWO else ["ember-neutral"]
BIND = "127.0.0.1:17791"
BOARD = "127.0.0.1:17790"  # not the default 7790, so a smoke never collides with a running playtest arena
BASE = f"http://{BIND}"
DEADLINE = time.time() + (30 if NO_PROPOSE else 180)

args = [ARENA, "--desk"]
for d in DECKS:
    args += ["--remote", d]
args += ["--remote-bind", BIND, "--bind", BOARD, "--once"]
proc = subprocess.Popen(args, stdout=subprocess.PIPE, text=True)
codes, winner = {}, None
got_code = threading.Event()


def drain():
    """Read the arena's stdout to the end, so it never blocks on a full pipe. One slot prints
    `remote join code: X`; two print `remote join code (slot K): X`, one line each."""
    global winner
    for line in proc.stdout:
        if line.startswith("remote join code") and len(codes) < len(DECKS):
            head, code = line.split(":", 1)
            slot = int(head.split("slot")[1].strip(" )")) if "slot" in head else 0
            codes.setdefault(slot, code.strip())
            if len(codes) == len(DECKS):
                got_code.set()
        if " over, winner " in line:
            winner = line.strip()


threading.Thread(target=drain, daemon=True).start()
if not got_code.wait(30):
    proc.kill()
    sys.exit(f"join codes printed: {codes}, wanted {len(DECKS)}")


def call(method, path, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except (urllib.error.URLError, ConnectionError, http.client.HTTPException):
        return 0, ""  # the arena went away mid-request (--once exits once the match is delivered)


tokens = []
for slot in range(len(DECKS)):
    status, body = call("POST", "/remote/join", body={"code": codes[slot]})
    if status != 200:
        proc.kill()
        sys.exit(f"join slot {slot}: {status} {body}")
    tokens.append(json.loads(body)["token"])
# Who proposes: every slot; the control leaves the last slot alone (with one slot, nobody plays).
players = range(len(tokens) - 1) if NO_PROPOSE else range(len(tokens))
after, taps, seats = 0, [0] * len(tokens), [None] * len(tokens)
done = False
while not done and proc.poll() is None and time.time() < DEADLINE:
    # Every menu change comes with a commit and so a view: wait for the next, then ask each slot.
    status, body = call("GET", f"/remote/view?after={after}", tokens[0])
    if status == 0:
        break  # the arena exited
    if status == 200:
        after = json.loads(body)["n"]
    elif status == 401:
        break  # a newer join retired this token
    for slot in players:
        status, body = call("GET", "/remote/choices", tokens[slot])
        if status == 0:
            done = True
            break
        if status != 200:
            continue
        menu = json.loads(body)
        seats[slot] = menu.get("seat") if menu.get("seat") is not None else seats[slot]
        pick = next((i for i, c in enumerate(menu["menu"]) if c["useful"] and c["kind"] != "Mulligan"), None)
        if pick is not None and call("POST", "/remote/propose", tokens[slot], {"n": menu["n"], "i": pick})[0] == 202:
            taps[slot] += 1

try:
    rc = proc.wait(timeout=max(1, DEADLINE - time.time()))
except subprocess.TimeoutExpired:
    proc.kill()
    print(f"STALLED after {taps} remote taps per slot (the arena never finished the match)")
    sys.exit(1)
print(f"arena exit {rc}, {taps} remote taps per slot, seats seen in choices {seats}, {winner}")
# One slot plays seat 1 beside the bot; two slots hold both seats, one each.
want = [0, 1] if TWO else [1]
if sorted(seats, key=str) != want:
    sys.exit(f"choices named seats {seats}, wanted {want}")
sys.exit(0 if rc == 0 and min(taps) >= 5 else 1)
