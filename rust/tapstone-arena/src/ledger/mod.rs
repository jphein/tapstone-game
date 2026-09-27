//! The commander ledger (0030 correction, spec §8): one SQLite file, the arena its only writer.
mod apply;
mod journal;

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use tapstone_progression::{Loadout, derive_commander, item, level_for_xp, slots, xp_next};
use tapstone_proto::frame::{Doll, Equip, GRID_MAX, NONE8, NONE16, arena_refusal, equip_op};
use tapstone_rules::cards::design;

use crate::core::StatsSource;
use crate::registry::Registry;

pub use apply::{LedgerEvent, match_state, melt_reason, roll_for, roll_seed};
pub use journal::{OutboxRow, backoff_secs};

const SCHEMA: &str = include_str!("schema.sql");

pub struct Ledger {
    pub(crate) db: Connection,
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Why an equip is refused (spec §6.2 `E`). The wire carries only `code()`; tests and the station's
/// messages can name the rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EquipRefusal {
    NotSeated,
    BadSlot,
    BadOp,
    NotOwned,
    UnknownUid,
    NotAnItem,
    /// The resulting kit breaks a kit rule (0031/0034): a locked slot, a second keyword, ...
    Kit(tapstone_progression::LoadoutError),
    Db,
}

impl EquipRefusal {
    /// The `arena_refusal` code the `E` answer carries.
    pub fn code(self) -> u8 {
        match self {
            EquipRefusal::NotSeated => arena_refusal::NOT_SEATED,
            EquipRefusal::UnknownUid => arena_refusal::UNKNOWN_UID,
            _ => arena_refusal::BAD_LOADOUT,
        }
    }
}

/// A legal equip, before it is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EquipPlan {
    pub kit: Loadout,
    pub slot: usize,
    pub source: &'static str,
    pub card_uid: Option<String>,
}

impl Ledger {
    /// Check one loadout change without writing it: the kit it would make, or the rule it breaks.
    pub fn equip_check(
        &self,
        figurine: [u8; 7],
        e: &Equip,
        registry: &Registry,
    ) -> Result<EquipPlan, EquipRefusal> {
        let key = hex(&figurine);
        let xp = self
            .xp(&key)
            .ok()
            .flatten()
            .ok_or(EquipRefusal::NotSeated)?;
        let level = level_for_xp(xp);
        let slot = e.slot as usize;
        if slot >= 3 {
            return Err(EquipRefusal::BadSlot);
        }
        let mut kit = self.loadout(&key).map_err(|_| EquipRefusal::Db)?;
        let (source, card_uid): (&'static str, Option<String>) = match e.op {
            equip_op::CLEAR => {
                kit[slot] = None;
                ("loot", None)
            }
            equip_op::LOOT => {
                let owned = self.inventory(&key).map_err(|_| EquipRefusal::Db)?;
                if !owned.contains(&e.design) {
                    return Err(EquipRefusal::NotOwned);
                }
                kit[slot] = Some(e.design);
                ("loot", None)
            }
            equip_op::CARD => {
                // An item card is worn only if tapped in this lobby (0031); the registry maps its
                // copy to an item design in the item id space.
                let d = registry
                    .resolve_or(e.uid, e.design)
                    .ok_or(EquipRefusal::UnknownUid)?;
                kit[slot] = Some(d);
                ("card", Some(hex(&e.uid)))
            }
            _ => return Err(EquipRefusal::BadOp),
        };
        if kit[slot].is_some_and(|d| item(d).is_none()) {
            return Err(EquipRefusal::NotAnItem);
        }
        derive_commander(level, &kit).map_err(EquipRefusal::Kit)?;
        Ok(EquipPlan {
            kit,
            slot,
            source,
            card_uid,
        })
    }

    /// A commander's stored loss streak (tests and diagnostics).
    pub fn loss_streak_of(&self, figurine: [u8; 7]) -> Option<u32> {
        self.db
            .query_row(
                "SELECT loss_streak FROM commander WHERE key = ?1",
                [hex(&figurine)],
                |r| r.get(0),
            )
            .ok()
    }

    /// Give a commander a loot item outside a match, reporting a refused insert.
    pub fn try_grant(&mut self, figurine: [u8; 7], design: u16) -> rusqlite::Result<()> {
        self.db.execute(
            "INSERT OR IGNORE INTO inventory (commander, design, acquired_match) VALUES (?1, ?2, 'granted')",
            params![hex(&figurine), design],
        )?;
        Ok(())
    }

    /// Test-only: switch foreign-key enforcement, for the control that shows the FK is what refuses.
    pub fn set_foreign_keys_for_test(&self, on: bool) -> rusqlite::Result<()> {
        self.db.execute_batch(if on {
            "PRAGMA foreign_keys=ON;"
        } else {
            "PRAGMA foreign_keys=OFF;"
        })
    }

    /// The `match.state` column for a match id (tests and diagnostics).
    pub fn match_state_of(&self, match_id: u32) -> Option<String> {
        self.db
            .query_row(
                "SELECT state FROM match WHERE id = ?1",
                [format!("{match_id:08x}")],
                |r| r.get(0),
            )
            .ok()
    }

