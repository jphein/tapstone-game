#!/usr/bin/env python3
"""The arena dies mid-match and comes back, over the real radio (tapstone#132 c; arena spec §7).

Two real shrines, as radio_table.py sets them up: board A (`--arena-mac`) is the arena's radio and
seat A (the interim, seat 0), and board B (`--shrine-mac`) is seat B across the air. The arena is
SIGKILLed once its ledger holds `--kill-at` records. The stations detect dark themselves (3 s with
no arena frame, `tapstone_proto::shrine::DARK_MS`), seat A arbitrates as the interim, and seat B
proposes to it. After `--dark-s` seconds a new arena process starts on the same ledger, resumes the
match from its journal, takes the interim's hand-back, and plays to the result.

    radio_dark.py --bin-dir DIR --run-dir DIR --arena-mac MAC --shrine-mac MAC [--control]

While the arena is dead, this script holds board A's port itself and reads its console
(`shrine-a-dark.trace`), so the interim's own lines are kept and its USB output is never left
unread. The dark window's progress is measured from board B's console: the highest mseq B applied
before the kill against the highest it applied while the arena was dead.

Exit 0, main run: the restarted arena finished the match, both stations reported `dark BEGINS`,
and B applied at least one record while the arena was dead (the interim's). `shrine.json` is B's
FINAL head, for radio_verify.py. `--control` (both boards built `TAPSTONE_NO_INTERIM=1`): exit 0
when B applied NOTHING while the arena was dead (no interim, so the match stalls); exit 1 if it did.
Exit 2 on a setup error.
"""
import argparse
import glob
import json
import os
import re
import signal
import sqlite3
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
ap.add_argument("--kill-at", type=int, default=16, help="records in the ledger when the arena dies")
ap.add_argument("--dark-s", type=float, default=15.0, help="seconds the arena stays dead")
ap.add_argument("--control", action="store_true")
ap.add_argument("--deadline", type=int, default=400)
args = ap.parse_args()
BOARD = "127.0.0.1:17790"
run = os.path.abspath(args.run_dir)
arena_bin = os.path.join(args.bin_dir, "tapstone-arena")
shrine_bin = os.path.join(args.bin_dir, "radio_shrine")
STATUS = re.compile(r"\[station\] (status|FINAL) match ([0-9a-f]{8}) .*? mseq (\d+) head ([0-9a-f]{16}) .*? dark (\d)")
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
port_a, port_b = by_id(args.arena_mac), by_id(args.shrine_mac)
with open(os.path.join(run, "registry.jsonl"), "w") as f:
    for deck, index in ((args.deck_a, 0), (args.deck_b, 1)):
        subprocess.run([shrine_bin, "registry", "--deck", deck, "--index", str(index)], stdout=f, check=True)
cfg = os.path.join(run, "arena.toml")
with open(cfg, "w") as f:
    f.write(
        f'gateway_mac = "{args.arena_mac.lower()}"\n'
        # The arena opens its board by this path ALONE (arena.toml gateway_port): without it the
        # arena scans every Espressif USB port with @TS1 PING, the scry on the table among them.
        f'gateway_port = "{by_id(args.arena_mac)}"\n'
        f'http_bind = "{BOARD}"\n'
        f'ledger_path = "{run}/ledger.sqlite"\n'
        f'registry_path = "{run}/registry.jsonl"\n'
    )

t0 = time.time()
b_lines = []  # (t, line)
stop_b = threading.Event()


def read_port(port, name, sink, stop):
    s = serial.Serial(port, 115200, timeout=0.2)
    buf = b""
    with open(os.path.join(run, name), "w") as out:
        while not stop.is_set():
            buf += s.read(4096)
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode(errors="replace").rstrip("\r")
                sink.append((time.time(), text))
                out.write(f"{int(time.time() * 1e6)} < {text}\n")
                out.flush()
    s.close()


threading.Thread(target=read_port, args=(port_b, "shrine-b.trace", b_lines, stop_b), daemon=True).start()
time.sleep(1)


