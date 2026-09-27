#!/usr/bin/env python3
"""Write the arena's tunnel URL and this match's join code(s) into the place open in Studio.

    python3 tools/set-config.py --url https://x.trycloudflare.com --codes K7Q2MX [PQ3RST] [--dm Server]
    python3 tools/set-config.py --config-url https://api.github.com/gists/<id>   # before publishing

--dm Edit (default) sets them before Play; they carry into the playtest. --dm Server sets them in a
running playtest: the server watches these attributes and rejoins when they change. Exit 0 set,
1 Studio refused the write, 2 no Studio registered with StudioMCP within 90 s.
Only Studio is reachable this way: a published place's attributes are fixed at publish, so a
published place gets --config-url instead (set it, then publish): its server fetches tonight's
URL and codes from there. ConfigUrl lives in ServerStorage, which never replicates to clients.
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from studio_mcp import NoStudio, Studio, set_config_luau  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--url")
ap.add_argument("--codes", nargs="+", help="1 or 2 join codes, any order")
ap.add_argument("--config-url", help="the fixed config URL (secret gist API URL) for a published place")
ap.add_argument("--dm", default="Edit", choices=["Edit", "Server"])
args = ap.parse_args()
settings = {}
if args.url or args.codes:
    if not (args.url and args.codes) or len(args.codes) > 2:
        sys.exit("--url and --codes go together, with 1 or 2 codes")
    codes = (args.codes + [""])[:2]
    settings.update({"ArenaUrl": args.url, "JoinCodeA": codes[0], "JoinCodeB": codes[1]})
if args.config_url:
    settings["ConfigUrl"] = args.config_url
if not settings:
    sys.exit("nothing to set: give --url and --codes, or --config-url")
try:
    studio = Studio()
except NoStudio as e:
    print(f"SETUP: {e}", flush=True)
    sys.exit(2)
try:
    if not studio.attach():
        print("no Studio registered with StudioMCP within 90 s", flush=True)
        sys.exit(2)
    ok, text = studio.luau(set_config_luau(settings), args.dm)
    print(f"{args.dm}: {text.strip()}", flush=True)
    sys.exit(0 if ok and "set" in text else 1)
finally:
    studio.close()
