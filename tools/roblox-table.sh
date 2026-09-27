#!/usr/bin/env bash
# roblox-table.sh — one command for a Roblox remote-seat table (0038; plan 2026-09-26, Part A).
#
#   tools/roblox-table.sh            one remote seat (Ember) against the desk bot
#   tools/roblox-table.sh --two      two remote seats (Ember, Tide), no bot — needs the two-slot arena
#   tools/roblox-table.sh --status   print the tunnel URL and the CURRENT join code(s) again
#   tools/roblox-table.sh --stop     kill exactly this launcher's sessions, by name
#
# Run on katana. It builds and starts the arena on $TAPSTONE_ARENA_HOST (default familiar) from its
# own clean clone at origin/main, forwards the arena's ports to katana over ssh, starts a cloudflared
# quick tunnel on katana to the REMOTE listener only (never the board's), waits for cloudflared's
# "Registered tunnel connection", probes the public URL through DNS-over-HTTPS (the homelab resolver
# caches an early not-found, so a plain lookup can make a live tunnel look dead), scrapes the join
# code(s) from the arena's stdout, and writes everything to scratch/roblox/tonight.txt.
#
# Ports 7890 (board) and 7891 (remote) on both hosts, so it never collides with a playtest arena
# on the default 7790/7791. The join code changes after every match: the board (opened on katana at
# http://localhost:7890/) shows the current one, and --status reprints it.
set -euo pipefail

# The main checkout's scratch/ (gitignored, synced), even when run from a worktree: tonight.txt is
# what JP reads, so it must not land in a worktree that gets cleaned up.
REPO=$(cd "$(dirname "$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir)")" && pwd)
OUT="$REPO/scratch/roblox"
TONIGHT="$OUT/tonight.txt"
TUNNEL_LOG="$OUT/tonight-tunnel.log"
HOST=${TAPSTONE_ARENA_HOST:-familiar}
WORK=/var/tmp/fwork/roblox-table          # this launcher's own clone on $HOST
TARGET=/var/tmp/ftarget/roblox-table      # and its own build dir
ARENA_LOG="$WORK/arena.log"
BOARD_PORT=7890
REMOTE_PORT=7891
S_ARENA=tapstone-play          # tmux on $HOST
S_SSH=tapstone-play-ssh        # tmux on katana
S_TUNNEL=tapstone-play-tunnel  # tmux on katana
DOH=https://1.1.1.1/dns-query
# The config the published place reads (ConfigUrl): a SECRET gist on JP's account holding only the
# tunnel URL and the join codes. Its id persists across runs; --stop empties it to {}.
GIST_FILE=tapstone-table.json
GIST_ID_FILE="$OUT/tonight-gist.id"
# luna-vr's Studio writer (roblox/, PR #118): sets ServerStorage.TapstoneConfig in a running Studio.
SET_CONFIG=${TAPSTONE_SET_CONFIG:-$REPO/roblox/tools/set-config.py}

say() { printf '[roblox-table] %s\n' "$*"; }
die() { printf '[roblox-table] ERROR: %s\n' "$*" >&2; exit 1; }

stop() {
    if [ -s "$GIST_ID_FILE" ] && gist_write '{}' >/dev/null; then
        say "emptied the gist $(cat "$GIST_ID_FILE") to {}"
    fi
    ssh "$HOST" "tmux kill-session -t $S_ARENA 2>/dev/null" && say "stopped $S_ARENA on $HOST" || true
    for s in "$S_TUNNEL" "$S_SSH"; do
        tmux kill-session -t "$s" 2>/dev/null && say "stopped $s" || true
    done
    # Belt and braces: drop these forwards from a ControlMaster mux if an older run put them there.
    ssh -O cancel -L "127.0.0.1:$BOARD_PORT:127.0.0.1:$BOARD_PORT" -L "127.0.0.1:$REMOTE_PORT:127.0.0.1:$REMOTE_PORT" \
        "$HOST" >/dev/null 2>&1 || true
}

gist_user() { gh api user --jq .login 2>/dev/null || echo jphein; }

