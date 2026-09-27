---
title: "Cards and Castles (2015) and ULTIMATE (2026) — anatomy of the design school"
last_verified: 2026-09-20
sources:
  - https://store.steampowered.com/app/360730/Cards_and_Castles/  (2015-12-18, Red Team Games, 72% of 776)
  - https://store.steampowered.com/app/1719390/Cards_and_Castles_2/  (EA 2021-11-02, 1.0 2023-11-05, 79% of 432)
  - https://store.steampowered.com/app/3684810/Cards_and_Castles_Ultimate/  (2026-02-26, 81% of 110)
  - https://steamcommunity.com/app/3684810/reviews/?browsefilter=toprated
  - https://cardsandcastles.wiki.gg/wiki/Unit  and  https://cardsandcastles.wiki.gg/wiki/Keywords
  - https://cardsandcastles.fandom.com/wiki/Sudden_Death  and  https://cardsandcastles.fandom.com/wiki/Castle
  - https://mmos.com/review/cards-and-castles  and  https://mmohuts.com/review/cards-and-castles
  - https://playpile.gg/games/cards-and-castles-ultimate
---

# Cards and Castles — the design we are descending from

Three games by **Red Team Games**: *Cards and Castles* (Steam 2015-12-18, mobile 2013), *Cards and
Castles 2* (Early Access 2021-11-02, 1.0 2023-11-05, still live), and *Cards and Castles ULTIMATE*
(2026-02-26, package `cardsandcastles3`). The 2015 store page says the original "is nearing its end
of life" in favour of ULTIMATE. JP has ~560 hours in the lineage; where a number below is marked
**[JP]** it was not found online and should be confirmed from memory or a screenshot.

## The rules, as documented

| Element | Rule | Source |
|---|---|---|
| Board | A rectangular grid; each player summons only onto **their own half** ("yellow squares"). Castles sit in the **middle row, second-to-last column** of each side. Exact dimensions **[JP]** — no public page states them. | wiki.gg Unit, fandom Castle |
| Castle | **20 health** each at match start; a structure, targetable by units and spells; destroying it wins. Castle *abilities* existed in C&C 2 and were **removed** in ULTIMATE (players complain). | fandom Castle; Steam reviews |
| Movement | Most units **move 2 squares in any direction** per turn; **Elusive** moves 4 and passes through enemies. | wiki.gg Unit, Keywords |
| Attack | Melee attacks **any adjacent** opposing target. Ranged is a per-card range; **Sniper** and **Artillery** have unlimited range (Artillery only vs buildings). **Cleave** hits a 3×3, **Double Strike** attacks twice, **Charge** acts the turn it is summoned. | wiki.gg Keywords |
| Summoning sickness | Most units cannot act on the turn they are summoned (greyed out; green outline when ready). | wiki.gg Unit |
| Mana | **Gold/coins: 1 on turn 1, +1 per turn**, unspent gold does **not** carry over. Second player gets the **Medal of Bravery** (bonus coin) to offset going second. **Treasure** is a spendable substitute resource; Undead have **Tombstones**. | mmos.com, Keywords |
| Cards | **30-card deck**, up to **two factions plus neutrals** (ULTIMATE adds **dual-colour** cards). Draw 1 per turn. Mulligan: starting player 3 cards, second player 4 (C&C 2 wiki). Rarities Common/Rare/Epic/Legendary. | mmos.com, wiki.gg Core |
| Factions | 2015: Vikings, Crusaders, Warlocks, Pirates, Ninjas. C&C 2/ULTIMATE add **Druids, Undead** (seven). | Steam pages |
| Buildings | Summonable structures that buff, defend or damage; **Guardian** protects adjacent buildings; **Traps** trigger on the opponent's turn (hidden in ULTIMATE). | reviews, Keywords |
| Sudden death | Starts **after 20 turns (10 each)**; from then both castles **lose 1 life per turn** and each player **draws an extra card**. | fandom Sudden_Death |
| Match length | "10–15 minutes in single-player, longer in competitive multiplayer." | PlayPile |
| ULTIMATE additions | 500+ cards, dual-colour cards, **graveyard** where slain units persist as ghosts (resurrect, cast from the grave), **map objectives**, free drafting, campaign, bot matches, spectator mode. | Steam ULTIMATE |

