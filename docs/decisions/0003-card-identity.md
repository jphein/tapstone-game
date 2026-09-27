# 0003 — Card identity: NTAG 424 DNA from the first real print; NTAG215 only for playtest stock
Date: 2026-09-19 · Amended 2026-09-20 after `docs/research/tag-security.md`

**Was:** UID registry (scry `uid-map`) for friends and small runs; NTAG 424 DNA for anything sold.

**Now:** the price argument is gone — CR80 NTAG 424 DNA cards run about €0.53 at 2,000 against
€0.59 for NTAG215 at 1,000 (sources in the research file), and SUN/SDM verification runs **offline
on the shrine** by recomputing an AES-CMAC over the tag's NDEF, no phone and no vendor cloud. Meanwhile
the UID registry is defeated by a €3 UID-changeable "magic" NTAG215 and one read of a genuine card.

So:
1. **Playtest one uses the NTAG215 blanks already on the shelf** with the UID registry. It proves the
   game, not the security.
2. **Before the first print run of real cards, the scry spike learns to read SUN and verify.** The
   `mfrc522` Rust crate is UID-only today but exposes raw `transceive()`; ISO-DEP framing plus the
   CMAC check is a few hundred lines. The cutover is then a firmware flag, not a card reprint.
3. **Every printed set is NTAG 424 DNA**, friends included. The registry stays as the design map
   (UID → design); it just stops being the proof.
Known chip limits to design around: the MFRC522's 64-byte FIFO (chain long reads), no LRP mode.
