#!/bin/bash
# regate gate: $1 = PR number, $2 = branch, $3 = expected head sha (full or short prefix)
# Clones the branch fresh under /var/tmp/fwork/morpheus-$1, runs the seven gate steps from the
# arena PR bodies, judges each by exit status, sums the `test result:` lines. Exit 2 on a head
# mismatch (before any step runs), 9 on clone failure, else 0; read STEP rc= lines for the verdict.
n=$1; br=$2; want=${3:?expected head sha (full or short prefix)}
export PATH=$HOME/.cargo/bin:$PATH
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-/var/tmp/ftarget/morpheus-regate}
lane=/var/tmp/fwork/morpheus-$n
log=/var/tmp/fwork/morpheus-$n-gate.log
rm -rf "$lane"
git clone -q https://github.com/jphein/tapstone-game "$lane" -b "$br" || { echo "CLONE FAIL" | tee "$log"; exit 9; }
cd "$lane/rust" || exit 9
have=$(git rev-parse HEAD)
echo "=== PR #$n $br head=$have (expected $want) $(date -Is)" | tee "$log"
case "$have" in
  "$want"*) ;;
  *) echo "!!! HEAD MISMATCH: have $have, expected $want — refusing to gate" | tee -a "$log"; exit 2 ;;
esac
{
step() { local name=$1; shift; echo "--- $name"; "$@" > "$log.$name" 2>&1; local rc=$?; echo "STEP $name rc=$rc"; tail -n 8 "$log.$name" | sed 's/^/    /'; }
step fmt cargo fmt --check
step clippy cargo clippy --workspace --all-targets -- -D warnings
step thumb-rules cargo build -p tapstone-rules --target thumbv7em-none-eabi
step thumb-proto cargo build -p tapstone-proto --target thumbv7em-none-eabi
step thumb-progression cargo build -p tapstone-progression --target thumbv7em-none-eabi
step compile-cards ../tools/compile_cards.py --check
step compile-items ../tools/compile_items.py --check
step test cargo test --workspace --no-fail-fast
# `^test result:` with the colon: a test *named* result_… ("test result_reads_the_engine_winner ... ok")
# matched the colon-less pattern and inflated the suite count by one (oracle, 2026-09-26).
echo "TEST COUNTS: $(grep -E '^test result:' "$log.test" | awk '{p+=$4; f+=$6; i+=$8} END {printf "passed=%d failed=%d ignored=%d suites=%d", p, f, i, NR}')"
grep -E '^test .* FAILED|^failures:' "$log.test" | head -20
xt() { . ~/export-esp.sh && CARGO_UNSTABLE_BUILD_STD=core cargo +esp build -p "$1" --locked --target xtensa-esp32s3-none-elf; }
step xtensa-proto xt tapstone-proto
step xtensa-rules xt tapstone-rules
echo "=== DONE #$n $(date -Is)"
} 2>&1 | tee -a "$log"
