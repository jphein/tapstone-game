# Tapstone — design brief (DRAFT)

**Status:** SUPERSEDED by `2026-09-20-tapstone-design.md` (approved). Kept as the record of where the
brainstorm started.

## One sentence
A physical-digital CCG: NFC cards tapped on a smol shrine summon animated units into a shared lane
battlefield that two shrines keep in sync over ESP-NOW, with the shrine as the rules engine.

## Why this can exist
Every hard hardware problem is already solved in JP's realm: the scry station reads and writes
NTAG215 on an S3-CYD with a 320×240 display, cards are printed on CR80 PVC in-house, tag identity
is a UID registry with HMAC tokens, and smol's mesh syncs boards without infrastructure. Tapstone
is a software project on a finished device.

## The experience
1. Two players set shrines on the table. Each shrine boots to its castle face and finds the other
   over the mesh; both screens show the same empty battlefield: three lanes, three or four cells.
2. A player taps a card on their shrine. The shrine validates it (owned, legal now, mana available),
   the unit animates into a lane on **both** screens, the physical card is placed on the table as
   its token.
3. Combat, spells and effects resolve on the shrines with sound and motion; life totals live on the
   screens. One tap per action.
4. **Sudden death** after a fixed turn count so a match ends in under ten minutes.
5. A match is a list of UID taps with timestamps; both shrines ran the same deterministic engine over
   it, so they agree by construction, and the list is the replay.

## Architecture in one paragraph (decision 0006)
One system with a movable centre. The smol ESP-NOW mesh is always the transport; every shrine,
the arena's gateway node and any spectator board are peers sending the same MATCH frames. One
elected node, the **arbiter**, orders taps and signs the state hash: the central **arena** when it
is on the table, otherwise the shrine that tapped first. If the arbiter leaves, the rest re-elect
and resume from the last agreed hash and snapshot. The rules are one `no_std` Rust crate run by
whichever node is arbiter. From the chair that is two experiences — Duel anywhere with two shrines,
or the table with the RealmOS arena and its LTSP screens hosting Skirmish, Siege and the Realm — and
one codebase. Leaderless consensus is ruled out.

## Design constraints (decisions, see docs/decisions/)
- Decks of 20–30 cards. Few zones. No hand-hidden information beyond the physical hand.
- Two factions per deck at most (Cards and Castles lineage), lanes not free positioning.
- The elected arbiter is the source of truth (0006); the mesh carries taps and state hashes, not opinions.
- Card identity tier decided by run size: UID registry now, NTAG 424 DNA for retail.
- Small screen: units are readable sprites with one idle and one attack animation each.

## Open questions for the brainstorm
- Mana: per-turn fixed, land-like cards, or tap-to-charge the shrine?
- How does a card leave the battlefield physically when it dies? (flip, move to a "grave" zone on
  the mat, or re-tap to acknowledge)
- Single-shrine solo mode against the shrine itself?
- What does the shrine show when no game is running? (the scry station's idle faces are a start)
- Art pipeline: cardpress paint scenes → sprite cuts, or hand-drawn?

## Use the whole platform (JP, 2026-09-19)
Not just the mesh. `docs/research/smol-capabilities.md` maps every smol capability to a feature:
election as arbiter, time-sync as the turn clock, realm names as player titles, RSSI roster for
table pairing and spectators, keyed-CFG for house rules, signed mesh-OTA for card-set updates with
a provable shared ruleset, HA for results, touch for targeting, LED ring for phase light, smol Cast
for a spectator wall, c3-oled nodes as lane counters, the c6 watch as the player's private screen,
the Familiar as a migrating mascot, the Bard as narrator. v1 picks the subset that fits the first
playtest; the rest is the roadmap.

## The game is a mesh (JP, 2026-09-20)
Players join and leave as shrines join and leave the mesh. A ring of castles around a central arena
(Q18), simultaneous rounds on the shared clock instead of alternating turns, a session that persists
on the arena, dormancy instead of disconnection. Modes are objectives over one rule set: Duel,
Skirmish, Siege, the Realm. Details and consequences: `docs/design/open-questions.md` Q19.

## Not in scope for v1
Online play, a phone app, trading, a marketplace. (More than two players is now in scope by
design; Duel ships first.)
