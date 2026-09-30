#!/usr/bin/env python3
"""A whole Tapstone match over the real ESP-NOW radio (tapstone#132 item 1; runbook
docs/runbooks/radio-match.md).

Seat A is the arena's remote seat (0038) in GATEWAY mode, its SerialLink on the arena gateway, played
through /remote/* the way remote_smoke.py plays it. Seat B is `radio_shrine play`: a desk-style
shrine (the reference follower plus a ScriptedSeat) behind the second gateway. Every frame between
the arena and seat B crosses both gateways and the air.

    radio_match.py --bin-dir DIR --run-dir DIR --arena-mac MAC --shrine-mac MAC [--no-propose]

--bin-dir holds tapstone-arena and radio_shrine. --run-dir must not exist yet: it gets its own
arena.toml, registry.jsonl and ledger.sqlite (never ~/.config/tapstone-arena or JP's ledger), both
serial traces, both logs and the shrine's summary. The ledger may not live under /tmp or /var/tmp
(config.rs refuses), so neither may the run dir.

Exit 0: the arena finished the match (--once exited 0) and the shrine heard RESULT. With
--no-propose (the stall control: seat B proposes nothing) the run must NOT finish: exit 0 means it
stalled until the deadline as it should, exit 1 means a match finished with a silent seat.
Exit 1 otherwise on any failure; 2 on a setup error.
"""
import argparse
import glob
import http.client
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--bin-dir", required=True)
ap.add_argument("--run-dir", required=True)
ap.add_argument("--arena-mac", required=True, help="the arena gateway's MAC (seat A's SerialLink)")
ap.add_argument("--shrine-mac", required=True, help="the shrine gateway's MAC (seat B)")
ap.add_argument("--shrine-deck", default="tide-neutral")
ap.add_argument("--remote-deck", default="ember-neutral")
ap.add_argument("--seed", type=int, default=11)
ap.add_argument("--no-propose", action="store_true")
ap.add_argument("--firmware-shrine", action="store_true",
                help="seat B is smol's shrine station firmware on --shrine-mac (tapstone#132 c): no "
                     "radio_shrine; its console is read, and its FINAL line is the shrine's head")
ap.add_argument("--shrine-index", type=int, default=0, help="seat B's figurine/copy index (the image's TAPSTONE_INDEX)")
ap.add_argument("--deadline", type=int, default=0, help="seconds (default 600, or 90 for the control)")
args = ap.parse_args()
DEADLINE_S = args.deadline or (90 if args.no_propose else 600)
BIND, BOARD = "127.0.0.1:17791", "127.0.0.1:17790"
BASE = f"http://{BIND}"
run = os.path.abspath(args.run_dir)
arena_bin = os.path.join(args.bin_dir, "tapstone-arena")
shrine_bin = os.path.join(args.bin_dir, "radio_shrine")


def by_id(mac):
    hits = glob.glob(f"/dev/serial/by-id/*{mac.upper()}*")
    if len(hits) != 1:
        sys.exit(f"setup: {len(hits)} by-id ports for {mac}: {hits}")
    return hits[0]


if os.path.exists(run):
    sys.exit(f"setup: {run} exists; every run gets a fresh ledger")
os.makedirs(run)
shrine_port = by_id(args.shrine_mac)
by_id(args.arena_mac)  # present, or stop here
with open(os.path.join(run, "registry.jsonl"), "w") as f:
    subprocess.run([shrine_bin, "registry", "--deck", args.shrine_deck, "--index", str(args.shrine_index)],
                   stdout=f, check=True)
with open(os.path.join(run, "arena.toml"), "w") as f:
    f.write(
        f'gateway_mac = "{args.arena_mac.lower()}"\n'
        # The arena opens its board by this path ALONE (arena.toml gateway_port): without it the
        # arena scans every Espressif USB port with @TS1 PING, the scry on the table among them.
        f'gateway_port = "{by_id(args.arena_mac)}"\n'
        f'http_bind = "{BOARD}"\n'
        f'ledger_path = "{run}/ledger.sqlite"\n'
        f'registry_path = "{run}/registry.jsonl"\n'
    )

t_start = time.time()
fw = {"lines": [], "stop": threading.Event()}


def read_firmware_shrine():
    import serial  # pyserial; only the firmware mode needs it
    s = serial.Serial(shrine_port, 115200, timeout=0.2)
    buf = b""
    with open(os.path.join(run, "shrine.trace"), "w") as out:
        while not fw["stop"].is_set():
            buf += s.read(4096)
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode(errors="replace").rstrip("\r")
                fw["lines"].append(text)
                out.write(f"{int(time.time() * 1e6)} < {text}\n")
                out.flush()


if args.firmware_shrine:
    # Opened before the arena starts, so its discovery finds the station's port busy.
    threading.Thread(target=read_firmware_shrine, daemon=True).start()
    time.sleep(1)
