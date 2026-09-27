# 0006 — One system with a movable centre: the mesh is the transport, the arbiter is an elected role
Date: 2026-09-20 · Status: decided with JP in conversation; brainstorm confirms details.

> **Amended by 0028 (2026-09-23):** the arena is required for a match; shrine arbitration remains as the recovery path.

## The decision
Tapstone is **neither** a fully distributed consensus game **nor** a centrally managed one. It is one
protocol on one transport with one elected authority:

1. **The mesh is always the transport.** Shrines, the arena's gateway node and spectator boards are
   peers on the smol ESP-NOW mesh exchanging the same `MATCH` frames. No internet, no WiFi, no server
   is ever required for play.
2. **Authority is a role, not a device.** One node, the **arbiter**, orders taps, resolves rounds and
   signs the state hash. The arbiter is *elected*, the way smol elects its crown: the **arena claims
   the role when present** (it belongs to no seat and has the most compute); with no arena, a **shrine
   takes it — the offering shrine, whoever tapped first**. Same frames, same rules crate, same hash
   chain; only the arbiter's address changes.
3. **Handover, not failure.** If the arbiter leaves, the survivors re-elect and the new arbiter
   resumes from the last agreed hash and snapshot (the crown-handover pattern). Joiners receive a
   snapshot from whoever is arbiter. Nothing is ever "the server".
4. **One rules implementation.** A `no_std` Rust crate compiled into the shrine firmware and natively
   into the arena service (see 0004, amended). Python — realmwatch plugins, HA, the web arena —
   consumes the arbiter's event stream and never re-implements rules.

## What this looks like from the chair
- **Duel anywhere**: two shrines, no arena; one shrine arbitrates, both render a mirrored board.
- **The table**: shrines plus the RealmOS arena and its screens; the arena arbitrates, renders the
  ring, hosts Skirmish, Siege and the Realm, persists between evenings, bridges to HA.
Two experiences, one system.

## Ruled out
Leaderless consensus (every node votes on tap order). Theoretically pure, miserable on 400 KB
microcontrollers over a lossy radio, and it buys no gameplay. One elected orderer with a signed
chain gives determinism, replay and anti-cheat for one round trip per tap.

## Consequences
- Protocol: `Q12` is answered (offering shrine when no arena; arena otherwise); add `ELECT`-style
  arbiter claim/handover to the MATCH family; JOIN carries a role (seat / arena / spectator).
- 0004 amended: the rules are one crate; whichever node is arbiter runs it.
- 0005/Q18/Q20 stand: the arena is a RealmOS box with a smol gateway node and LTSP screen modules.
