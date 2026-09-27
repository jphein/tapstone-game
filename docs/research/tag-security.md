---
title: "Tag security for a collectible card game — NTAG21x vs NTAG 424 DNA vs DESFire vs ST25, and what the scry MFRC522 can do"
last_verified: 2026-09-20
sources:
  - https://www.nxp.com/products/rfid-nfc/nfc-hf/ntag-for-tags-and-labels/ntag-424-dna-424-dna-tagtamper-advanced-security-and-privacy-for-trusted-iot-applications:NTAG424DNA
  - https://shopnfc.com/en/content/6-nfc-tags-specs
  - https://en.wikipedia.org/wiki/MIFARE  (Crypto-1 breaks 2007–2015; DESFire MF3ICD40 side-channel 2010–11; EV1 EAL4+, EV3 EAL5+)
  - https://labs.ksec.co.uk/product/magic-ntag215-uid-changeable/  and  https://github.com/RfidResearchGroup/proxmark3/blob/master/doc/magic_cards_notes.md
  - https://nfc.toys/  (amiibo password = XOR of UID bytes)
  - https://nfc.cards/en/white-cards/1-nfc-card-ntag213.html · /2-nfc-card-ntag215.html · /46-nfc-card-ntag424-dna.html  (EUR card prices, 2026-09-20)
  - https://www.shopnfc.com/en/nfc-cards/596-nfc-cards-in-pvc-ntag424-dna.html  and  https://shopnfc.com/en/nfc-cards/471-nfc-cards-nxp-mifare-desfire-ev3.html
  - https://shopnfc.com/en/nfc-hard-tags/553-nfc-garment-tags-ntag424-dna-in-flexible-pet-25mm.html  and  https://shopnfc.com/en/69-st25ta
  - https://nfcfyi.com/compare/ntag424-vs-mifare-desfire-ev3/  (chip-only bulk ranges)
  - https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf  (ISO 14443A/MIFARE/NTAG frontend, 64-byte FIFO, ≤50 mm)
  - https://github.com/Obsttube/MFRC522_NTAG424DNA  (424 DNA over MFRC522: what works, FIFO limit, MIT, 2023)
  - https://docs.rs/mfrc522/latest/mfrc522/struct.Mfrc522.html  (Rust crate 0.8: select/mf_*/transceive)
  - https://www.nxp.com/docs/en/user-guide/141520.pdf  (PN532 UM0701: InDataExchange handles ISO-DEP)
  - https://github.com/stm32duino/ST25R3916  (RFAL: auto RATS/ATS for SAK-bit-5 tags such as DESFire, NTAG424)
  - https://www.st.com/en/nfc/st25tn512.html  (ST25TN: Type 2, TruST25 signature, Augmented NDEF)
  - ~/Projects/smol/targets/s3-cyd/spike-scry/Cargo.toml  (mfrc522 = "0.8"; spike reads UID only)
---

# Tag security for Tapstone

Question: which chip goes in the card, at which run size, and what the shrine's existing
**MFRC522** can do with it. Decision `0003` (UID registry now, NTAG 424 DNA for retail) is confirmed;
this file supplies the numbers and one new action.

## The candidates