def start_arena(trace):
    env = dict(os.environ, TAPSTONE_SERIAL_TRACE=os.path.join(run, trace))
    p = subprocess.Popen([arena_bin, "--config", cfg, "--bind", BOARD, "--once"],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    log = open(os.path.join(run, trace.replace(".trace", ".log")), "w")
    state = {"winner": None, "resumed": False}

    def drain():
        for line in p.stdout:
            log.write(f"{time.time() - t0:9.3f} {line}")
            log.flush()
            if " over, winner " in line:
                state["winner"] = line.strip()
            if line.startswith("resuming match"):
                state["resumed"] = True

    threading.Thread(target=drain, daemon=True).start()
    return p, state


def records():
    try:
        db = sqlite3.connect(f"file:{run}/ledger.sqlite?mode=ro", uri=True, timeout=1)
        n = db.execute("SELECT COUNT(*) FROM match_records").fetchone()[0]
        db.close()
        return n
    except sqlite3.Error:
        return 0


def b_mseq(since=0.0, until=None):
    best = -1
    for t, ln in b_lines:
        if t < since or (until is not None and t > until):
            continue
        m = STATUS.search(ln)
        if m:
            best = max(best, int(m.group(3)))
    return best


arena, st1 = start_arena("arena.trace")
deadline = time.time() + args.deadline
while records() < args.kill_at and arena.poll() is None and time.time() < deadline:
    time.sleep(0.05)
at_kill = records()
if arena.poll() is not None or at_kill < args.kill_at:
    sys.exit(f"setup: the arena ended or never reached {args.kill_at} records (at {at_kill})")
arena.send_signal(signal.SIGKILL)
arena.wait()
t_kill = time.time()
print(f"arena SIGKILLed at {at_kill} journaled records, {t_kill - t0:.1f} s in")

# The dark window: board A's console is ours while the arena is dead.
a_lines, stop_a = [], threading.Event()
time.sleep(0.3)
ta = threading.Thread(target=read_port, args=(port_a, "shrine-a-dark.trace", a_lines, stop_a), daemon=True)
ta.start()
time.sleep(args.dark_s)
stop_a.set()
ta.join(timeout=3)
t_revive = time.time()
# The baseline is what the arena had journaled when it died: B's status lines come every 2 s, so
# the last one before the kill can be stale (run-dark1: B printed mseq 14 just AFTER the kill).
before = at_kill
during = b_mseq(since=t_kill, until=t_revive)
dark_a = any("dark BEGINS" in ln for _, ln in a_lines)
dark_b = any("dark BEGINS" in ln for t, ln in b_lines if t >= t_kill)
interim_a = any("interim=true" in ln for _, ln in a_lines)
print(f"dark window {args.dark_s:.0f} s: journaled {before}, B applied up to mseq {during}; dark A {dark_a} (interim {interim_a}), B {dark_b}")

arena2, st2 = start_arena("arena2.trace")
finished = False
try:
    rc = arena2.wait(timeout=max(5, deadline - time.time()))
    finished = rc == 0 and st2["winner"] is not None
except subprocess.TimeoutExpired:
    rc = None
    arena2.terminate()
    try:
        arena2.wait(timeout=5)
    except subprocess.TimeoutExpired:
        arena2.kill()
time.sleep(3)
stop_b.set()


def summary(lines):
    fin, res = None, set()
    for _, ln in lines:
        m = FINAL.search(ln)
        if m:
            fin = m
        m = RESULT.search(ln)
        if m:
            res.add(m.group(1))
    if fin is None:
        return {}
    return {"match_id": fin.group(1), "seat": fin.group(2), "phase": fin.group(3), "head": fin.group(4),
            "heard_result": fin.group(1) in res}


sb = summary(b_lines)
for name in ("shrine-b.json", "shrine.json"):
    with open(os.path.join(run, name), "w") as f:
        json.dump(sb, f)
line = (f"kill at {at_kill}, dark {args.dark_s:.0f} s: B applied up to mseq {during} while dark, dark A {dark_a} "
        f"interim {interim_a} B {dark_b}; restart resumed {st2['resumed']} exit {rc} {st2['winner']}; "
        f"B {sb.get('phase')} head {sb.get('head')} R {sb.get('heard_result')}; {time.time() - t0:.1f} s")
print(line)
with open(os.path.join(run, "radio_dark.txt"), "w") as f:
    f.write(line + "\n")
# B applied records past the journaled prefix while the arena was dead: the interim's commits.
advanced = during > before
if args.control:
    if advanced:
        sys.exit("CONTROL FAILED: records were committed while the arena was dead, with no interim")
    print("CONTROL OK: nothing committed while the arena was dead (no interim)")
    sys.exit(0)
ok = finished and dark_a and dark_b and interim_a and advanced and sb.get("phase") == "Over"
sys.exit(0 if ok else 1)
