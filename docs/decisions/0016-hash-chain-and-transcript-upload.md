# 0016 — One hash chain; transcripts leave by HTTP from the arbiter
Date: 2026-09-20 · Brainstorm ruling (Q13/Q14), confirming the protocol draft

> **Amended by 0028 (2026-09-23):** every match has an arena, so the arbiter that posts the transcript is normally the arena itself.

Each committed event extends one chain: `h_n = SHA256(h_{n-1} ‖ record ‖ canonical_state)[..8]`.
The final hash commits to the whole transcript; a divergence halts and shows both hashes, and the
posted transcript is the diagnosis. Separate state and record hashes are not worth their bytes.

The match transcript (24-byte records, plus the JSON rendering) leaves the table over the
arbiter's own HTTP POST to scry-glass — the arena when present (0006), otherwise the arbitrating
shrine, exactly as the scry spike reports a tap today. The mesh uplink caps at 256 bytes and is not
used for transcripts. A Duel played away from WiFi keeps its transcript in flash until it next
sees the network; rooms where only the crown has WiFi are a smol issue (protocol draft §8).