| Chip | Standard | User memory | Security | Cloneable? |
|---|---|---|---|---|
| **NTAG213 / 215 / 216** | ISO 14443-3A, NFC Forum Type 2 | 144 / 504 / 888 B | 32-bit password (write, optionally read), fixed 7-byte UID, ECC originality signature | **Yes.** No secret key. "Magic" UID-changeable NTAG213/215/216 are sold openly (KSEC, MTools, a few € each) and answer as a genuine tag with any UID; Proxmark `hf mfu setuid` writes it. amiibo's password is `UID[1]^UID[3]^0xAA…`, "hand-calculable." |
| **NTAG 424 DNA** | ISO 14443-4A, Type 4 (ISO 7816-4 file system) | 416 B total (256 user) | **AES-128**, 5 keys, 3-pass mutual auth, **SUN/SDM** (per-read UID + counter + CMAC mirrored into the NDEF URL), optional **LRP** side-channel-resistant mode, random ID, ECC originality signature, **CC EAL4** | Not without the key; no public break found as of 2026-09-20. Residual risk is the *verifier's* key leaking. |
| **MIFARE DESFire EV3** | ISO 14443-4A, Type 4 | 2–16 KB | AES-128/3DES, applications + files, SUN-like SDM on EV3, **CC EAL5+** | Original DESFire (MF3ICD40) was cloned by side-channel in 2010–11 (~$3 000 rig); EV1/EV2/EV3 have no documented break. |
| **ST25TN512/01K** | ISO 14443-3A, Type 2 | 512 b / 1 Kb | **TruST25** digital signature + Augmented NDEF (UID and read counter appended to the URL), kill/privacy | Signature is ST's *static* signature of the UID — it proves "genuine ST chip", not "genuine Tapstone card"; copy UID+signature to a UID-writable emulator and it passes. No key in the tag, so no per-tap freshness. *(TruST25 semantics inferred from ST's AN5580 description; ST pages timed out this session.)* |
| **ST25TV / TA** | TV: **ISO 15693 Type V**; TA: 14443-4 Type 4 | 64 B–8 KB | Password, TruST25 | TV is invisible to an MFRC522 (no 15693). TA is 14443-4 but password-only. |

**MIFARE Classic** (Skylanders, Disney Infinity) is listed only as a warning: Crypto-1 was reverse-
engineered 2007–08, card-only cloning under 10 s by 2009, the "hardened" EV1 broken 2015, and NXP
recommends migrating off it.

## SUN/SDM in one paragraph

On every read the 424 DNA rebuilds its NDEF URL with the UID, a monotonically increasing read
counter and an **AES-CMAC over both**, computed with a key that never leaves the chip. The verifier
recomputes the CMAC with the same (or a UID-diversified) key and checks the counter moved forward.
Reading that URL is a plain ISO-DEP `ReadBinary`, so **any reader that can speak 14443-4 can collect
SUN, and the verification is pure software**. For Tapstone that means the shrine verifies **offline**:
no phone, no server, no NXP cloud — the property every dead NFC game lacked (`nfc-card-games.md`).
Threat model honesty: the master key sits in shrine flash; ESP32-S3 flash encryption + secure boot
and smol's signed OTA are the mitigations, and per-card diversified keys (`CMAC(K_set, UID)`) bound
the damage of one card's key leaking. This is exactly the position every console reader was in.

## Cost per tag (EUR, CR80 white PVC card unless noted; European small-run vendors, 2026-09-20)

