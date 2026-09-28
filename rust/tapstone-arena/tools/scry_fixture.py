#!/usr/bin/env python3
"""Write the scry bridge's replay fixture ONCE (tools/fixtures/scry-replay.journal): a whole desk
match played through `scry_bridge.Bridge` by a simple tapping policy, recorded as the scry-glass
journal lines those taps would have produced. Synthetic but in the exact journald format
(`-o short-unix`), with fake UIDs and a fake `k=`; noise lines (a 404, a refused 403 tap) and two
taps of a tag bound in the fixture's fake uid-map (one before the castle, one mid-match) are mixed
in, so the replay exercises the parser's filter and the bound-UID refusal.

    scry_fixture.py <tapstone-arena> <new run dir> <out.journal>

The test replays the committed file (test_scry_bridge.py). Never rerun this to make a failing
replay pass: a replay that stops finishing is the finding.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scry_bridge as sb  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
FAKE_K = "FAKE-k-9f3e1c7a0b"  # never a real station token
T0 = 1790600000.0  # 2026-09-28 06:13:20 UTC


def journal_line(t, path, status):
    stamp = time.strftime("%d/%b/%Y %H:%M:%S", time.gmtime(t))
    return f'{t:.6f} ubox0 python3[4242]: 192.0.2.145 - - [{stamp}] "{path}" {status} -'


def main():
    arena_bin, run, out = sys.argv[1:4]
    os.makedirs(run)
    bound = sb.load_bound(os.path.join(FIXTURES, "scry-uid-map.json"))
    bound_uid = sorted(bound)[0]
    _, cards = sb.load_deck("tide-neutral")
    reg = sb.Registry(os.path.join(run, "scry-registry.jsonl"), "tide-neutral", cards)
    table = sb.Table(arena_bin, run, "tide-neutral", 11, 17990)
    log = open(os.path.join(run, "bridge.log"), "a")

    def say(m):
        print("[scry]", m, flush=True)
        log.write(f"{time.time():.3f} [scry] {m}\n")
        log.flush()

    bridge = sb.Bridge(cards, reg, bound, table.arena, say, view=table.views["board"])
    lines, t, fresh = [], [T0], [0]

    def emit(uid, dt):
        t[0] += dt
        lines.append(journal_line(t[0], f"POST /tap/{uid}?k={FAKE_K} HTTP/1.0", 200))
        bridge.tap(t[0], uid, time.monotonic())

    def new_uid():
        fresh[0] += 1
        return f"04:F0:{fresh[0]:02X}:00:00:00:01"

    lines.append(journal_line(T0 - 30, "GET / HTTP/1.1", 404).replace("192.0.2.145", "127.0.0.1"))
    lines.append(journal_line(T0 - 20, f"POST /tap/04:DE:AD:00:00:00:01?k=wrong-{FAKE_K} HTTP/1.0", 403))
    castle, taps, settle = "04:CA:57:1E:00:00:01", 0, sb.Settle()
    while table.proc.poll() is None:
        c = table.arena.choices()
        if not settle.ready(c, table.views, time.monotonic()):
            time.sleep(0.02)
            continue
        n, seat, menu = c
        taps += 1
        if taps > 400:
            table.proc.kill()
            sys.exit("the policy made 400 taps without finishing: not a fixture")
        if taps == 1:
            emit(bound_uid, 1.0)  # refused: before the castle, so a missing refusal binds it
            emit(castle, 1.0)
            continue
        if taps == 6:
            emit(bound_uid, 1.0)  # refused again, mid-match
        counts = sb.lane_counts(table.views["board"](), seat)
        design = lambda k: sb.design_num(cards[k][0])  # noqa: E731
        if any(m["kind"] == "Draw" for m in menu):
            emit(new_uid(), 1.2)
            continue
        hand = sorted(bridge.hand)
        castable = [k for k in hand if sb.pick_cast(menu, design(k), counts) is not None]
        chargeable = [k for k in hand if sb.find(menu, f"c/{design(k)}") is not None]
        if chargeable and (not castable or len(hand) >= 4):
            k = chargeable[-1]
            emit(bridge.uid_of(k), 1.0)
            emit(bridge.uid_of(k), 0.8)  # a second tap within 3 s: charge
        elif castable:
            emit(bridge.uid_of(castable[0]), 1.0)
            if bridge.pending:
                bridge.resolve()  # the window lapses: 0009's default cast
            t[0] += 3.5
        else:
            emit(castle, 1.0)  # pass
    rc = table.proc.wait()
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"arena exit {rc}, {table.winner[0]}; {len(lines)} lines, {len(bridge.proposed)} proposed, "
          f"{len(bridge.refused)} refused -> {out}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