env = dict(os.environ, TAPSTONE_SERIAL_TRACE=os.path.join(run, "arena.trace"))
arena = subprocess.Popen(
    [arena_bin, "--config", os.path.join(run, "arena.toml"), "--remote", args.remote_deck,
     "--remote-bind", BIND, "--bind", BOARD, "--once"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
state = {"code": None, "node": None, "winner": None}
ready = threading.Event()
arena_log = open(os.path.join(run, "arena.log"), "w")


def drain_arena():
    for line in arena.stdout:
        arena_log.write(f"{time.time() - t_start:8.3f} {line}")
        arena_log.flush()
        if line.startswith("gateway ") and ", node " in line:
            state["node"] = int(line.rsplit("node ", 1)[1])
        if line.startswith("remote join code:") and state["code"] is None:
            state["code"] = line.split(":", 1)[1].strip()
        if " over, winner " in line:
            state["winner"] = line.strip()
        if state["node"] is not None and state["code"] is not None:
            ready.set()
    ready.set()


threading.Thread(target=drain_arena, daemon=True).start()
if not ready.wait(20) or state["node"] is None or state["code"] is None:
    arena.kill()
    sys.exit(f"setup: the arena did not come up on its gateway: {state} (see {run}/arena.log)")
print(f"arena up: gateway node {state['node']}, join code {state['code']}")

# Only now open the shrine's port: discovery opens every Espressif port once while it looks.
shrine_cmd = [shrine_bin, "play", "--port", shrine_port, "--deck", args.shrine_deck, "--index", "0",
              "--seed", str(args.seed), "--arena-node", str(state["node"]),
              "--trace", os.path.join(run, "shrine.trace"), "--summary", os.path.join(run, "shrine.json"),
              "--deadline-s", str(DEADLINE_S + 30)]
if args.no_propose:
    shrine_cmd.append("--no-propose")
shrine_log = open(os.path.join(run, "shrine.log"), "w")


class Firmware:
    """The station stands in for `radio_shrine play`: it is always running, and exits 0."""
    returncode = 0

    def poll(self):
        return None

    def wait(self, timeout=None):
        return 0

    def terminate(self):
        pass

    def kill(self):
        pass


shrine = Firmware() if args.firmware_shrine else subprocess.Popen(shrine_cmd, stdout=shrine_log, stderr=subprocess.STDOUT)


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
        return 0, ""


status, body = call("POST", "/remote/join", body={"code": state["code"]})
if status != 200:
    arena.kill(); shrine.kill()
    sys.exit(f"join: {status} {body}")
token = json.loads(body)["token"]
deadline = time.time() + DEADLINE_S
after, taps, seat = 0, 0, None
while arena.poll() is None and time.time() < deadline:
    if shrine.poll() not in (None, 0):
        arena.kill()
        sys.exit(f"the shrine exited {shrine.returncode} mid-match (see {run}/shrine.log)")
    status, body = call("GET", f"/remote/view?after={after}", token)
    if status == 0:
        break
    if status == 200:
        after = json.loads(body)["n"]
    elif status == 401:
        break
    status, body = call("GET", "/remote/choices", token)
    if status != 200:
        continue
    menu = json.loads(body)
    seat = menu.get("seat") if menu.get("seat") is not None else seat
    pick = next((i for i, c in enumerate(menu["menu"]) if c["useful"] and c["kind"] != "Mulligan"), None)
    if pick is not None and call("POST", "/remote/propose", token, {"n": menu["n"], "i": pick})[0] == 202:
        taps += 1

finished = False
try:
    rc = arena.wait(timeout=max(1, deadline - time.time()))
    finished = rc == 0 and state["winner"] is not None
except subprocess.TimeoutExpired:
    rc = None
    arena.terminate()
    try:
        arena.wait(timeout=5)
    except subprocess.TimeoutExpired:
        arena.kill()
try:
    shrine_rc = shrine.wait(timeout=30 if finished else 5)
except subprocess.TimeoutExpired:
    shrine.terminate()
    shrine_rc = shrine.wait(timeout=5)
elapsed = time.time() - t_start
if args.firmware_shrine:
    import re
    time.sleep(3)  # the station's FINAL line follows the last commit by one service pass
    fw["stop"].set()
    fin, heard = None, set()
    for ln in fw["lines"]:
        m = re.search(r"\[station\] FINAL match ([0-9a-f]{8}) .*? head ([0-9a-f]{16})", ln)
        fin = m or fin
        m = re.search(r"\[station\] RESULT match ([0-9a-f]{8})", ln)
        if m:
            heard.add(m.group(1))
    with open(os.path.join(run, "shrine.json"), "w") as f:
        json.dump({} if fin is None else {"match_id": fin.group(1), "head": fin.group(2),
                                          "heard_result": fin.group(1) in heard,
                                          "proposed": "firmware"}, f)
summary = {}
try:
    summary = json.load(open(os.path.join(run, "shrine.json")))
except (OSError, ValueError):
    pass
line = (f"arena exit {rc}, {state['winner']}, remote seat {seat} made {taps} taps, shrine exit {shrine_rc}, "
        f"shrine proposed {summary.get('proposed')} heard_result {summary.get('heard_result')}, {elapsed:.1f} s")
print(line)
with open(os.path.join(run, "radio_match.txt"), "w") as f:
    f.write(line + "\n")
if args.no_propose:
    if finished:
        sys.exit("CONTROL FAILED: a match finished with seat B silent")
    print(f"CONTROL OK: no result in {DEADLINE_S} s with seat B proposing nothing")
    sys.exit(0)
ok = finished and shrine_rc == 0 and summary.get("heard_result") and seat == 1 and taps >= 5
sys.exit(0 if ok else 1)
