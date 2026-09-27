#!/usr/bin/env python3
"""A whole Tapstone match between two REAL shrines (tapstone#132 item c, real-table run i).

Both seats are smol's shrine station firmware (`--features tapstone-station`), whose seat is
`tapstone_proto::shrine::Shrine`, the same state machine the arena's tests run as `DeskShrine`.

- Board A (`--arena-mac`) is the arena's radio AND seat A in one image. The arena's SerialLink
  holds its port. Its station's frames go up that USB, and its `[station]` lines land in the
  arena's serial trace.
- Board B (`--shrine-mac`) is seat B, across the air. This script reads its console into
  `shrine-b.trace`.

    radio_table.py --bin-dir DIR --run-dir DIR --arena-mac MAC --shrine-mac MAC [--control]

`--bin-dir` holds `tapstone-arena` and `radio_shrine`, and the latter prints the registry. The
stations' decks and indexes are baked into their images (`TAPSTONE_DECK`, `TAPSTONE_INDEX`), and
`--deck-a/--deck-b` must name the same ones. `--run-dir` must not exist yet, and may not be under
/tmp or /var/tmp.

Each station's final line (`[station] FINAL match … head …`) and `RESULT` line become
`shrine-a.json` / `shrine-b.json`. `shrine.json` is B's copy, the far side of the air, which is
what `radio_verify.py` reads.

Exit 0: the arena finished (`--once` exited 0) and both stations reported the arena's match as
over with a head. With `--control` (board B flashed with a `TAPSTONE_NO_PROPOSE=1` image) the run
must NOT finish: exit 0 means it stalled to the deadline, exit 1 means a match finished with a
silent seat. Exit 2 on a setup error.
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import threading
import time

import serial  # pyserial

ap = argparse.ArgumentParser()
ap.add_argument("--bin-dir", required=True)
ap.add_argument("--run-dir", required=True)
ap.add_argument("--arena-mac", required=True)
ap.add_argument("--shrine-mac", required=True)
ap.add_argument("--deck-a", default="ember-neutral")
ap.add_argument("--deck-b", default="tide-neutral")
ap.add_argument("--control", action="store_true")
ap.add_argument("--deadline", type=int, default=0, help="seconds (default 600, or 90 for the control)")
args = ap.parse_args()
DEADLINE_S = args.deadline or (90 if args.control else 600)
BOARD = "127.0.0.1:17790"
run = os.path.abspath(args.run_dir)
arena_bin = os.path.join(args.bin_dir, "tapstone-arena")
shrine_bin = os.path.join(args.bin_dir, "radio_shrine")
FINAL = re.compile(r"\[station\] FINAL match ([0-9a-f]{8}) seat (\S+) phase (\w+) .*? head ([0-9a-f]{16})")
RESULT = re.compile(r"\[station\] RESULT match ([0-9a-f]{8})")


def by_id(mac):
    hits = glob.glob(f"/dev/serial/by-id/*{mac.upper()}*")
    if len(hits) != 1:
        sys.exit(f"setup: {len(hits)} by-id ports for {mac}: {hits}")
    return hits[0]


if os.path.exists(run):
    sys.exit(f"setup: {run} exists; every run gets a fresh ledger")
os.makedirs(run)
shrine_port = by_id(args.shrine_mac)
by_id(args.arena_mac)
with open(os.path.join(run, "registry.jsonl"), "w") as f:
    for deck, index in ((args.deck_a, 0), (args.deck_b, 1)):
        subprocess.run([shrine_bin, "registry", "--deck", deck, "--index", str(index)], stdout=f, check=True)
with open(os.path.join(run, "arena.toml"), "w") as f:
    f.write(
        f'gateway_mac = "{args.arena_mac.lower()}"\n'
        f'http_bind = "{BOARD}"\n'
        f'ledger_path = "{run}/ledger.sqlite"\n'
        f'registry_path = "{run}/registry.jsonl"\n'
    )

t0 = time.time()
stop = threading.Event()
b_lines = []


def read_b():
    # Opened before the arena starts, so discovery finds this port busy and leaves it alone.
    s = serial.Serial(shrine_port, 115200, timeout=0.2)
    buf = b""
    with open(os.path.join(run, "shrine-b.trace"), "w") as out:
        while not stop.is_set():
            buf += s.read(4096)
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode(errors="replace").rstrip("\r")
                b_lines.append(text)
                # link::trace's shape (unix µs, direction, line), so `radio_shrine report` joins it.
                out.write(f"{int(time.time() * 1e6)} < {text}\n")
                out.flush()


threading.Thread(target=read_b, daemon=True).start()
time.sleep(1)
env = dict(os.environ, TAPSTONE_SERIAL_TRACE=os.path.join(run, "arena.trace"))
arena = subprocess.Popen([arena_bin, "--config", os.path.join(run, "arena.toml"), "--bind", BOARD, "--once"],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
state = {"node": None, "winner": None}
arena_log = open(os.path.join(run, "arena.log"), "w")


def drain_arena():
    for line in arena.stdout:
        arena_log.write(f"{time.time() - t0:9.3f} {line}")
        arena_log.flush()
        if line.startswith("gateway ") and ", node " in line:
            state["node"] = int(line.rsplit("node ", 1)[1])
        if " over, winner " in line:
            state["winner"] = line.strip()


threading.Thread(target=drain_arena, daemon=True).start()
finished = False
try:
    rc = arena.wait(timeout=DEADLINE_S)
    finished = rc == 0 and state["winner"] is not None
except subprocess.TimeoutExpired:
    rc = None
    arena.terminate()
    try:
        arena.wait(timeout=5)
    except subprocess.TimeoutExpired:
        arena.kill()
time.sleep(3)  # the stations' FINAL lines follow the last commit by one service pass
stop.set()
elapsed = time.time() - t0


def summary(lines):
    fin, res = None, set()
    for ln in lines:
        m = FINAL.search(ln)
        if m:
            fin = m
        m = RESULT.search(ln)
        if m:
            res.add(m.group(1))
    if fin is None:
        return {}
    mid = fin.group(1)
    return {"match_id": mid, "seat": fin.group(2), "phase": fin.group(3), "head": fin.group(4),
            "heard_result": mid in res}


a_lines = []
try:
    a_lines = open(os.path.join(run, "arena.trace"), errors="replace").read().splitlines()
except OSError:
    pass
sa, sb = summary(a_lines), summary(b_lines)
for name, s in (("shrine-a.json", sa), ("shrine-b.json", sb), ("shrine.json", sb)):
    with open(os.path.join(run, name), "w") as f:
        json.dump(s, f)
line = (f"arena exit {rc}, {state['winner']}, gateway node {state['node']}, "
        f"A {sa.get('seat')} {sa.get('phase')} head {sa.get('head')} R {sa.get('heard_result')}, "
        f"B {sb.get('seat')} {sb.get('phase')} head {sb.get('head')} R {sb.get('heard_result')}, {elapsed:.1f} s")
print(line)
with open(os.path.join(run, "radio_table.txt"), "w") as f:
    f.write(line + "\n")
if args.control:
    if finished:
        sys.exit("CONTROL FAILED: a match finished with seat B silent")
    print(f"CONTROL OK: no result in {DEADLINE_S} s with seat B proposing nothing")
    sys.exit(0)
ok = finished and sa.get("phase") == "Over" and sb.get("phase") == "Over"
sys.exit(0 if ok else 1)