| Chip | 100 | 1 000 | 10 000 (extrapolated) | 30-card deck at 1 k |
|---|---|---|---|---|
| NTAG213 | €0.69 | €0.49 | ~€0.20 card; chip <$0.10 | €15 |
| NTAG215 (JP's current blank) | €0.79 | €0.59 | ~€0.25 card; chip <$0.10 | €18 |
| NTAG216 | not priced this session; between 215 and 424 | | | |
| NTAG 424 DNA | €1.35 (nfc.cards) · €0.95 at 200 (shopnfc) | €1.25 (nfc.cards) · **€0.65 at 800, €0.53 at 2 000, €0.49 at 6 000** (shopnfc) | ~€0.45 card; chip $0.20–0.50 mid-volume | **€16–20** |
| DESFire EV3 (2K–16K same price) | €1.85 | €1.45 at 200, €1.35 at 800, **€1.28 at 2 000** | ~€1.10 card; chip $1.50–4.00 | €38 |
| ST25TA02KB (ø29 sticker, not a card) | €0.59 | — | €0.25 at 5 000 | — |
| 424 DNA as 25 mm PET inlay (for JP's label-kit route) | €0.82 | €0.69 | €0.64 at 5 000 | €21 |

Vendor tiers vary by 2× at the same quantity (nfc.cards €1.25 vs shopnfc €0.53 for 424 DNA near 1–2 k);
quote several. At 10 k an inlay converter or NXP distributor replaces the web shops; the extrapolations
assume that.

## Reader support

| Reader | 14443-3A (NTAG21x UID/read) | 14443-4 / ISO-DEP (424 DNA, DESFire) | Type V (ST25TV) | Notes |
|---|---|---|---|---|
| **MFRC522** (on the CYD) | hardware | **software only** — the chip has a raw transceive and a **64-byte FIFO**; RATS/PPS/I-block framing must be written. Proven by Obsttube's Arduino library (Plain/MAC/Full modes, `AuthenticateEV2First`, `ChangeKey`, `SetFileSettings`, `ISOReadBinary`); it could not do LRP and could not fit a full `Read_Sig` on an Uno. | no | Datasheet: ≤50 mm with a tuned antenna; the common blue RC522 module reads a CR80 at roughly 2–4 cm (community figure, **measure on the scry unit**). |
| **PN532** | hardware | **hardware** — `InDataExchange` does ISO-DEP framing; DESFire/424 tutorials on ESP32 exist | no | Also 14443-B, FeliCa, P2P. ~$5–10 module. |
| **ST25R3916/3916B** | hardware | **hardware** — RFAL activates any SAK-bit-5 tag via RATS/ATS automatically | **yes** | Highest RF power, best range; heavier stack (RFAL). ~$10–15 module. |

**Read-through-sleeve.** 13.56 MHz does not notice a 0.1 mm polypropylene penny sleeve; **foil or
metallised sleeves kill it**, and two stacked cards detune each other. The 424 DNA's 50 pF input
capacitance is designed for smaller antennas, so a CR80 inlay reads no worse than an NTAG215. Rule for
the table: **one card on the pad, plain sleeves, card flat**; the scry flow already debounces
one-UID-per-presence.

## What the scry station's MFRC522 can and cannot do with 424 DNA

The spike (`smol targets/s3-cyd/spike-scry`) uses the Rust crate **`mfrc522 = "0.8"`** and today calls
`reqa → select → UID` and nothing else. The crate offers `mf_authenticate/mf_read/mf_write` (Classic)
and a **raw `transceive()`**, no ISO-DEP.

**Can, with new Rust on top of `transceive()`** (estimate: a few hundred lines — RATS/ATS, PPS,
I-block chaining with CRC/NAK, plus AES-128 CMAC, for which the S3 has a hardware AES unit):
- read the SUN URL (`ISOSelectFile` + `ReadBinary`) and **verify SDM offline** — the retail check;
- `GetVersion`, `AuthenticateEV2First/NonFirst`, `ChangeKey`, `SetFileSettings` — so the shrine can
  also **provision** cards (scry's "imbue" rite) with diversified keys and SDM enabled;
- keep working with NTAG215 in the same loop (SAK tells the two apart).

**Cannot, or not worth it on this chip:**
- LRP mode (no reference code anywhere; standard AES mode is fine for a card game);
- frames that exceed the 64-byte FIFO in one shot — chain them or skip the optional ECC originality
  signature (`Read_Sig`, 56 bytes + overhead);
- Type V / ST25TV — wrong air interface, full stop;
- range beyond ~5 cm — irrelevant for a tap pad.

## Recommendation by run size

| Run | Chip | Identity check | Why |
|---|---|---|---|
| **≤ ~300 cards, friends and playtests (v1)** | **NTAG215** blanks JP already stocks (€0.59–0.79) | scry `uid-map` registry + HMAC tokens; the shrine trusts the registry, never the tag contents | Cloning needs a €3 magic tag and a read of a genuine card — socially irrelevant at this size, and card art is redrawable |
| **1 k – 5 k, first sold set** | **NTAG 424 DNA** at €0.50–0.65/card | **SUN verified offline** on the shrine with per-card diversified keys; registry kept for names/ownership | Only ~€0.05–0.10 per card over NTAG215 at 2 k+; the one chip that makes a *phoneless* verifier honest. Cards are not retrofittable — decide before print (0003) |
| **10 k+** | NTAG 424 DNA still (~€0.45); DESFire EV3 buys a file system Tapstone does not need at ~2.5× the price; ST25 is either the wrong air interface or a static signature | Consider a **PN532 or ST25R3916 in the retail shrine revision** for hardware ISO-DEP and range, but the protocol must stay MFRC522-compatible so v1 shrines keep playing | |

**One new action for the plan:** the retail path's risk is the ISO-DEP framing code, not the chip.
Buy ten 424 DNA cards (€16) and land "read SUN + verify CMAC" on the scry spike **before** the
first Tapstone print, so `0003`'s cutover is a firmware flag, not a redesign.
