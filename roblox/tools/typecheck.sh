#!/usr/bin/env bash
# Static check of every script in --!strict against Roblox's API types, without Studio.
# Types: luau-lsp's globalTypes.None.d.luau pinned to a commit and a sha256, fetched into build/.
set -euo pipefail
cd "$(dirname "$0")/.."
DEFS_SHA=578437db0819644efd1cb97ab64551c12fabc192
DEFS_SUM=9ad75109b8dc9197f6d1726208bfa0b12de47c3a43672a4fa43227f0cec609ee
DEFS=build/globalTypes.None.d.luau
mkdir -p build
if ! echo "$DEFS_SUM  $DEFS" | sha256sum --check --status >/dev/null 2>&1; then
  curl -fsSL -o "$DEFS" "https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/$DEFS_SHA/scripts/globalTypes.None.d.luau"
  echo "$DEFS_SUM  $DEFS" | sha256sum --check --quiet
fi
rojo sourcemap default.project.json -o build/sourcemap.json
# The playtest script is checked too, once it exists (Task B6 adds it).
FILES=(src)
[ -f tools/playtest/remote-match.luau ] && FILES+=(tools/playtest/remote-match.luau)
luau-lsp analyze --platform=roblox --definitions="$DEFS" --sourcemap=build/sourcemap.json "${FILES[@]}"
