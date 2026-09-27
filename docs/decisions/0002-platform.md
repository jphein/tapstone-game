# 0002 — Build on the scry station and smol, not new hardware
Date: 2026-09-19

The shrine is the existing scry station (ESP32-S3 CYD + MFRC522, smol target `spike-scry`). Cards
are the existing CR80/NTAG215 pipeline. Tapstone is an app and a protocol on that platform. Firmware
lives in smol; this repo holds game, protocol, data and tooling.
