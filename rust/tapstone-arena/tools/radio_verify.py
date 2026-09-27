#!/usr/bin/env python3
"""Verify a radio match's record afterwards, independently of the arena (tapstone#132 item 1).

    radio_verify.py <run-dir> <path/to/tapstone-sim>

Reads only what the arena WROTE (<run-dir>/ledger.sqlite, with Python's own sqlite3) and what the
shrine computed on the far side of the air (<run-dir>/shrine.json), and checks:
  1. `tapstone-sim replay` re-derives every hash of the arena's JSON transcript (the outbox's
     `realm` body) through a fresh engine: the independent tool, a second path over the rules crate
     that never touches the arbiter;
  2. the journal (`match_records`) holds the same records and hashes as that transcript;
  3. the TSX1 transcript (the outbox's `scry` body) carries the same hashes, and SHA-256 of it is
     the `transcript_sha` the ledger stored (hashlib, not the arena's sha2);
  4. the ledger's `final_hash`, the transcript's `final_hash` and the shrine's own chain head agree.
Exit 0 when every check passes, 1 when any fails (each is printed), 2 on a missing input.
"""
import hashlib
import json
import os
import sqlite3
import subprocess
import sys

run, sim = sys.argv[1], sys.argv[2]
db_path = os.path.join(run, "ledger.sqlite")
if not os.path.exists(db_path):
    sys.exit(2)
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
fails = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{': ' + detail if detail else ''}")
    if not ok:
        fails.append(name)


matches = db.execute("SELECT id, state, final_hash, transcript_sha, winner FROM match").fetchall()
check("exactly one match in the scratch ledger", len(matches) == 1, f"{[(m[0], m[1]) for m in matches]}")
if not matches:
    sys.exit(1)
mid, mstate, final_hash, tsha, winner = matches[0]
check("the match ended with a result", mstate == "over", f"state {mstate}, winner {winner}")
bodies = dict(db.execute("SELECT sink, body FROM outbox WHERE match = ?", (mid,)).fetchall())
check("the outbox holds both transcripts", {"realm", "scry"} <= set(bodies), f"{sorted(bodies)}")
t = json.loads(bodies["realm"])
tpath = os.path.join(run, f"transcript-{mid}.json")
with open(tpath, "w") as f:
    json.dump(t, f, indent=1)

# 1. The independent replay.
r = subprocess.run([sim, "replay", tpath], capture_output=True, text=True)
check("tapstone-sim replay", r.returncode == 0, (r.stdout + r.stderr).strip())

# 2. The journal against the transcript.
journal = db.execute("SELECT mseq, record, hash FROM match_records WHERE match = ? ORDER BY mseq", (mid,)).fetchall()
recs = t["records"]
check("journal and transcript hold the same number of records", len(journal) == len(recs), f"{len(journal)} vs {len(recs)}")
jh = [h.hex() if h is not None else None for (_, _, h) in journal]
th = [x["hash"] for x in recs]
bad = [i for i, (a, b) in enumerate(zip(jh, th)) if a != b]
check("journal hashes equal the transcript's, record by record", not bad and len(jh) == len(th),
      f"first mismatch at {bad[0]}: {jh[bad[0]]} vs {th[bad[0]]}" if bad else f"{len(jh)} records")
seqs_ok = all(m == x["seq"] for (m, _, _), x in zip(journal, recs))
check("journal mseq equals transcript seq", seqs_ok)

# 3. TSX1: header (36 B) + 32 B per record (24 B record + 8 B chain head).
tsx1 = bodies["scry"]
n = (len(tsx1) - 36) // 32
check("TSX1 length is header + 32 B per record", len(tsx1) == 36 + 32 * n and n == len(recs), f"{len(tsx1)} B, {n} records")
tsx_h = [tsx1[36 + 32 * i + 24: 36 + 32 * i + 32].hex() for i in range(n)]
want = [h if h is not None else "00" * 8 for h in th]
check("TSX1 hashes equal the transcript's", tsx_h == want)
tsx_r = [tsx1[36 + 32 * i: 36 + 32 * i + 24] for i in range(n)]
check("TSX1 records equal the journal's bytes", tsx_r == [bytes(rec) for (_, rec, _) in journal])
check("SHA-256(TSX1) is the ledger's transcript_sha", hashlib.sha256(tsx1).digest() == bytes(tsha or b""),
      hashlib.sha256(tsx1).hexdigest()[:16])

# 4. Three independent heads.
shrine = {}
try:
    shrine = json.load(open(os.path.join(run, "shrine.json")))
except (OSError, ValueError):
    pass
heads = {"ledger": bytes(final_hash or b"").hex(), "transcript": t["final_hash"], "shrine": shrine.get("head")}
check("ledger, transcript and shrine agree on the final chain head", len(set(heads.values())) == 1, f"{heads}")
check("the shrine played this match", shrine.get("match_id") == mid and shrine.get("heard_result") is True,
      f"shrine match {shrine.get('match_id')}, heard_result {shrine.get('heard_result')}")
print(f"{'VERIFIED' if not fails else 'NOT VERIFIED'}: match {mid}, {len(recs)} records, final_hash {t['final_hash']}")
sys.exit(1 if fails else 0)
