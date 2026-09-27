---
title: "NFC and RFID card and miniature games — what shipped, what died, and why"
last_verified: 2026-09-20
sources:
  - https://nfc.toys/  (Skylanders / Disney Infinity / amiibo chip types, key derivation, cloning)
  - https://marijnkneppers.dev/posts/reverse-engineering-skylanders-toys-to-life-mechanics/
  - https://www.nintendolife.com/news/2016/11/rumour_the_skylanders_franchise_might_be_facing_cancellation
  - https://www.gamespot.com/articles/disney-infinity-discontinued-developer-shuttered-w/1100-6439677/
  - https://www.cbr.com/lego-dimensions-discontinued/
  - https://shop.mattel.com/pages/hot-wheels-id-faqs
  - https://techcrunch.com/2016/10/05/lightseekers-aims-to-evolve-toys-to-life-with-rich-stories-and-many-ways-to-play/
  - https://store.steampowered.com/app/988430/Lightseekers/
  - https://steamcommunity.com/app/988430/discussions/0/5940851423455389132/
  - https://www.nintendolife.com/news/2018/12/malkyrs_the_interactive_card_game_will_bring_trading_cards_to_life_on_switch_using_nfc_tech
  - https://malkyrs.backerkit.com/hosted_preorders/project_updates
  - https://www.harmonixmusic.com/blog/an-update-on-dropmix
  - https://en.wikipedia.org/wiki/DropMix
  - https://www.genesisbattleofchampions.com/  and  https://cardgamer.com/reviews/genesis-battle-of-champions-review/
  - https://keyforging.com/keyforge-deck-ownership-2/
  - https://starwars.fandom.com/wiki/Star_Wars:_Card_Trader
  - https://ygorganization.com/more-info-on-the-rush-duel-duel-disk/
  - https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Mezastar
  - https://labs.ksec.co.uk/product/magic-ntag215-uid-changeable/
  - https://amiibodoctor.com/2021/10/17/can-you-get-banned-for-using-fake-amiibo/
---

# NFC/RFID card and miniature games — the field, 2011–2026

Every entry: what the tag was, what read it, whether a phone was in the loop, what shipped, how it
ended. Dates are release/shutdown dates as reported by the linked sources on 2026-09-20.

## The toys-to-life wave (console readers, no phone)

| Game | Years | Tag | Reader | Phone? | Ending |
|---|---|---|---|---|---|
| **Skylanders** (Activision) | 2011–2016 | MIFARE Classic 1K (TNP3xxx variant), Crypto-1 sector keys derived from UID via CRC48, payload additionally AES-128 | "Portal of Power" USB/wireless pad per console | No | Six annual games; *Imaginators* (2016) undersold and the 2017 game was cancelled |
| **Disney Infinity** | 2013–2016 | MIFARE Classic (MF1S20), one key for all sectors, SHA-1(UID + constants) | "Infinity Base" | No | Cancelled May 2016; $147 M charge, Avalanche closed (~300 jobs). Disney cited "lack of growth in the toys-to-life market, coupled with high development costs"; 2 M Hulks made, 1 M sold |
| **LEGO Dimensions** (TT Games) | 2015–2017 | NTAG213 in the minifig base | "Toy Pad" | No | Ended Oct 2017; declining sales, an expensive hybrid to produce |
| **amiibo** (Nintendo) | 2014– | NTAG215, write password = XOR of UID bytes with 0xAA/0x55; payload encrypted with Nintendo keys | Wii U GamePad / 3DS / Joy-Con / Switch | No | Still sold in 2026. The one survivor: cheap tags, reader already in the console, no game *depends* on them |
| **Hot Wheels id** (Mattel) | 2019–2023 | NFC chip in the car | Phone at first; "Race Portal" track piece with its own reader | Yes for the app | Cancelled 2022 on "low sales and overproduction"; services off 2023-12-31; Mattel's FAQ also cites the chip licence ending |

**Cloning reality.** All three big toys-to-life lines were broken the same way: keys are a pure
function of the UID, so once the algorithm leaked every tag was readable and, with UID-writable
"magic" tags, fully clonable. nfc.toys' verdict on amiibo: the password is "hand-calculable by pen
and paper." Nintendo's counter is server-side and game-side (Animal Crossing checks lock bits and a
UID whitelist and rejects most user-written cards), not in the tag. Crypto-1 itself was broken
2007–2009 (see `tag-security.md`).

## Card games with chips in the cards