# Write $1 (the file's JSON content) to the secret gist, creating it on first use. Prints the id.
gist_write() {
    local body id created=0
    body=$(python3 -c 'import json,sys; print(json.dumps({"description": "Tapstone Roblox table config (tunnel URL and join codes only)", "public": False, "files": {sys.argv[1]: {"content": sys.argv[2]}}}))' "$GIST_FILE" "$1")
    id=$(cat "$GIST_ID_FILE" 2>/dev/null || true)
    if [ -n "$id" ]; then
        # Never fall back to a NEW gist: the published place bakes this one's URL (luna-vr's contract).
        gh api -X PATCH "gists/$id" --input - <<<"$body" >/dev/null || { say "gist $id: PATCH failed" >&2; return 1; }
    else
        id=$(gh api -X POST gists --input - --jq .id <<<"$body") || return 1
        created=1
    fi
    # Read it back (authenticated API, uncached): an edit that did not land must not look like success.
    [ "$(gh api "gists/$id" --jq ".files[\"$GIST_FILE\"].content")" = "$1" ] ||
        { say "gist $id: read-back does not match what was written" >&2; return 1; }
    if [ "${created:-0}" = 0 ]; then
        echo "$id"
        return 0
    fi
    echo "$id" > "$GIST_ID_FILE"
    say "created the secret gist $id: give luna-vr these for the published place's ConfigUrl:" >&2
    say "  raw https://gist.githubusercontent.com/$(gist_user)/$id/raw/$GIST_FILE" >&2
    say "  api https://api.github.com/gists/$id   <- the place's ConfigUrl (set-config.py --config-url)" >&2
    echo "$id"
}

table_json() {  # $1 = url, rest = codes
    python3 -c 'import datetime,json,sys; print(json.dumps({"url": sys.argv[1], "codes": sys.argv[2:], "written": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}))' "$@"
}

codes() {  # every join code the arena has printed, oldest first; the last N are current
    ssh "$HOST" "grep -a 'remote join code' $ARENA_LOG 2>/dev/null" | sed 's/.*: *//' | tr -d '\r' || true
}

tunnel_url() {
    grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true
}

write_tonight() {
    local url=$1 slots=$2 sha=$3
    local current gist
    current=$(codes | tail -n "$slots" | paste -sd ' ' -)
    # shellcheck disable=SC2086  # the codes are separate arguments
    gist=$(gist_write "$(table_json "$url" $current)") || gist="(gist write failed)"
    {
        echo "# Tapstone Roblox table — written $(date +'%A %Y-%m-%d %H:%M:%S %Z') by tools/roblox-table.sh"
        echo "arena_url=$url"
        echo "join_codes=$current"
        echo "seats=$slots"
        echo "gist_id=$gist"
        echo "config_url=https://api.github.com/gists/$gist"
        echo "arena=$HOST tmux $S_ARENA, tapstone@$sha, board http://localhost:$BOARD_PORT/ (on katana)"
        echo "stop=tools/roblox-table.sh --stop"
        echo "# The code changes after every match; the board shows the current one, --status reprints it."
    } > "$TONIGHT"
    cat "$TONIGHT"
}

TWO=0
case "${1:-}" in
    --stop) stop; exit 0 ;;
    --status)
        [ -f "$TONIGHT" ] || die "no table running (no $TONIGHT)"
        slots=$(sed -n 's/^seats=//p' "$TONIGHT")
        sha=$(sed -n 's/.*tapstone@\([0-9a-f]*\).*/\1/p' "$TONIGHT")
        write_tonight "$(tunnel_url)" "${slots:-1}" "${sha:-?}"
        exit 0 ;;
    --two) TWO=1 ;;
    "") ;;
    *) die "usage: $0 [--two | --status | --stop]" ;;
esac
SLOTS=$((TWO + 1))

# Preflight: nothing of ours already running, and katana's forward ports free.
tmux has-session -t "$S_SSH" 2>/dev/null && die "$S_SSH is already running: $0 --stop first"
tmux has-session -t "$S_TUNNEL" 2>/dev/null && die "$S_TUNNEL is already running: $0 --stop first"
ssh "$HOST" "tmux has-session -t $S_ARENA 2>/dev/null" && die "$S_ARENA is already running on $HOST: $0 --stop first"
for p in $BOARD_PORT $REMOTE_PORT; do
    ss -ltnH "sport = :$p" | grep -q . && die "port $p is taken on katana"
done
CLOUDFLARED=$(mise which cloudflared 2>/dev/null || command -v cloudflared || true)
[ -n "$CLOUDFLARED" ] || die "cloudflared not found (mise install cloudflared)"
mkdir -p "$OUT"

