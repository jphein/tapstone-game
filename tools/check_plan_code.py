#!/usr/bin/env python3
"""Check a plan's code by building it: extract a plan's labelled code blocks into a fresh copy of the
repo, then build, test, lint and measure the result.

Why this exists: a plan full of code that nobody compiled only moves its defects to execution time,
and a claim like "Tasks 1-7 compile" is worth nothing unless someone else can re-run it. This script
is that re-run. It writes only under --work (default ~/.cache/tapstone-plancheck) and never touches
the checkout it is run from.

What it extracts: in the plan text between the headings "## Task <first>:" and "## Task <last+1>:",
every code block introduced by a line ending in "`<path>`:" or "`<path>` (<note>):", with the fence on
the next or next-but-one line. A block introduced by "Append to `<path>`:" is appended to that file:
to the plan's own earlier block for it, or else to the file as it exists in the repo. Any other block
replaces the file, so a later "Replace" step wins, as in the plan. Once a plan has landed, an Append
whose `fn`s the repo file already defines, with the same bodies (compared rustfmt-normalised), is skipped and
reported, so the check stays idempotent; a same-named `fn` with a different body is drift, and fails.

One edit the plan gives in prose, not as a block, is applied here explicitly and named in the report:
Task 3's `tapstone-sim` gains a `tapstone-progression` dependency, so the sim test Task 3 appends can
build. (A first version of this script missed that the appended sim test was never built at all and
still reported PASS; the `SIM_TESTS` step below closes that hole.)

What "checked" means here, and what it does not:
  - it DOES build the extracted crates, run their tests, run clippy -D warnings on them, build them
    no_std for thumbv7em, build them for xtensa-esp32s3 if ~/export-esp.sh exists, and measure
    size_of::<tapstone_proto::follower::Follower>() on each target by a failing const probe;
  - it does NOT check prose, perturbations, commit steps, or any task outside the range;
  - it does NOT run `cargo fmt --check`: the plan's code is not rustfmt-shaped, by the plan's own
    convention (run `cargo fmt` after pasting).

Usage (from anywhere inside the repo):
  tools/check_plan_code.py                                   # the arena plan, Tasks 1-7
  tools/check_plan_code.py --plan docs/superpowers/plans/X.md --tasks 1-7 --work ~/.cache/pc
  tools/check_plan_code.py --rev 37b16f4                     # against a tree before the plan landed
Exit 0 when every step passed; 1 otherwise. The report is printed and saved as <work>/report.txt.
"""
import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_PLAN = "docs/superpowers/plans/2026-09-23-arena-service-phase2.md"
BLOCK = re.compile(
    r"(?P<append>Append to )?`(?P<path>(?:rust|tools|game)/[^`\s]+)`(?: \([^)]*\))?:\s*\n\n?```[a-z]*\n(?P<body>.*?)\n```",
    re.S,
)
FN = re.compile(r"\bfn\s+(\w+)")


def fn_text(src: str, name: str):
    """The text of `fn name` in `src`, from `fn` to its closing brace, or None."""
    m = re.search(rf"\bfn\s+{re.escape(name)}\b", src)
    if not m or "{" not in src[m.end():]:
        return None
    i, depth = src.index("{", m.end()), 0
    for j in range(i, len(src)):
        depth += {"{": 1, "}": -1}.get(src[j], 0)
        if depth == 0:
            return src[m.start() : j + 1]
    return None


def normalise(code: str) -> str:
    """What rustfmt cannot change: whitespace removed, and the separators it adds or drops (a `;`
    or `,` before a closing brace, a trailing `,` before a closing bracket). Limit: `{ x; }` and
    `{ x }` compare equal, which Rust does not; this is a drift check, not a proof."""
    code = re.sub(r"\s+", "", code).replace(";}", "}").replace("},", "}")
    return re.sub(r",(?=[)\]}])", "", code)
CRATES = ["tapstone-progression", "tapstone-proto"]
# Tests in existing crates that the extracted tasks append to; each must build and pass.
SIM_TESTS = ["commander"]
PROBE = "\nconst _: [(); 0] = [(); core::mem::size_of::<follower::Follower>()];\n"


