#!/usr/bin/env python3
"""Play a whole remote-seat match in Roblox Studio through StudioMCP, or prove it stalls.

    python3 tools/playtest/drive.py match --url https://x.trycloudflare.com --codes K7Q2MX PQ3RST
    python3 tools/playtest/drive.py stall --url https://x.trycloudflare.com --codes K7Q2MX PQ3RST

One code per remote seat (two for Roblox against Roblox, one against a desk bot or a shrine).
`match`: autoplay on, proposals on (the Studio player sits in seat 1; seat 0 is played directly).
Passes when the view shows a winner and at least 5 proposals were sent (the web gate's floor). Restart the arena before each run: its views are numbered
for the life of the process, so a fresh process holds only this run's match. `stall`, the control: autoplay on, proposals OFF. Passes when,
90 s in, there is no winner, no proposal was sent and the view number has not moved for 60 s.
Exit 0 pass, 1 fail, 2 setup error (no Studio, HTTP off, never joined).

StudioMCP plumbing: tools/studio_mcp.py. Needs Studio open on the Tapstone place with "Enable Studio
as MCP server" on, and nothing else holding port 13469.
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from studio_mcp import NoStudio, Studio, set_config_luau  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["match", "stall"])
ap.add_argument("--url", required=True, help="the tunnel base URL")
ap.add_argument("--codes", required=True, nargs="+", help="this match's join codes (1 or 2)")
ap.add_argument("--minutes", type=float, default=15.0, help="match mode: give up after this long")
args = ap.parse_args()

try:
    studio = Studio()
except NoStudio as e:
    print(f"SETUP: {e}", flush=True)
    sys.exit(2)
luau = studio.luau
call = studio.call


def done(code, line):
    print(line, flush=True)
    try:
        call("start_stop_play", {"is_start": False}, 60)
    except Exception:
        pass
    studio.close()
    sys.exit(code)


STATUS = """local c = game:GetService("ServerStorage").TapstoneConfig
return game:GetService("HttpService"):JSONEncode({
  seats = c:GetAttribute("Seats"), n = c:GetAttribute("ViewN"), phase = c:GetAttribute("Phase"),
  seq = c:GetAttribute("Seq"), winner = c:GetAttribute("Winner"),
  lastWinner = c:GetAttribute("LastWinner"), matches = c:GetAttribute("Matches"),
  proposals = c:GetAttribute("Proposals"), err = c:GetAttribute("LastError") })"""


def status():
    ok, text = luau(STATUS, "Server", 30)
    if not ok:
        return None
    try:
        return json.loads(text.strip().splitlines()[-1])
    except Exception:
        return None


if not studio.attach():
    print("SETUP: no Studio with a place open registered with StudioMCP within 90 s"
          " (open roblox/build/Tapstone.rbxl, and turn on Enable Studio as MCP server)", flush=True)
    studio.close()
    sys.exit(2)

# HttpEnabled comes from default.project.json. A place opened another way may not carry it, and
# only the command bar can set it (Roblox: HttpEnabled "must be toggled on for unpublished
# experiences ... using the Command Bar"), so check and stop with the instruction.
ok, text = luau('return tostring(game:GetService("HttpService").HttpEnabled)', "Edit")
if "not open" in text.lower():
    print("SETUP: Studio has no place open: open roblox/build/Tapstone.rbxl (File > Open)", flush=True)
    studio.close()
    sys.exit(2)
if not ok or "true" not in text:
    print("SETUP: HttpService.HttpEnabled is off. Open roblox/build/Tapstone.rbxl (built by rojo),"
          " or run in Studio's command bar: game:GetService(\"HttpService\").HttpEnabled = true",
          flush=True)
    studio.close()
    sys.exit(2)

codes = (args.codes + [""])[:2]
# ConfigUrl is cleared for the run: the place built from default.project.json carries the real
# gist's, and a live table there would override the URL and codes this run is testing.
settings = {"ArenaUrl": args.url, "JoinCodeA": codes[0], "JoinCodeB": codes[1], "AutoPlay": "off",
            "Propose": args.mode == "match", "ConfigUrl": ""}
ok, text = luau(set_config_luau(settings), "Edit")
print(f"settings: {settings} -> {text.strip()}", flush=True)

call("start_stop_play", {"is_start": True}, 60)
# Joined means the server's Seats attribute lists one seat per code ("0,1" for two).
deadline = time.time() + 60
st = None
want = len(args.codes)
while time.time() < deadline:
    time.sleep(2)
    st = status()
    if st and isinstance(st.get("seats"), str) and len([x for x in st["seats"].split(",") if x]) >= want:
        break
if not st or not isinstance(st.get("seats"), str) or len([x for x in st["seats"].split(",") if x]) < want:
    done(2, f"SETUP: not every code joined the arena: {st}")
print(f"joined: {st}", flush=True)

ok, text = luau(open(os.path.join(HERE, "remote-match.luau")).read(), "Server", 60)
print(text, flush=True)
if not ok or "FAIL" in text:
    done(1, "FAIL: remote-match.luau")

if args.mode == "match":
    deadline = time.time() + args.minutes * 60
    last_print = 0.0
    while time.time() < deadline:
        time.sleep(3)
        st = status()
        if st is None:
            continue
        if time.time() - last_print > 20:
            print(f"  {st}", flush=True)
            last_print = time.time()
        # A winner only counts with the seat's own proposals behind it (the web gate's floor of
        # 5): the arena keeps views for its whole life, so a stale "over" could pass by alone.
        # LastWinner survives a rematch (the real arena rematches within seconds, and Winner resets).
        won = st.get("lastWinner") if isinstance(st.get("lastWinner"), (int, float)) and st["lastWinner"] >= 0 else st.get("winner")
        if isinstance(won, (int, float)) and won >= 0 and st["proposals"] >= 5:
            st["winner"] = won
            # The board is drawn client-side, from the viewer's side: the Studio player sits in
            # Chair1, so the castle at their end must be labelled "seat 1 (you)". Against
            # `fake_arena.py --slot0-second` that also proves the seat came from choices, not from
            # the code's slot (a code-derived seat would have relayed with the wrong token and
            # stalled the match before this point).
            ok, board = luau('local b = workspace:FindFirstChild("TapstoneBoard")\n'
                             'if not b then return "no board" end\n'
                             'local near = b.CastleNear.Band:FindFirstChildOfClass("TextLabel")\n'
                             'return #b.Units:GetChildren() .. " units | near: " .. (near and near.Text or "?")',
                             "Client", 30)
            if not ok:
                print("client board: Client datamodel not available (Task B7 checks it by eye)", flush=True)
            else:
                print(f"client board: {board.strip()}", flush=True)
                if "seat 1 (you)" not in board:
                    done(1, f"FAIL: the client didn't draw seat 1 (theirs) at their end: {board.strip()}")
            done(0, f"PASS: seat {st['winner']} won after {st['proposals']} proposals: {st}")
    done(1, f"FAIL: no winner within {args.minutes} min: {st}")
else:
    time.sleep(30)
    first = status()
    time.sleep(60)
    last = status()
    print(f"  at 30 s: {first}\n  at 90 s: {last}", flush=True)
    if not first or not last:
        done(2, "SETUP: status unreadable")
    stalled = (last["winner"] == -1 and last["proposals"] == 0 and last["n"] == first["n"])
    done(0 if stalled else 1, ("PASS: " if stalled else "FAIL: ") +
         f"proposals off: winner {last['winner']}, proposals {last['proposals']},"
         f" view number {first['n']} -> {last['n']}")
