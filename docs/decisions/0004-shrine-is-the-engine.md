# 0004 — The shrine runs the rules; the mesh carries taps
Date: 2026-09-19

> **Amended by 0028 (2026-09-23):** the arena draws the board and arbitrates every match; shrines run the same crate for recovery and for the station view.

Both shrines run the same deterministic rules engine over the same ordered tap events. The mesh
exchanges taps and state hashes; disagreement is a bug, not a negotiation. A match transcript is the
tap list. This gives replay, spectating and anti-cheat for free and keeps the protocol tiny.

## Amended 2026-09-20 (decision 0006)
With a central arena on the table, the rule becomes: **the rules are one `no_std` Rust crate, and
whichever node is arbiter runs it** — the arena when present, the shrines for a two-shrine Duel.
The event list, chained hash and transcript stay exactly as written; only the arbiter's address
changes. Python (realmwatch plugins, HA, the web arena) consumes events and never re-implements
rules.
