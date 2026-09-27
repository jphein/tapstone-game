# 0017 — A card remembers its battles; levels wait
Date: 2026-09-20 · Brainstorm ruling (Q15)

> **Superseded in part by 0030 (2026-09-23):** commander levels exist, bounded, held in the arena ledger. Card history on the tag stands.

From the first NTAG 424 DNA print (0003), the arbiter writes a card's **history** to its tag at
match end while it sits on the pad: the last N battles as (opponent shrine sigil, result, date),
signed with the shrine key so a forged saga fails verification. History affects no rule; it shows
on the card's page at `tapstone.realm.watch/c/<uid>` and in the shrine's card view.

**Rules-affecting levels are v2 or never**: only bounded (a level cap, titles and unlocks rather than
raw stats), only signed, only after a balance pass. The research lesson "never store game state on
the card" is honoured by keeping anything that changes play off the tag until then. NTAG215
playtest stock cannot sign and gets no history.
