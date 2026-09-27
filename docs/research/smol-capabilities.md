# smol's capabilities, mapped to Tapstone
Date: 2026-09-19 · Source: `~/Projects/smol/README.md` and `docs/CAPABILITIES.md` (69-row matrix)

JP's ask: use the whole platform, not just the mesh. Each row below is a smol capability that
exists today, the board it lives on, and the game feature it enables. 📋 marks a smol gap Tapstone
would need closed (with smol's issue number where known).

## Fleet and mesh
| smol capability | Tapstone feature |
|---|---|
| SMOLv1 ESP-NOW mesh, ~20 nodes, hop-limited flood for out-of-range leaves | Two shrines share one battlefield; a third or fourth board on the table becomes a **spectator screen** or a **judge**; a whole room of shrines forms a **tournament mesh** with no infrastructure |
| Crown election / gateway | The elected shrine is the **arbiter** for a match (tie-breaks, turn clock); in a room, one shrine bursts to WiFi and posts results to HA |
| Mesh time-sync (newest-NTP-wins) | **Turn timers and sudden death** agree across shrines without negotiation; tap timestamps are comparable, so the match transcript orders itself |
| Magical realm names from node id (realm-sigil) | Every shrine has a **title** (Draconic Dominion…) that becomes the player's in-game name; deck sigils from list hashes name the decks |
| Marauder's Watch (roster RSSI near/far) | **Table proximity**: shrines only pair with the one across the table, and a spectator board knows which side it's sitting on |
| Treasure Hunt (RSSI warmer/colder) | A **hidden-objective mode**: find the shrine holding the relic |
| World Snake MMO (shared 256×256 world, leaderboard, treasure-powers) | Proof the mesh can hold a **shared world**; Tapstone's persistent **campaign map** between matches, and the leaderboard pattern for a room ladder |
| Keyed-CFG (every knob over the mesh from HA) | **House rules** pushed to every shrine at once: turn limit, deck size, starting life; card-set version pinning |
| Signed mesh-OTA + reproducible builds | **Card-set and rules updates** delivered to shrines over the mesh, signed; a shrine's image hash is its ruleset identity, so both players provably run the same rules |
| HA discovery, retained DIAG, MQTT gateway | **Match results, deck stats and shrine health in Home Assistant**; Grimoire-style chronicle for Tapstone for free |
| Runtime IO registry (bind button/LED/relay per node) | Shrine **accessories**: a life-total dial, a "pass turn" button, a relay for a table lamp that dims on sudden death |

## The shrine itself (s3-cyd, GUI flavor)
| smol capability | Tapstone feature |
|---|---|
| ILI9341V 320×240 colour + FT6336U capacitive touch | The battlefield, unit sprites, life totals; **touch to target** when a card has a choice (which lane, which enemy) |
| MFRC522 reader on SPI (scry station) | The tap. Also **tap-and-hold** as a distinct gesture (hold to activate an ability, tap to cast) |
| Custom screens from HA | **Idle faces** between games (the scry station already has them); post-match summaries authored server-side |
| Status LED / WS2812 (🛠 pin only on GUI, #491) | **Lane and phase lighting**: LED ring under the pad glows the active player's colour, flashes on lethal |
| smol Cast → WLED matrix | **Spectator wall**: mirror the battlefield to an LED matrix in the room |
| Audio out (🔶 acoustic proof pending, #477) · mic (📋 #478) | Unit sounds, the Bard narrating the match; **voice commands** ("attack", "pass") later |
| Battery ADC (🛠 #479) | **Portable shrines**: battery face, low-battery flourish |
| Slint GUI flavor (compile-time scenes, 🛠 rendering gaps #473) | The animation layer; sprite scenes per faction. Gap to close: runtime scene switching for a card set that grows |

## The rest of the fleet (c3, c3-oled, c6-watch)
| board | Tapstone role |
|---|---|
| c3-oled (72×40 OLED, $2.76) | **Life counters / lane markers** on the mat: three tiny nodes show lane state and hit points; a **hand-size** or **mana** indicator next to each player |
| c3 headless | Hidden **mat sensors** (via IO registry): pressure pad under each lane cell so placing the physical card confirms the digital summon |
| c6-watch (AMOLED, mic + speaker, battery, IMU) | **Player's wrist**: private info (your hand's hidden effects, opponent's read), turn buzz, voice commands, the deck's sigil as a watch face |
| The Mesh Familiar (migrates across boards) | A **mascot** that lives in the winner's shrine and migrates when a shrine is powered off; flavour, and a reason to keep shrines on |
| The Bard (on-device transformer, off-fleet for DRAM) | **Match narration** in the fantasy voice, generated on-device once a board with the DRAM runs it (c6-class) |

## Gaps Tapstone would open in smol
1. GUI-flavor custom screens rendering (#473) and runtime scene switching — the animation layer needs it.
2. Audio path on the s3-cyd (#477) — unit sounds are half the joy of Cards and Castles.
3. LED ring on the s3-cyd (#491) — the pad glow.
4. A **Tapstone app** in the fleet flavor for c3-oled lane counters (mesh Snake shows the pattern).
5. A SMOLv1 frame type for **tap events + state hash** (the protocol; small, and it rides the existing mesh).

None of these are new hardware. All of them are issues in a repo JP already runs.