| Game | Years | Tag | Reader | Phone? | Ending |
|---|---|---|---|---|---|
| **DropMix** (Harmonix/Hasbro) | 2017–2019 (app pulled 2022-12-14) | NFC chip in each music card | Bluetooth+NFC board with five slots | **Yes** — the board was a peripheral to a phone/tablet app | Discontinued 2019; Harmonix took the servers from Hasbro "indefinitely", no new cards or boards; app delisted 2022 |
| **Malkyrs** (Malkyrs Studio, FR) | 2018–2019 | NFC in each card, "262 cards" in the starter | Joy-Con NFC (Switch) or the Android "Malkyrs Reader" app | **Yes** (or a Switch) | Studio closed Sept 2019 after the Switch build never launched; last expansion never printed; PC game made free on Steam |
| **Lightseekers** (PlayFusion) | KS 2016-10, retail 2017, Steam 2019-01-31 | **None in the cards** — figures were Bluetooth with motion sensors; TCG cards were scanned by *camera* for AR and to unlock digital copies | Phone/tablet camera, webcam on PC | **Yes** | Four figures ever; servers dead by 2022-07 per player reports; the physical TCG stopped earlier |

## Things on the brief's list that are not NFC (verified 2026-09-20)

- **Genesis: Battle of Champions** — a *paper* tactical TCG (5×6 arena, champions move 1–2 spaces,
  grid combat) funded on Kickstarter 2021–22, 2024, 2025. No chip, no scanning; a "Champion Companion
  App" exists, purpose not documented on the site. Worth studying as a grid-CCG, not as prior NFC art.
- **KeyForge** (FFG → Ghost Galaxy) — unique decks registered by **QR code** into Master Vault
  (3,454,515 decks as of 2025-06-29). Identity by registry, not by chip. Its ownership-dispute process
  is a preview of what a UID registry has to arbitrate.
- **Star Wars: Card Trader** (Topps, 2015–) — digital-only app, still running (2025-26 season); a
  physical set was printed alongside but not linked by chip.
- **Yu-Gi-Oh! Rush Duel Duel Disk** (Konami toy, 2021-12-18; Yudias version 2022-12-17) — a prop
  with life-point buttons, voices, and an "ID card slot" that selects a character's voice. No source
  found describing card reading of any kind; the mechanism behind the ID slot is **unverified**.
- **Pokémon Mezastar / Ga-Olé** (Takara Tomy arcades) — tags are read by **QR code** on the back;
  "no microchip, battery, RFID antenna, or NFC circuit". The closest thing to Tapstone's tap-to-summon
  in the arcade world uses optics, and the arcade cabinet is the shrine.
- **"Hex Trap"** — no game by that name found; only Skylanders *Trap Team* NFC trap crystals and the
  Skylanders "Hex" figure. Treat as a mis-remembered title.
- 2020s "phygital" NFC cards (PhygiCards, CryptoMages) are NFT-authentication products, not games.

## What the pattern says

1. **Every phone-mediated design died with its server.** DropMix, Malkyrs, Lightseekers, Hot Wheels
   id — the physical object outlived the service that gave it meaning. amiibo survives because the
   reader is in a console that also does everything else and no title *needs* the tag.
2. **The chip was never the moat.** Skylanders, Infinity and amiibo all used deterministic UID-derived
   keys; all three were cloned. What actually limited cloning was cheap retail figures (why clone a
   $10 toy) and server/game-side checks.
3. **The economics killed the big three, not the tech**: annual boxed releases, overproduction
   (Infinity's 2:1 Hulks), licensing friction, "toys-to-life is expensive to play" fatigue.
4. **Card-with-chip games needed a bespoke reader and shipped one** (DropMix board) or borrowed one
   (Joy-Con). Neither found a lasting audience; the reader was always a satellite of a phone.

## Lessons for a phoneless two-shrine design

- **The shrine is the console, and it must be sufficient.** No entry above survived when the
  device on the table depended on a server. Tapstone's brief already says no phone, no server; keep
  the *rules engine, card data and art* on the shrine, and treat the mesh as optional — two shrines
  must play with WiFi off and no HA in the room.
- **Design the identity tier as if the chip will be cloned**, because on every precedent it was
  (`0003-card-identity.md` already does this). For a friends-run, the UID registry is the whole
  story; make the registry the source of truth the shrine consults, not the tag contents.
- **Never store game state on the card.** Skylanders/Infinity wrote XP to the figure and had to
  encrypt it; amiibo writes save data and had to password it. Tapstone's match transcript is a tap
  list; the card only needs to *be* itself.
- **Print cards that are good cards even if the shrine is off.** Genesis and KeyForge are pure paper
  and outlived every NFC peer. A Tapstone card with stats and rules text on its face is playable by
  hand, and that is the fallback the NFC games never had.
- **Cheap tags and a reader you already own** is amiibo's formula and Tapstone's: NTAG215 blanks
  plus the MFRC522 that is already on the CYD.
- **Avoid the annual-set treadmill.** Two factions, ≤30-card decks, a small set that gets *balanced*
  rather than *replaced* — the opposite of what burned toys-to-life.
