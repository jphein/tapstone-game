#!/usr/bin/env python3
"""Compile game/cards/<set>/*.toml into the generated region of the rules crate's cards.rs.

Python >= 3.11 (tomllib). Validates the closed vocabularies (docs/design/card-data-format.md) and
rewrites the text between `// BEGIN GENERATED <SET>` and `// END GENERATED <SET>` (markers kept).
Byte-exact idempotent. `--check` generates into memory and compares instead of writing.
Exit 0 ok · 1 plumbing error · 2 validation error · 3 (--check) the committed file is stale.
"""
import sys

if sys.version_info < (3, 11):
    sys.exit("compile_cards.py needs Python 3.11+ (tomllib)")

import argparse
import re
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

FACTIONS = {"ember": "Faction::Ember", "tide": "Faction::Tide", "neutral": "Faction::Neutral"}
TYPES = ("unit", "spell", "castle")
KEYWORDS = {
    "ranged": "Keyword::Ranged",
    "shield1": "Keyword::Shield1",
    "haste": "Keyword::Haste",
    "rush": "Keyword::Rush",
    "taunt": "Keyword::Taunt",
}
RARITIES = ("common", "uncommon", "rare")
KNOWN_KEYS = {
    "id", "name", "faction", "type", "cost", "attack", "toughness", "keywords", "effect",
    "rarity", "version", "sprite", "art", "flavor",
}
ID_RE = re.compile(r"^([a-z]+[0-9]+)-([0-9]{3})$")
SET_RE = re.compile(r"^set([0-9]+)$")
EFFECT_RES = [
    (re.compile(r"^damage:([0-9]+):castle$"), lambda m: f"Effect::Damage {{ amount: {m[1]}, castle_ok: true }}"),
    (re.compile(r"^damage:([0-9]+):unit$"), lambda m: f"Effect::Damage {{ amount: {m[1]}, castle_ok: false }}"),
    (re.compile(r"^heal:([0-9]+):unit$"), lambda m: f"Effect::Heal {{ amount: {m[1]} }}"),
    (re.compile(r"^destroy:([0-9]+)$"), lambda m: f"Effect::Destroy {{ max_toughness: {m[1]} }}"),
    (re.compile(r"^shift$"), lambda m: "Effect::Shift"),
    (re.compile(r"^draw:([0-9]+)$"), lambda m: f"Effect::Draw {{ count: {m[1]} }}"),
]


class Invalid(Exception):
    pass


def u8(d, key, required=True):
    if key not in d:
        if required:
            raise Invalid(f"missing `{key}`")
        return None
    v = d[key]
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 255:
        raise Invalid(f"`{key}` must be an integer 0..=255, got {v!r}")
    return v


def effect_rust(text):
    for rx, render in EFFECT_RES:
        m = rx.match(text)
        if m:
            amount = int(m[1]) if m.groups() else 0
            if amount > 255:
                raise Invalid(f"effect amount {amount} exceeds 255")
            return render(m)
    raise Invalid(
        f"effect {text!r} not in the closed grammar "
        "(damage:N:castle | damage:N:unit | heal:N:unit | destroy:N | shift | draw:N)"
    )


