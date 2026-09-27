# Card data format (DRAFT)
Date: 2026-09-20 · One record per card *design*; one row per printed *copy*. Text in this repo,
compiled into the shrine image at build time (the fleet flavor has no heap to parse YAML on-device).

## Why two tables
A design is what the rules engine knows (cost, stats, effect). A copy is a physical object with a
tag UID, a print batch and an owner. The registry maps copies to designs; the engine never sees a
UID, only a design id and a seat. That keeps cloning, reprints and alt-art out of the rules.

## Design record (`game/cards/<set>/<id>.toml`)
Ids are contiguous from `stN-000` (the trailing number is the engine's design index) and the file
name equals the id. The generator refuses gaps, duplicates and unknown keys.
```toml
id = "st1-042"            # set-number, stable forever
name = "Ashen Vanguard"
faction = "ember"         # ember | tide | neutral (set 1)
type = "unit"             # unit | spell | castle | item (0031: item adds slot + effect)
cost = 3
attack = 3
toughness = 2
keywords = ["rush"]       # ≤1 in v0; the engine has the closed list
effect = ""               # spells: an id from the effect table, e.g. "damage:3:unit"
rarity = "common"         # common | uncommon | rare; drives print ratio, not power
sprite = "ember/vanguard" # sprite sheet key: idle + attack + death frames
art = "ember/vanguard.png" # card face art, 63×88 mm layout via realm-cards template
flavor = "They march because the hearth remembers."
version = 1               # bump when rules text changes; shrines reject mixed versions
```
The compiled artefact is the `CardDesign` slice `SET1` in `rust/tapstone-rules/src/cards.rs`
(id, name, faction, cost, kind) — 16 bytes a card on the shrine, so a 200-card game is ~3.2 KB of
rodata. `version` is not in the engine table yet.

## Copy registry (`registry/copies.jsonl`, one JSON object per line, append-only)
```json
{"uid":"04:89:4F:72:D5:2A:81","design":"st1-042","batch":"2026-10-A","tag":"NTAG215","printed":"2026-10-03","owner":"jp","note":"alt art"}
```
- `uid` is the tag's 7-byte UID (scry's `uid-map.json` convention).
- Binding a copy is the scry **imbue** rite pointed at a design instead of a host; **inscribe** writes
  an NDEF URL `https://tapstone.realm.watch/c/<uid>?k=<hmac12>` so a phone tap shows the card page —
  `<uid>` as 14 lowercase hex chars without separators, `k = HMAC-SHA256(secret, "copy:" + uid)[:12]`
  with the colon form of the UID; the static site carries `k` without verifying it (decision 0024).
- The shrine carries a compiled UID→design map for the copies it should know (a deck's 30 plus the
  owner's collection), refreshed over keyed-CFG; an unknown UID is refused with "not registered".
- Retail tier: replace `uid` trust with NTAG 424 DNA SUN verification (decision 0003); the record
  shape does not change.

## Deck record (`decks/<name>.toml`)
```toml
name = "Hearth March"
owner = "jp"
castle = "st1-001"
cards = ["st1-042", "st1-042", "st1-007", ...]   # 30 design ids (deck_size); copies are whatever the player taps
sigil = ""                                        # realm-sigil name from the sorted list, filled by tooling
```
Decks are lists of designs. Which physical copy you tap does not matter, exactly as in Arena.
**At most three copies of one design** (0040, 2026-09-27): the deck loader refuses a fourth
(`tapstone-sim/src/deck.rs`, `COPY_LIMIT`), and the list's length must equal the house rules'
`deck_size`.

## Effects table
A closed list the engine implements; the grammar lives in the generator (`tools/compile_cards.py`),
there is no `game/effects.toml`. v0 grammar, exactly as the generator accepts it: `damage:N:unit`, `damage:N:castle`, `heal:N:unit`, `destroy:N`
(destroys a unit with toughness ≤ N), `shift` (one lane sideways; direction comes from the tap's aux
byte), `draw:N`. Adding an effect is a firmware change by design: the shrine is the rules.

## Tooling
Today: `tools/compile_cards.py` (Python ≥ 3.11, stdlib `tomllib`) lints and compiles a set into the
`BEGIN/END GENERATED <SET>` region of `cards.rs`; `--check` exits 3 when the committed file is stale
(the CI gate). Later, in this repo: `tapstone print <set>` (realm-cards template → PDF sheets and
per-card PNGs), `tapstone bind <design>` (drives the imbue/inscribe rite).