def section(plan: str, first: int, last: int) -> str:
    a = plan.index(f"## Task {first}:")
    m = re.search(rf"^## Task {last + 1}\b", plan[a:], re.M)
    return plan[a : a + m.start()] if m else plan[a:]


def extract(text: str) -> dict:
    files: dict = {}
    for m in BLOCK.finditer(text):
        path, body = m["path"], m["body"]
        if m["append"] and path in files:
            files[path] += "\n" + body
        else:
            files[path] = body
    return files


def run(cmd, cwd, env=None):
    # Always an argument list; the one step that must source a shell file passes ["bash", "-c", s]
    # with every interpolated path shlex-quoted.
    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--plan", default=DEFAULT_PLAN)
    ap.add_argument("--tasks", default="1-7", help="inclusive range, e.g. 1-7")
    ap.add_argument("--work", default=str(Path.home() / ".cache" / "tapstone-plancheck"))
    ap.add_argument("--rev", default="HEAD", help="the repo revision to check the plan against")
    args = ap.parse_args()
    first, last = (int(x) for x in args.tasks.split("-"))
    work = Path(args.work).expanduser()
    tree, target = work / "tree", work / "target"
    shutil.rmtree(tree, ignore_errors=True)
    tree.mkdir(parents=True)
    env = dict(os.environ, PATH=f"{Path.home()}/.cargo/bin:" + os.environ.get("PATH", ""), CARGO_TARGET_DIR=str(target))

    head = subprocess.run(["git", "rev-parse", "--short", args.rev], cwd=REPO, capture_output=True, text=True).stdout.strip()
    archive = work / "head.tar"
    subprocess.run(["git", "archive", "-o", str(archive), args.rev], cwd=REPO, check=True)
    subprocess.run(["tar", "-x", "-f", str(archive), "-C", str(tree)], check=True)
    plan = (REPO / args.plan).read_text(encoding="utf-8")
    files = extract(section(plan, first, last))
    report = [f"plan {args.plan}, tasks {first}-{last}, repo {args.rev} {head}", f"extracted {len(files)} files:"]
    drift = []
    appended = {m["path"] for m in BLOCK.finditer(section(plan, first, last)) if m["append"]}
    for path, body in sorted(files.items()):
        p = tree / path
        p.parent.mkdir(parents=True, exist_ok=True)
        # An append to a file the plan never wrote in this range extends the repo's file.
        first_block = next(m for m in BLOCK.finditer(section(plan, first, last)) if m["path"] == path)
        if path in appended and first_block["append"] and p.exists():
            existing = p.read_text(encoding="utf-8")
            # Idempotent once the plan has landed: an Append whose functions the repo file already
            # defines, with the same bodies, is a no-op. Bodies are compared normalised, because the
            # landed file is rustfmt-shaped and the plan's block is not (a text match would miss and
            # re-append, E0428). A function that landed with a different body is drift: the plan's
            # text is stale, or the repo changed. It fails, naming the function.
            names = FN.findall(body)
            landed = {n: fn_text(existing, n) for n in names}
            if names and any(landed.values()):
                changed = [n for n in names if landed[n] is None or normalise(landed[n]) != normalise(fn_text(body, n) or "")]
                if changed:
                    drift.append(f"{path}: fn {', '.join(changed)} differs from the plan's block, or is missing beside ones that landed")
                    report.append(f"  {path} (append NOT applied: drift in fn {', '.join(changed)})")
                else:
                    report.append(f"  {path} (append skipped: already in the repo file, identical: fn {', '.join(names)})")
                continue
            body = existing.rstrip("\n") + "\n\n" + body
            how = "appended to the repo file"
        else:
            how = "written"
        p.write_text(body + "\n", encoding="utf-8")
        report.append(f"  {path} ({body.count(chr(10)) + 1} lines, {how})")
    sim_toml = tree / "rust" / "tapstone-sim" / "Cargo.toml"
    st = sim_toml.read_text()
    if "tapstone-progression" not in st:
        st = st.replace("[dependencies]\n", '[dependencies]\ntapstone-progression = { path = "../tapstone-progression" }\n', 1)
        sim_toml.write_text(st)
        report.append("  prose edit applied: tapstone-sim [dependencies] += tapstone-progression (Task 3 step 4)")
    cargo_toml = tree / "rust" / "Cargo.toml"
    ws = cargo_toml.read_text()
    for c in CRATES:
        if f'"{c}"' not in ws:
            ws = ws.replace('members = ["tapstone-rules",', f'members = ["tapstone-rules", "{c}",', 1)
    cargo_toml.write_text(ws)

    ok = not drift
    for d in drift:
        report.append(f"[FAIL] drift: {d}")
    steps = [
        ("items generated", ["python3", "tools/compile_items.py"], tree),
        ("items --check", ["python3", "tools/compile_items.py", "--check"], tree),
        ("cargo test", ["cargo", "test"] + sum((["-p", c] for c in CRATES), []), tree / "rust"),
        ("clippy -D warnings", ["cargo", "clippy"] + sum((["-p", c] for c in CRATES), []) + ["--all-targets", "--", "-D", "warnings"], tree / "rust"),
        ("sim tests the tasks append to", ["cargo", "test", "-p", "tapstone-sim"] + sum((["--test", t] for t in SIM_TESTS), []), tree / "rust"),
        ("clippy -D warnings, tapstone-sim", ["cargo", "clippy", "-p", "tapstone-sim", "--all-targets", "--", "-D", "warnings"], tree / "rust"),
        ("no_std thumbv7em", ["cargo", "build"] + sum((["-p", c] for c in CRATES), []) + ["--target", "thumbv7em-none-eabi"], tree / "rust"),
    ]
    for name, cmd, cwd in steps:
        code, out = run(cmd, cwd, env)
        tests = sum(int(n) for n in re.findall(r"test result: \w+\. (\d+) passed", out))
        failed = sum(int(n) for n in re.findall(r"(\d+) failed", out))
        extra = f"  ({tests} passed, {failed} failed)" if "test result" in out else ""
        report.append(f"[{'ok' if code == 0 else 'FAIL'}] {name}{extra}")
        if code != 0:
            ok = False
            report.append("\n".join("      " + l for l in out.splitlines()[-25:]))
    esp = Path.home() / "export-esp.sh"
    xt = ["bash", "-c", f". {shlex.quote(str(esp))} >/dev/null 2>&1 && CARGO_UNSTABLE_BUILD_STD=core cargo +esp build -p tapstone-proto --target xtensa-esp32s3-none-elf"]
    if esp.exists():
        code, out = run(xt, tree / "rust", dict(env, CARGO_TARGET_DIR=str(work / "target-xtensa")))
        report.append(f"[{'ok' if code == 0 else 'FAIL'}] xtensa-esp32s3 build")
        ok &= code == 0
    else:
        report.append("[skip] xtensa-esp32s3 build (no ~/export-esp.sh)")

    # size_of::<Follower>() per target, by a const probe that fails and names the size.
    lib = tree / "rust" / "tapstone-proto" / "src" / "lib.rs"
    original = lib.read_text()
    lib.write_text(original + PROBE)
    for label, cmd, e in [
        ("x86_64 host", ["cargo", "build", "-p", "tapstone-proto"], env),
        ("thumbv7em", ["cargo", "build", "-p", "tapstone-proto", "--target", "thumbv7em-none-eabi"], env),
    ] + ([("xtensa-esp32s3", xt, dict(env, CARGO_TARGET_DIR=str(work / "target-xtensa")))] if esp.exists() else []):
        _, out = run(cmd, tree / "rust", e)
        m = re.search(r"found one with a size of (\d+)", out)
        report.append(f"size_of::<Follower>() on {label}: {m[1] + ' B' if m else 'probe did not fire (!)'}")
        ok &= m is not None
    lib.write_text(original)

    report.append("RESULT: " + ("PASS" if ok else "FAIL"))
    text = "\n".join(report)
    print(text)
    (work / "report.txt").write_text(text + "\n")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
