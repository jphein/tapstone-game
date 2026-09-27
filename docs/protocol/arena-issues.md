# Issues the arena needs in other repos — ready to paste

**Filed 2026-09-23:** smol → [jphein/smol#548](https://github.com/jphein/smol/issues/548); realmwatch →
[jphein/realmwatch#139](https://github.com/jphein/realmwatch/issues/139). **Not filed:** scry.realm.watch has no
GitHub remote (`~/Projects/scry.realm.watch` is local-only), so its text below waits for one.

## smol: a Tapstone gateway app (USB serial ⇄ MATCH frames)
**Why:** the Tapstone arena (tapstone docs/superpowers/specs/2026-09-23-arena-service-design.md
§4) arbitrates every match from a laptop and reaches the mesh through one smol node on USB. smol
has no USB-serial gateway today (the "gateway" is the WiFi crown).
**What:** an app for any USB-capable target (C3 or S3) that
- joins the mesh as a normal node with WiFi off (it must never be the crown: a crown's WiFi burst
  deafens it for up to ~15 s, protocol draft §1);
- forwards every received `SMOLv1 MATCH ` frame to USB-Serial-JTAG as
  `@TS1 RX <src> <rssi> <mac_ok 0|1> <hex>` (trailer stripped; `mac_ok` from the #190 check);
- sends `@TS1 TX <id> <dst|255> <hex>` via `send_to` / `send_to_id` (issues #1, #5), answering
  `@TS1 TXOK <id>` or `@TS1 TXERR <id> <reason>`;
- prints `@TS1 HELLO <mac> <node_id> <fw_hash8> <group_epoch>` at boot and on `@TS1 PING`, and
  `@TS1 ROSTER <id>:<mac>:<rssi>,…` every 2 s;
- keeps printing its normal logs: the arena ignores any line without `@TS1 `.
RX follows c6-watch's debug console (RX-only HAL, TX via `println!`).
**Acceptance:** with the arena's PTY test as the model, a bench run where a second node's MATCH
frames appear as `RX` lines within 20 ms and a `TX` line reaches that node, verified by its log.

## smol: the Tapstone shrine app, rejoining after a reboot (posted on smol#548, 2026-09-23)
**Why:** a shrine that reboots mid-match loses its lseq counter. Before tapstone#75 the arena answered a
reused lseq with the old commit, and the shrine took that as confirmation of its new tap, so the tap was lost.
**What:** a shrine never proposes an lseq it has used in the match. After a reboot it re-syncs before
proposing: it applies every `mseq` up to the highest it has heard in any `C` and stays caught up for one head
re-broadcast period (1 s) or until it hears `R` (its first commits may be an old retransmit), by NAKing its gap or by
`J role=seat have_mseq=<held>`, which the arena answers with a full replay. It then resumes at its seat's last
committed lseq + 1, learned from the re-synced `C` frames (`Follower::last_lseq()` in the reference
follower). On `T sub=1 STALE_LSEQ` (107) it drops the pending tap, moves past the refused lseq, and re-syncs.
A seat's `J` while the arena is dark is deferred: it waits for the arena.
**Acceptance:** the arena harness's `tests/reboot.rs` scenarios, on the device. A shrine power-cycled
mid-match rejoins and keeps playing, and no STALE_LSEQ is ever answered to it.

## scry.realm.watch: accept Tapstone transcripts
**Why:** 0016 posts every transcript to scry-glass. The route exists only in the protocol draft.
**What:** `POST /tapstone/match/<id>?k=<HMAC(secret,"tapstone-arena")[:12]>`, body = binary TSX1
(`application/vnd.tapstone.tsx1`, header 36 B + 32 B records). Verify the token as `/tap/` does,
store the body, and publish `tapstone/match/<id>` retained on Mosquitto with the JSON rendering.
**Acceptance:** a posted transcript from `tapstone-arena --desk` appears on MQTT; a wrong `k` is 403.

## realmwatch: accept Tapstone transcripts into realm-engine
**Why:** 0030 keeps realm-engine's player records as a derived mirror of posted transcripts.
**What:** `POST /realm-engine/transcript`, body = the JSON rendering (tapstone-sim `Transcript`).
Ingest through `ingest_event(... event_type="tapstone.match" ...)`, deduped by match id. It is
never read by a lobby.
**Acceptance:** re-posting the same transcript does not duplicate the event.
