# 0021 — Combat targeting ruling; a lethal spell ends the game at once
Date: 2026-09-20 · Phase 1 implementation ruling (rules v0 §Turn 4)

Combat at every turn end is simultaneous for both seats: all damage is tallied, then applied. Per
lane, a **Taunt** unit anywhere on the defending side draws every attacker in that lane to the
nearest Taunt (front → back). Otherwise a **melee** unit attacks only from the front cell and hits
the enemy front cell or, if empty, the castle; a **Ranged** unit attacks from any cell and hits the
nearest enemy in the lane (front → back) or the castle. **Shield 1** ignores one damage per combat.
Reason: rules v0 said "the enemy unit facing it", which left mid- and back-cell defenders
unreachable by melee and made Taunt meaningless outside the front cell; the ruling keeps one tap per
action and gives Taunt and Ranged their intended roles.

A spell that brings a castle to 0 ends the game in the same event (`Applied::GameEnded`) instead
of waiting for the turn end. Reason: a castle at 0 during a live turn is never a displayable state,
and a follower must not accept further taps against it.
