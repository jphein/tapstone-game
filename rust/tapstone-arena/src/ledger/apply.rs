//! Spec §8.2: one transaction, applied once, deterministic loot.
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};
use tapstone_progression::{
    ABANDON_BEFORE_ROUND, DROP_EVERY_LOSSES, GRID, ITEMS, XP_LOSS, XP_MELT, XP_WIN, level_for_xp,
};
use tapstone_proto::frame::{MatchResult, result_reason};
use tapstone_rules::Faction;

use super::{Ledger, hex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerEvent {
    Xp {
        seat: u8,
        amount: u32,
    },
    Level {
        seat: u8,
        level: u8,
    },
    Drop {
        seat: u8,
        design: u16,
    },
    Melt {
        seat: u8,
        design: u16,
        why: &'static str,
    },
}

/// Spec §8.2: `over` for a result the engine reached, `abandoned` for a lost-seat timeout, `halted`
/// for a desync; the schema's four states, one function, used by the journal's End and here.
pub fn match_state(reason: u8) -> &'static str {
    match reason {
        result_reason::DESYNC => "halted",
        result_reason::TIMEOUT => "abandoned",
        _ => "over",
    }
}

/// D11: `SHA-256(transcript_sha ‖ seat)`, first 8 bytes LE.
pub fn roll_seed(sha: &[u8; 32], seat: u8) -> u64 {
    let mut h = Sha256::new();
    h.update(sha);
    h.update([seat]);
    let d = h.finalize();
    u64::from_le_bytes(d[..8].try_into().unwrap())
}

/// Why a drop melts, if it does: a duplicate, or a 13th item for a 12-cell grid (0031, 0032).
pub fn melt_reason(owned: &[u16], design: u16) -> Option<&'static str> {
    if owned.contains(&design) {
        Some("duplicate")
    } else if owned.len() >= GRID {
        Some("grid full")
    } else {
        None
    }
}

fn faction_of(s: &str) -> Faction {
    match s {
        "ember" => Faction::Ember,
        "tide" => Faction::Tide,
        _ => Faction::Neutral,
    }
}

