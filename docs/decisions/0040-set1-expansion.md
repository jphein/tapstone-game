# 0040 — Set 1 expansion: 30-card decks, at most three copies, six new designs
Date: 2026-09-27 · JP's approval of #147 (the design, merged as 6603f52), implemented in the PR that adds this file

**Amends 0011** (deck size 25 → 30) and `docs/design/card-data-format.md` (a copy limit). Design and
evidence: `docs/superpowers/specs/2026-09-27-set1-expansion-proposal.md`.

- **Decks are 30 cards** (`HouseRules::default().deck_size`, inside `DECK_MAX = 30` and CLAUDE.md's ≤30).
  Everything else in 0011 and 0035 stands: hand 5, second-player bonus 1, pressure from 8, stop at 12.
- **At most three copies of one design** in a deck. It is a deck-building rule, enforced by the deck
  loader (`tapstone-sim/src/deck.rs`, `COPY_LIMIT`), not by the rules engine.
- **Six designs, st1-014…019**, with the names #147 proposed (JP kept them): Forge Runner, Bellows
  Raider, Slag Brute, Magma Burst (Ember); Brine Skimmer, Trench Leviathan (Tide). Existing
  vocabulary only; no engine work. Set 1 is 20 designs: 18 playable and the two castles.
- **The shipped decks** are each faction's eight designs plus the two neutrals, three of each.
- **Realms (0039), confirmed by JP with this approval:** Ember from the Forge Peaks, Tide from the Deep
  Tides, neutral from the Hearthlands. No card's realm is a PROPOSAL any more.

Why: today's decks had Ember beating Tide about 70–30 under both matched pickers (the 2026-09-27
imbalance report). On the implemented code the sim puts Ember's seat-averaged edge at 48.3 (play-out)
and 52.6 (pass-early), reproducing the proposal's figures; that is a prediction for the table test,
not a finding about human play (0026).

Not decided here: the second-player bonus re-sweep the proposal's §3.2 suggests (it stays 1), and the
six cards' art (0014), which costs Azure Foundry credit and waits for JP (`game/cards/awaiting-art.toml`).
