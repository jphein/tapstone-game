# 0014 — Painted card faces, pixel-art sprites
Date: 2026-09-20 · Brainstorm ruling (Q8)

> **Amended by 0033 (2026-09-23):** sprites ship in the SD data pack, with a minimal fallback in flash.

Card faces are painted scenes from the cardpress paint pipeline already used for realm-cards,
laid out on the 63×88 mm realm-cards template. Battlefield sprites are hand-made pixel art at a
32 px base and 48 px for heroes, three idle poses cycled 1-2-3-2-1 and one attack pose per unit,
with shared summon/lunge/flash/death effects (small-screen-tactics research). A card's painting and
its sprite need not be the same image; the sprite is the unit, the painting is the card. Sprites
ship as runtime data in the shrine's flash partition (0010) and as PNG sheets for the arena.