Board size caveat: the fandom Castle page's "middle row" implies an odd row count; unit pages
imply a board small enough that "if all squares on your side are occupied you cannot summon" is a
real constraint. Pin the numbers before the lane count is frozen.

## What players praise (Steam, 2026)

- **"Board and unit positioning — it feels deeper than Hearthstone"** (240.8 h). Positioning, choke
  points and area effects are the identity; reviewers call the grid "real decision-making beyond
  simple card trades."
- **Moment-to-moment feel**: "fun and powerful", "cute art", units that walk onto the board as
  animated characters. The sound and motion of a summon is a large part of the appeal.
- **Buildings** as "a strategic layer that many CCGs do not have."
- **Not pay-to-win, generous rewards** (ULTIMATE); the 2015 game was criticised for the opposite.
- **Sudden death** is barely mentioned by reviewers — which means it does its job silently.

## What players hate

- **Cheap board wipes**: "4 cost destroy all characters spell… again placement doesn't matter."
  Cost-efficient AOE nullifies the very positioning the game is praised for.
- **Uncounterable swing cards / "automatic win condition decks"**; steal-and-swap effects; eternal
  looping units; invisible units.
- **Hand and deck disruption** — "uncompetitive and unfun."
- **Hidden traps** (ULTIMATE change): the opponent no longer knows a trap was played.
- **Units attacking the turn they are summoned** (Charge) producing unfair trades.
- **Removed features**: public lobbies, spectating, castle abilities.
- 2015-era: freezes "at least once every hour", slow F2P acquisition, "similarity is quite stunning"
  to Hearthstone, meta churn.
- PlayPile's split: 58% "fun but flawed", 32% "overcomplicated" — synergy opacity is the barrier.

## What survives on two 320×240 shrines

**Keep**
- **Half-board summoning, castle as a structure with 20 HP, 1/+1 gold, no carry-over, draw 1.**
  Every one of these is a counter, not a UI.
- **Move 2 / attack adjacent** on a grid of **lanes × 3–4 cells** — the brief's shape. Two squares
  of movement across a 4-cell lane means a unit reaches the enemy castle in two turns; that pacing
  is the C&C pacing.
- **Sudden death at a fixed turn count with 1 damage per turn and an extra draw** — cheap to
  implement, invisible to the player, proven to bound matches. With 20 HP castles and a 10-turn
  clock the match ends by turn ~30 at the latest.
- **Summoning sickness, Charge, Guardian, Cleave (as "this lane and both neighbours"), Double
  Strike, Warcry, Last Will** — all resolve deterministically from a tap list.
- **Medal of Bravery** — a second-player bonus is essential when the two shrines decide who goes
  first by election.

**Cut or reshape**
- **Free 2-D movement and 3×3 targeting.** On lanes, movement collapses to *advance/hold* and the
  choice of lane at summon time — which is the one thing a **touch** on the shrine can add.
- **Spells needing a target choice** beyond "which lane/which enemy" — every extra choice is another
  touch prompt on a 2.8-inch screen; keep spells lane-scoped or global.
- **Board wipes** — the most hated card class; with only 9–12 cells they are also the least
  interesting. Cap AOE at one lane.
- **Hidden traps and steal/swap effects** — hidden state is what a shared deterministic transcript
  does not want, and stealing a *physical* card is nonsense on a table.
- **Buildings as a separate class** — fold into "units that don't move."
- **Graveyard/ghost mechanics** — ULTIMATE's flagship, but it triples the zones; v1 has "few zones."
- **Hand disruption** — the hand is physical; the shrine cannot discard it.
- **30-card decks** → the brief's 20–30 is fine; 20 with draw-1 and sudden death at turn 20 means
  the deck exactly runs out at sudden death — a natural clock.