/// The item a seat's roll picks, from the loot items its level makes eligible, weighted 2 for
/// the commander's own faction and 1 otherwise (spec §8.2). `None` if nothing is eligible.
pub fn roll_for(l: &Ledger, figurine: [u8; 7], sha: &[u8; 32], seat: u8) -> Option<u16> {
    let key = hex(&figurine);
    let (xp, faction): (u32, String) =
        l.db.query_row(
            "SELECT xp, faction FROM commander WHERE key = ?1",
            [&key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    pick(level_for_xp(xp), faction_of(&faction), roll_seed(sha, seat))
}

fn pick(level: u8, faction: Faction, seed: u64) -> Option<u16> {
    let weighted: Vec<(u16, u64)> = ITEMS
        .iter()
        .filter(|d| d.loot && d.min_level <= level)
        .map(|d| (d.id, if d.faction == faction { 2 } else { 1 }))
        .collect();
    let total: u64 = weighted.iter().map(|(_, w)| w).sum();
    if total == 0 {
        return None;
    }
    let mut r = seed % total;
    for (id, w) in weighted {
        if r < w {
            return Some(id);
        }
        r -= w;
    }
    None
}

impl Ledger {
    /// `apply_result_credit` crediting both seats: every table of real shrines.
    pub fn apply_result(
        &mut self,
        match_id: u32,
        r: &MatchResult,
        figurines: [[u8; 7]; 2],
        winner: Option<u8>,
        round: u8,
    ) -> rusqlite::Result<Vec<LedgerEvent>> {
        self.apply_result_credit(match_id, r, figurines, winner, round, [true, true])
    }

    /// Apply one match's result. Returns what happened, or nothing if it was already applied, if
    /// the match was a desync, or if it was abandoned before round 3 (0030). `credit[seat]` false
    /// skips that seat: no XP, no streak and no drop (a guest, 0038).
    pub fn apply_result_credit(
        &mut self,
        match_id: u32,
        r: &MatchResult,
        figurines: [[u8; 7]; 2],
        winner: Option<u8>,
        round: u8,
        credit: [bool; 2],
    ) -> rusqlite::Result<Vec<LedgerEvent>> {
        let id = format!("{match_id:08x}");
        let tx = self.db.transaction()?;
        let applied: Option<Option<i64>> = tx
            .query_row("SELECT applied_at FROM match WHERE id = ?1", [&id], |row| {
                row.get(0)
            })
            .optional()?;
        if matches!(applied, Some(Some(_))) {
            return Ok(Vec::new());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        let state = match_state(r.reason);
        tx.execute(
            "INSERT INTO match (id, started_at, rules, seat0, seat1, state, final_hash, transcript_sha, winner, reason, applied_at)
             VALUES (?1, ?2, x'', ?3, ?4, ?10, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET state=?10, final_hash=?5, transcript_sha=?6, winner=?7, reason=?8, applied_at=?9",
            params![id, now, hex(&figurines[0]), hex(&figurines[1]), &r.chain[..], &r.transcript_sha[..], winner, r.reason, now, state],
        )?;
        let mut events = Vec::new();
        let abandoned_early = r.reason == result_reason::TIMEOUT && round < ABANDON_BEFORE_ROUND;
        let Some(w) = winner.filter(|_| r.reason != result_reason::DESYNC && !abandoned_early)
        else {
            tx.commit()?;
            return Ok(events);
        };
        for seat in 0..2u8 {
            // 0038: a guest (the remote seat) has no commander row and earns nothing.
            if !credit[seat as usize] {
                continue;
            }
            let key = hex(&figurines[seat as usize]);
            let won = seat == w;
            // 0030: from round 3 a timeout pays the stayer a win and the leaver nothing, and the
            // leaver's streak is unchanged (0031 ruling).
            let leaver = r.reason == result_reason::TIMEOUT && !won;
            let (xp0, streak0): (u32, u32) = tx.query_row(
                "SELECT xp, loss_streak FROM commander WHERE key = ?1",
                [&key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let gain = if won {
                XP_WIN
            } else if leaver {
                0
            } else {
                XP_LOSS
            };
            let streak = if won {
                0
            } else if leaver {
                streak0
            } else {
                streak0 + 1
            };
            let drops = won || (!leaver && streak % DROP_EVERY_LOSSES == 0);
            let mut xp = xp0 + gain;
            if gain > 0 {
                events.push(LedgerEvent::Xp { seat, amount: gain });
            }
            if drops {
                let faction: String = tx.query_row(
                    "SELECT faction FROM commander WHERE key = ?1",
                    [&key],
                    |row| row.get(0),
                )?;
                if let Some(design) = pick(
                    level_for_xp(xp),
                    faction_of(&faction),
                    roll_seed(&r.transcript_sha, seat),
                ) {
                    let owned: Vec<u16> = {
                        let mut st =
                            tx.prepare("SELECT design FROM inventory WHERE commander = ?1")?;
                        st.query_map([&key], |row| row.get(0))?
                            .collect::<rusqlite::Result<_>>()?
                    };
                    match melt_reason(&owned, design) {
                        Some(why) => {
                            xp += XP_MELT;
                            events.push(LedgerEvent::Melt { seat, design, why });
                            events.push(LedgerEvent::Xp {
                                seat,
                                amount: XP_MELT,
                            });
                        }
                        None => {
                            tx.execute(
                                "INSERT INTO inventory (commander, design, acquired_match) VALUES (?1, ?2, ?3)",
                                params![key, design, id],
                            )?;
                            events.push(LedgerEvent::Drop { seat, design });
                        }
                    }
                }
            }
            if level_for_xp(xp) > level_for_xp(xp0) {
                events.push(LedgerEvent::Level {
                    seat,
                    level: level_for_xp(xp),
                });
            }
            tx.execute(
                "UPDATE commander SET xp = ?2, loss_streak = ?3 WHERE key = ?1",
                params![key, xp, streak],
            )?;
        }
        for e in &events {
            let (seat, kind, value, detail) = match e {
                LedgerEvent::Xp { seat, amount } => {
                    (*seat, "xp", i64::from(*amount), String::new())
                }
                LedgerEvent::Level { seat, level } => {
                    (*seat, "level", i64::from(*level), String::new())
                }
                LedgerEvent::Drop { seat, design } => {
                    (*seat, "drop", i64::from(*design), String::new())
                }
                LedgerEvent::Melt { seat, design, why } => {
                    (*seat, "melt", i64::from(*design), (*why).to_string())
                }
            };
            tx.execute(
                "INSERT INTO ledger_event (match, commander, kind, value, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, hex(&figurines[seat as usize]), kind, value, detail],
            )?;
        }
        tx.commit()?;
        Ok(events)
    }
}
