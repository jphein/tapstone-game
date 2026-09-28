# Tapstone

*Tap the card to the stone.*

A collectible card game where every card carries an NFC tag. Each player has a **shrine**: a small
stone-like station with a screen, a speaker and a card pad. It's your commander's station, showing
your commander as a paperdoll with its gear, talking you through your turn, and taking every card you
tap. The shared battlefield is drawn by the **arena**, a small box or laptop on the table running the
arena service and a browser board. Shrines and arena talk over their own radio mesh. No phone, no
account, no internet: nothing depends on a server off the table.

Status: **in development.** Rules engine, commander, draw taps, the arena service (arbiter, ledger,
battlefield view, desk mode) and the shrine station screens are built and tested on the host (see
`rust/README.md`). The shrine firmware lives in smol. As of 2026-09-27:
- **Over the real radio:** whole matches through smol's USB gateway on two ESP32-S3 boards, with the
  hash chain verified, including a Roblox-style remote seat against a radio shrine
  (`docs/runbooks/radio-match.md`).
- **In a headset** (the Meta contest build, `rust/tapstone-web/www/xr`): a whole match by hand
  gestures, the painted set 1 card art, the first five minutes (spec §3.4) spoken by Azure voice clips,
  and the freeze tooling for the immutable contest bundle (`docs/runbooks/contest-freeze.md`).
- **Roblox:** the Tea House and a remote seat (0038, 0039).
- **Cards:** 14 painted cards, pages under `site/c/`, and print-ready 63×88 mm PDFs (not yet printed). The design changed on 2026-09-23 (decisions
0028–0036): before that, the shrine screen *was* the board and there was no arena.

## Read first
- `docs/superpowers/specs/2026-09-20-tapstone-design.md`: the design spec (amended 2026-09-23).
- `docs/decisions/`: one file per decision, dated, with the reason.
- `docs/superpowers/specs/2026-09-23-arena-service-design.md`: the arena.
- `docs/verification.md`: how claims get checked here.
- `docs/runbooks/`: the radio match and the contest freeze, step by step.
- `CLAUDE.md`: where the hardware, card production and identity layer live (sibling projects).

## License
- **Code** (everything under `rust/`, `roblox/`, `tools/`, the web and headset sources, and the protocol and design docs): **GNU AGPL-3.0-or-later**, in `LICENSE`. This matches smol, the shrine firmware, which vendors the engine crates.
- **Card art, lore and the Tapstone name** are not covered by the AGPL: **all rights reserved**. That means the paintings and any image of a card, the card and realm text and world, the voice clips, and the name and marks. Play and read them; don't reuse them without permission.
