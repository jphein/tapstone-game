# 0018 — One pad now; a three-pad shrine is the two-point-oh experiment
Date: 2026-09-20 · Brainstorm ruling (Q16)

Playtest one uses the existing station: one MFRC522 under the apron (0005), lane chosen by touch
or default (0009). Shrine two-point-oh tries **three readers in a row, one per lane**, on one SPI
bus with separate chip-selects, polled one at a time (~30 ms each) so adjacent 13.56 MHz coils do not
couple; tapping a card *into* a lane is the lane choice, and the most common prompt disappears. The
MATCH event record already carries `lane`, so the protocol and rules do not change; only the apron
grows to three cards wide. If the three-pad shrine wins the table test, it becomes the product
shrine and the one-pad version the budget tier.
