# 0036 — Every draw is a tap; the engine knows a deck's list, not its order
Date: 2026-09-23 · Lead's call under JP's delegation ("full auto") · Amends 0022 · Found by morpheus-commander designing the arena

The deck is shuffled **physically** (protocol §1). The engine held a **digital** deck in play order
("the deck order is the seed", 0022) and refused any cast, spell or charge whose design was not in
its own simulated hand (`rules.rs`, `NotInHand`). The first card a real player drew that differed
from the engine's shuffle would have been refused, so playtest one could not have run. Desk mode
and the sim worked only because both sides shared one digital shuffle.

**Ruling: drawing is a tap.** You draw a card, and then you show it to the stone.

## The rule

- **The engine holds each seat's deck as a list (a multiset of designs), not an order.** Genesis
  hashes each seat's list.
- **A draw is a `Draw` record** whose card is the design tapped. It is legal only while that seat
  owes a draw, and only if the design still has an undrawn copy in its list. The card enters the
  hand, and the hand stays hashed exactly as 0022 says.
- **Draws owed:** the opening hand (5, plus the second-player bonus per 0035) after the claims; one
  at each turn start; and whatever a spell says ("draw two"). While a seat owes draws it can do
  nothing else, and the voice band says so ("draw 1 — tap it on the stone"). A deck with no undrawn
  copies owes nothing, which is the existing exhausted-deck rule.
- **Mulligan:** the player shuffles the hand back into the physical deck, the engine returns those
  designs to the list, and the seat owes **as many draws as the hand it returned**. That is rules
  v0's mulligan, the one every balance number was measured under. (Clarified 2026-09-23: the first
  wording said "a fresh opening hand", which would have cost seat 1 its turn-start card. Raised by
  luna-station building the station flow.)
- **One physical copy cannot stand in for two, and the arena enforces that, not the registry.** The
  engine never sees UIDs; the copy registry (`registry/copies.jsonl`) only maps a UID to its design.
  The arena refuses a `Draw` whose UID is already in that seat's hand or already played this match.
  A mulligan returns the in-hand UIDs to the drawable pool, so the rule is once per shuffle-in, not
  once per match (arena spec §5.2, plan Task 11b). Corrected 2026-09-23 after review: the first
  wording claimed the registry already enforced this, and it enforces nothing.

## Why taps, not an honour-system hand

The alternative, a deck list with no hand (hand size and draws left to the players, as in paper
play), costs no taps. But it gives up three things the design relies on. The engine would stop
enforcing hand size and the draw per round. The station's HAND readout (0032) would become
unknowable. And 0022's hashed hand, which is how two nodes notice they disagree about a hand, would
go. Drawing as a tap keeps all three, and it turns the draw into a moment the shrine can answer
with a small animation and a spoken card name.

**The cost is about a dozen taps a game** (five or six before turn one, then one a round), around
fifteen seconds against a ten-minute match. "One tap per action" holds, because a draw is an
action.

## Consequences

- Engine: `Kind::Draw`, a per-seat owed-draws counter in state and in the canonical image, the deck
  as a list, and genesis hashing the lists. Goldens move once.
- Sim: the scripted seats shuffle their own physical deck and tap draws, so the sim now models what
  the table does. Balance and fairness numbers should not move beyond noise, and that must be
  measured, not assumed: the 0030/0034 gate on both mirrors and the 0035 seat table.
- Protocol: the `Draw` kind (9) joins the record table. The arena's lobby flow gains the
  opening-hand draw prompts.
- The mulligan and draw prompts need a card-only path (0009), which they have by construction:
  every one of them is completed by tapping a card.

## Measured 2026-09-23 — no drift beyond noise

Engine and sim change landed on `feat/draw-taps`. The same commands ran on `main` just before
(built from `git archive`, the control) and on the branch: 4,000 games, seat 0 win %, both pickers.

| cell | main (Ember) | 0036 (Ember) | main (Tide) | 0036 (Tide) |
|---|---|---|---|---|
| fresh mirror, bonus 1 (shipped), play-out | 45.1 | 45.5 | 45.0 | 45.5 |
| fresh mirror, bonus 1, pass-early | 55.8 | 56.2 | 60.8 | 59.8 |
| bonus 0, play-out / pass-early | 57.5 / 59.6 | 58.5 / 59.4 | 57.8 / 62.9 | 56.9 / 62.1 |
| bonus 2, play-out / pass-early | 34.2 / 54.0 | 34.6 / 54.5 | 37.6 / 60.2 | 36.7 / 59.9 |
| commander gate, worst kit (Haste), play-out | 56.8 | 56.7 | 57.6 | 57.5 |
| commander gate, worst kit (Haste), pass-early | 52.6 | 52.8 | 54.3 | 54.2 |

Every cell moved ≤ 1.0 point, inside the ±1.5 interval, and the 0030/0034 gate still exits 0 on both
mirrors. The instrument can see a real change: the same table resolves the one-card bonus steps at
10–13 points. The only intended source of drift is the mulligan. The sim's paper deck draws in the
shuffle it always used, so a game is identical to the pre-0036 engine until a mulligan returns the
hand into the paper deck. Goldens: seeds 1 and 2 keep their winner and rounds, and seed 3 (two
mulligans) keeps its winner and ends in round 8, not 7. Raw output:
`scratch/commander-station/0036-{main,draws}-{commander,fairness}-mirror-{ember,tide}.txt`.

