# 0037 — Cross-play: a headset is an arena view, never the source of truth
Date: 2026-09-25 · JP's ruling ("yes tapstone is truly cross play as part of it's ethos"; confirmed directly: "go ahead")

Tapstone is **cross-play by ethos**. A match works the same with or without a headset, and two people
can play when only one of them owns one. That holds because of where truth lives.

## The rule

- **The shrine and arena chain is authoritative.** Taps come from physical cards on physical shrines.
  The arena arbitrates (0028), the chain is hashed (0016, 0022), and the ledger is the arena's (0030).
- **A headset is an arena view**, one more renderer of the arena's live view model, exactly like the
  browser board (it consumes the same stream). It may also be an **input surface** for what touch
  already does (answering a prompt, choosing a target), but it never owns game state, never
  arbitrates, and a match never requires one.
- **Nothing is headset-only.** Any information or action a headset offers must also be available on the
  shrine (touch or card, 0009) or the browser board. Spectacle may be headset-only; outcomes may not.

## Why

JP's words. They also make a VR version defensible rather than a headset-gated fork of a physical
game: the headset enhances a game that stands on its own. And it keeps the one-source rule this repo
lives by (`docs/verification.md`): a VR renderer that held state would be a second description of the
match, which would drift.

## Consequences

- The VR track (the Meta VR Start Developer Competition, deadline 2026-11-18) is built as an arena view
  that consumes the existing SSE view model. The platform choice (WebXR vs Meta Spatial SDK) is decided
  by the design work under `scratch/vr/`, then a spec, then a plan.
- Any VR input goes through the same prompt and answer path as touch, so an arena that rejects it
  behaves as it would for a shrine.