def parse_design(path, id_prefix):
    d = tomllib.loads(path.read_text(encoding="utf-8"))
    unknown = set(d) - KNOWN_KEYS
    if unknown:
        raise Invalid(f"unknown keys: {', '.join(sorted(unknown))}")
    cid = d.get("id")
    m = ID_RE.match(cid) if isinstance(cid, str) else None
    if not m:
        raise Invalid(f"`id` must look like {id_prefix}-NNN, got {cid!r}")
    if m[1] != id_prefix:
        raise Invalid(f"`id` prefix {m[1]!r} does not match set prefix {id_prefix!r}")
    if path.stem != cid:
        raise Invalid(f"file name {path.name!r} does not match id {cid!r}")
    index = int(m[2])
    name = d.get("name")
    if not isinstance(name, str) or not name.strip():
        raise Invalid("`name` must be a non-empty string")
    if '"' in name or "\\" in name:
        raise Invalid("`name` may not contain quotes or backslashes")
    if d.get("faction") not in FACTIONS:
        raise Invalid(f"`faction` must be one of {sorted(FACTIONS)}, got {d.get('faction')!r}")
    typ = d.get("type")
    if typ not in TYPES:
        raise Invalid(f"`type` must be one of {list(TYPES)}, got {typ!r}")
    cost = u8(d, "cost")
    if d.get("rarity") not in RARITIES:
        raise Invalid(f"`rarity` must be one of {list(RARITIES)}, got {d.get('rarity')!r}")
    version = d.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise Invalid(f"`version` must be an integer >= 1, got {version!r}")

    keywords = d.get("keywords", [])
    if not isinstance(keywords, list) or any(k not in KEYWORDS for k in keywords):
        raise Invalid(f"`keywords` must be a list drawn from {sorted(KEYWORDS)}, got {keywords!r}")
    if len(keywords) > 1:
        raise Invalid("at most one keyword in v0")
    has_effect = bool(d.get("effect", ""))
    has_stats = "attack" in d or "toughness" in d

    faction = FACTIONS[d["faction"]]
    if typ == "unit":
        if has_effect:
            raise Invalid("a unit has no `effect`")
        attack, toughness = u8(d, "attack"), u8(d, "toughness")
        kw = f"Some({KEYWORDS[keywords[0]]})" if keywords else "None"
        row = f'unit({index}, "{name}", {faction}, {cost}, {attack}, {toughness}, {kw})'
    elif typ == "spell":
        if has_stats:
            raise Invalid("a spell has no `attack`/`toughness`")
        if keywords:
            raise Invalid("a spell has no `keywords`")
        if not isinstance(d.get("effect"), str) or not has_effect:
            raise Invalid("a spell needs exactly one `effect`")
        row = f'spell({index}, "{name}", {faction}, {cost}, {effect_rust(d["effect"])})'
    else:
        if cost != 0:
            raise Invalid("a castle costs 0")
        if has_stats or has_effect or keywords:
            raise Invalid("a castle has no stats, effect or keywords")
        row = f'castle({index}, "{name}", {faction})'
    return index, row


def compile_set(set_name, out_path, check=False):
    sm = SET_RE.match(set_name)
    if not sm:
        raise Invalid(f"set name must look like setN, got {set_name!r}")
    id_prefix = f"st{sm[1]}"
    region = set_name.upper()
    src_dir = REPO / "game" / "cards" / set_name
    files = sorted(src_dir.glob("*.toml"))
    if not files:
        raise Invalid(f"no .toml files under {src_dir.relative_to(REPO)}")

    designs = {}
    errors = []
    for f in files:
        try:
            index, row = parse_design(f, id_prefix)
            if index in designs:
                raise Invalid(f"duplicate index {index} (also {designs[index][0].name})")
            designs[index] = (f, row)
        except Invalid as e:
            errors.append(f"{f.relative_to(REPO)}: {e}")
    if errors:
        raise Invalid("\n".join(errors))
    expected = list(range(len(designs)))
    if sorted(designs) != expected:
        missing = sorted(set(expected) - set(designs))
        extra = sorted(set(designs) - set(expected))
        raise Invalid(
            f"{src_dir.relative_to(REPO)}: indices must be contiguous from 0; "
            f"missing {missing}, unexpected {extra}"
        )

    rel_src = (src_dir.relative_to(REPO)).as_posix()
    lines = [
        f"// Generated by tools/compile_cards.py from {rel_src}/*.toml — do not edit by hand.",
        "#[rustfmt::skip]",
        f"pub static {region}: &[CardDesign] = &[",
    ]
    lines += [f"    {designs[i][1]}," for i in expected]
    lines.append("];")
    generated = "\n".join(lines) + "\n"

    begin, end = f"// BEGIN GENERATED {region}\n", f"// END GENERATED {region}\n"
    text = out_path.read_text(encoding="utf-8")
    b, e = text.find(begin), text.find(end)
    if b < 0 or e < 0 or e < b:
        raise SystemExit(f"{out_path.relative_to(REPO)}: markers for {region} not found")
    new_text = text[: b + len(begin)] + generated + text[e:]
    if new_text != text and not check:
        out_path.write_text(new_text, encoding="utf-8")
    return len(designs), new_text != text


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--set", default="set1", help="set directory under game/cards/ (default set1)")
    ap.add_argument(
        "--out",
        default="rust/tapstone-rules/src/cards.rs",
        help="Rust file holding the generated region, relative to the repo root",
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="validate and generate into memory; exit 3 if the committed file differs, write nothing",
    )
    args = ap.parse_args()
    out_path = (REPO / args.out).resolve()
    try:
        n, changed = compile_set(args.set, out_path, check=args.check)
    except Invalid as e:
        print(e, file=sys.stderr)
        return 2
    rel = out_path.relative_to(REPO)
    if args.check:
        if changed:
            print(f"{rel} is stale: run tools/compile_cards.py")
            return 3
        print(f"{args.set}: {n} designs, {rel} is up to date")
        return 0
    print(f"{args.set}: {n} designs -> {rel} ({'updated' if changed else 'unchanged'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