    pub fn open(path: &Path) -> rusqlite::Result<Ledger> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let db = Connection::open(path)?;
        // realmwatch's pragmas (db.py:484-498): WAL, foreign keys, a busy timeout.
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
        )?;
        db.execute_batch(SCHEMA)?;
        Ok(Ledger { db })
    }

    fn xp(&self, key: &str) -> rusqlite::Result<Option<u32>> {
        self.db
            .query_row("SELECT xp FROM commander WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()
    }

    pub fn loadout(&self, key: &str) -> rusqlite::Result<Loadout> {
        let mut out: Loadout = [None; 3];
        let mut st = self
            .db
            .prepare("SELECT slot, design FROM loadout WHERE commander = ?1")?;
        for row in st.query_map([key], |r| Ok((r.get::<_, usize>(0)?, r.get::<_, u16>(1)?)))? {
            let (slot, d) = row?;
            if slot < 3 {
                out[slot] = Some(d);
            }
        }
        Ok(out)
    }

    pub fn inventory(&self, key: &str) -> rusqlite::Result<Vec<u16>> {
        let mut st = self
            .db
            .prepare("SELECT design FROM inventory WHERE commander = ?1 ORDER BY rowid")?;
        st.query_map([key], |r| r.get(0))?.collect()
    }

    /// Test and operator helper: give a commander a loot item outside a match.
    pub fn grant_for_test(&mut self, figurine: [u8; 7], design: u16) {
        self.try_grant(figurine, design).unwrap();
    }

    fn doll_of(&self, key: &str, seat: u8) -> rusqlite::Result<Option<Doll>> {
        let Some(xp) = self.xp(key)? else {
            return Ok(None);
        };
        let level = level_for_xp(xp);
        let kit = self.loadout(key)?;
        let inv = self.inventory(key)?;
        let mut grid = [0u16; GRID_MAX];
        for (g, d) in grid.iter_mut().zip(&inv) {
            *g = *d;
        }
        let keyword = derive_commander(level, &kit)
            .ok()
            .and_then(|c| c.keyword)
            .map_or(NONE8, |k| k.code());
        let name_seed: u32 =
            u32::from_str_radix(&key[key.len().saturating_sub(8)..], 16).unwrap_or(0);
        Ok(Some(Doll {
            seat,
            level,
            xp: xp.min(u32::from(u16::MAX)) as u16,
            xp_next: xp_next(level).map_or(NONE16, |x| x as u16),
            slots: slots(level) as u8,
            loadout: kit.map(|s| s.unwrap_or(NONE16)),
            inv_len: inv.len().min(GRID_MAX) as u8,
            inv: grid,
            keyword,
            name_seed,
        }))
    }
}

impl StatsSource for Ledger {
    fn commander(&mut self, figurine: [u8; 7], castle: u16) -> Result<(u8, Loadout), u8> {
        let key = hex(&figurine);
        let faction = design(castle).map_or("neutral".to_string(), |d| {
            format!("{:?}", d.faction).to_lowercase()
        });
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        self.db
            .execute(
                "INSERT OR IGNORE INTO commander (key, name_seed, faction, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![key, 0, faction, now],
            )
            .map_err(|_| arena_refusal::BAD_LOADOUT)?;
        let xp = self
            .xp(&key)
            .map_err(|_| arena_refusal::BAD_LOADOUT)?
            .unwrap_or(0);
        let kit = self.loadout(&key).map_err(|_| arena_refusal::BAD_LOADOUT)?;
        Ok((level_for_xp(xp), kit))
    }

    fn doll(&mut self, figurine: [u8; 7], seat: u8) -> Option<Doll> {
        self.doll_of(&hex(&figurine), seat).ok().flatten()
    }

    /// One loadout change (spec §6.2 `E`): refused unless the result is a legal kit (0031/0034).
    fn equip(&mut self, figurine: [u8; 7], e: &Equip, registry: &Registry) -> Result<Doll, u8> {
        let key = hex(&figurine);
        let EquipPlan {
            kit,
            slot,
            source,
            card_uid,
        } = self
            .equip_check(figurine, e, registry)
            .map_err(|r| r.code())?;
        let tx = self
            .db
            .transaction()
            .map_err(|_| arena_refusal::BAD_LOADOUT)?;
        tx.execute(
            "DELETE FROM loadout WHERE commander = ?1 AND slot = ?2",
            params![key, slot],
        )
        .map_err(|_| arena_refusal::BAD_LOADOUT)?;
        if let Some(d) = kit[slot] {
            tx.execute(
                "INSERT INTO loadout (commander, slot, source, design, card_uid) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![key, slot, source, d, card_uid],
            )
            .map_err(|_| arena_refusal::BAD_LOADOUT)?;
        }
        tx.commit().map_err(|_| arena_refusal::BAD_LOADOUT)?;
        self.doll_of(&key, 0)
            .ok()
            .flatten()
            .ok_or(arena_refusal::BAD_LOADOUT)
    }
}