# 1. A clean clone at origin/main on $HOST, built release, then the arena in tmux.
say "building tapstone-arena on $HOST from origin/main"
SHA=$(ssh "$HOST" "export PATH=\$HOME/.cargo/bin:\$PATH; set -e
    if [ -d $WORK/.git ]; then git -C $WORK fetch -q origin; else git clone -q https://github.com/jphein/tapstone-game $WORK; fi
    git -C $WORK reset -q --hard origin/main && git -C $WORK clean -fdq
    cd $WORK/rust && CARGO_TARGET_DIR=$TARGET cargo build -q --release -p tapstone-arena --bin tapstone-arena >&2
    git -C $WORK log -1 --format=%h")
say "built tapstone@$SHA"
REMOTES="--remote ember-neutral"
[ "$TWO" = 1 ] && REMOTES="$REMOTES --remote tide-neutral"
ssh "$HOST" "rm -f $ARENA_LOG; tmux new-session -d -s $S_ARENA -c $WORK/rust \
    '$TARGET/release/tapstone-arena --desk $REMOTES --bind 127.0.0.1:$BOARD_PORT --remote-bind 127.0.0.1:$REMOTE_PORT 2>&1 | tee $ARENA_LOG'"
for _ in $(seq 60); do
    n=$(codes | wc -l)
    [ "$n" -ge "$SLOTS" ] && break
    if ssh "$HOST" "grep -aqE 'cannot be used multiple times|unexpected argument|^Error' $ARENA_LOG 2>/dev/null"; then
        err=$(ssh "$HOST" "grep -aE 'cannot be used multiple times|unexpected argument|^Error' $ARENA_LOG | head -3")
        stop
        [ "$TWO" = 1 ] && die "this arena (tapstone@$SHA) has no two-slot mode yet — it needs morpheus's two-slot PR on main. The arena said: $err"
        die "the arena refused to start: $err"
    fi
    sleep 0.5
done
[ "$(codes | wc -l)" -ge "$SLOTS" ] || { stop; die "the arena printed no join code within 30 s (see $HOST:$ARENA_LOG)"; }
say "arena up in tmux $S_ARENA on $HOST"

# 2. Forward the board and the remote listener to katana.
# Its own connection, never the ControlMaster mux: forwards set up through a shared master outlive this
# client (they did, once, and held 7890/7891 after --stop).
tmux new-session -d -s "$S_SSH" "ssh -N -o ControlMaster=no -o ControlPath=none -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -L 127.0.0.1:$BOARD_PORT:127.0.0.1:$BOARD_PORT -L 127.0.0.1:$REMOTE_PORT:127.0.0.1:$REMOTE_PORT $HOST"
local_code=000
for _ in $(seq 40); do
    local_code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$REMOTE_PORT/remote/choices" || true)
    [ "$local_code" = 401 ] && break
    sleep 0.5
done
[ "$local_code" = 401 ] || { stop; die "the ssh forward never answered (got $local_code, wanted 401)"; }
say "forwarded to katana (:$BOARD_PORT board, :$REMOTE_PORT remote)"

# 3. The quick tunnel, to the remote listener only; wait for its connection before any lookup.
: > "$TUNNEL_LOG"
tmux new-session -d -s "$S_TUNNEL" "'$CLOUDFLARED' tunnel --no-autoupdate --url http://127.0.0.1:$REMOTE_PORT 2>&1 | tee '$TUNNEL_LOG'"
for _ in $(seq 120); do
    grep -aq 'Registered tunnel connection' "$TUNNEL_LOG" && break
    sleep 0.5
done
grep -aq 'Registered tunnel connection' "$TUNNEL_LOG" || { stop; die "cloudflared never registered a connection (see $TUNNEL_LOG)"; }
URL=$(tunnel_url)
[ -n "$URL" ] || { stop; die "no trycloudflare URL in $TUNNEL_LOG"; }

# 4. Probe the public URL through DoH (never the homelab resolver): 401 means it is our arena.
code=000
for _ in $(seq 20); do
    code=$(curl --noproxy '*' --doh-url "$DOH" -s -o /dev/null -w '%{http_code}' -m 15 "$URL/remote/choices" || true)
    [ "$code" = 401 ] && break
    sleep 3
done
[ "$code" = 401 ] || { stop; die "$URL/remote/choices answered $code through the tunnel, not 401"; }
say "tunnel live: $URL (probe 401)"

# 5–6. The codes, the gist, the file; Studio if one is open; the board.
write_tonight "$URL" "$SLOTS" "$SHA"
if [ "${TAPSTONE_NO_STUDIO:-0}" != 1 ] && [ -f "$SET_CONFIG" ]; then
    # shellcheck disable=SC2046  # the codes are separate arguments
    if python3 "$SET_CONFIG" --url "$URL" --codes $(codes | tail -n "$SLOTS") --dm "${TAPSTONE_STUDIO_DM:-Edit}"; then
        say "wrote the URL and code(s) into Studio's TapstoneConfig"
    else
        say "Studio not written (exit $?): the place reads the gist, and tonight.txt has it all"
    fi
else
    say "no Studio write (set-config.py not at $SET_CONFIG, or TAPSTONE_NO_STUDIO=1)"
fi
[ "${TAPSTONE_NO_OPEN:-0}" = 1 ] || { command -v xdg-open >/dev/null && xdg-open "http://localhost:$BOARD_PORT/" >/dev/null 2>&1 & }
say "stop with: $0 --stop"
