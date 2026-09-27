//! The match journal (spec D10) and the outbox (spec D14), in the ledger file.
use rusqlite::{OptionalExtension, params};

use super::{Ledger, hex};
use crate::core::{JournalOp, RecoveredMatch};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboxRow {
    pub id: i64,
    pub sink: String,
    pub match_id: String,
    pub body: Vec<u8>,
    pub content_type: String,
    pub attempts: u32,
}

/// Exponential backoff: 1 s, 2 s, 4 s … capped at 10 min (spec D14).
pub fn backoff_secs(attempts: u32) -> i64 {
    (1i64 << attempts.min(10)).min(600)
}

impl Ledger {
    pub fn journal(&mut self, op: &JournalOp) -> rusqlite::Result<()> {
        match op {
            JournalOp::Begin {
                match_id,
                rules,
                nodes,
                figurines,
                decks,
                start_unix,
            } => {
                let meta = serde_json::json!({ "nodes": nodes, "decks": decks, "start_unix": start_unix, "figurines": [hex(&figurines[0]), hex(&figurines[1])] });
                self.db.execute(
                    "INSERT OR REPLACE INTO match (id, started_at, rules, seat0, seat1, state, meta) VALUES (?1, ?2, ?3, ?4, ?5, 'playing', ?6)",
                    params![format!("{match_id:08x}"), start_unix, &rules[..], hex(&figurines[0]), hex(&figurines[1]), meta.to_string().into_bytes()],
                )?;
            }
            JournalOp::Record {
                match_id,
                record,
                hash,
            } => {
                let id = format!("{match_id:08x}");
                let mseq = u16::from_le_bytes([record[0], record[1]]);
                self.db.execute(
                    "INSERT OR REPLACE INTO match_records (match, mseq, record, hash) VALUES (?1, ?2, ?3, ?4)",
                    params![id, mseq, &record[..], hash.map(|h| h.to_vec())],
                )?;
            }
            JournalOp::End { match_id, result } => {
                self.db.execute(
                    "UPDATE match SET state = ?2 WHERE id = ?1 AND state = 'playing'",
                    params![
                        format!("{match_id:08x}"),
                        super::apply::match_state(result.reason)
                    ],
                )?;
            }
        }
        Ok(())
    }

    /// The match still `playing`, rebuilt as the core's `RecoveredMatch`.
    pub fn in_flight(&self) -> rusqlite::Result<Option<RecoveredMatch>> {
        let row: Option<(String, Vec<u8>, Vec<u8>)> = self
            .db
            .query_row(
                "SELECT id, rules, meta FROM match WHERE state = 'playing' ORDER BY started_at DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((id, rules, meta)) = row else {
            return Ok(None);
        };
        let meta: serde_json::Value = serde_json::from_slice(&meta).unwrap_or_default();
        let unhex = |s: &str| -> [u8; 7] {
            let mut out = [0u8; 7];
            for (i, b) in out.iter_mut().enumerate() {
                *b = u8::from_str_radix(s.get(2 * i..2 * i + 2).unwrap_or("00"), 16).unwrap_or(0);
            }
            out
        };
        let figs = meta["figurines"].as_array().cloned().unwrap_or_default();
        let deck = |i: usize| -> Vec<u16> {
            serde_json::from_value(meta["decks"][i].clone()).unwrap_or_default()
        };
        let mut st = self
            .db
            .prepare("SELECT record, hash FROM match_records WHERE match = ?1 ORDER BY mseq")?;
        let records = st
            .query_map([&id], |r| {
                let rec: Vec<u8> = r.get(0)?;
                let hash: Option<Vec<u8>> = r.get(1)?;
                Ok((
                    rec.try_into().unwrap_or([0; 24]),
                    hash.and_then(|h| h.try_into().ok()),
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Some(RecoveredMatch {
            match_id: u32::from_str_radix(&id, 16).unwrap_or(0),
            rules: rules.try_into().unwrap_or_default(),
            nodes: serde_json::from_value(meta["nodes"].clone()).unwrap_or([0, 0]),
            figurines: [
                unhex(figs.first().and_then(|v| v.as_str()).unwrap_or("")),
                unhex(figs.get(1).and_then(|v| v.as_str()).unwrap_or("")),
            ],
            decks: [deck(0), deck(1)],
            start_unix: meta["start_unix"].as_u64().unwrap_or(0) as u32,
            records,
        }))
    }

    pub fn enqueue(
        &mut self,
        sink: &str,
        match_id: u32,
        body: &[u8],
        content_type: &str,
        now: i64,
    ) -> rusqlite::Result<()> {
        self.db.execute(
            "INSERT INTO outbox (sink, match, body, content_type, next_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![sink, format!("{match_id:08x}"), body, content_type, now],
        )?;
        Ok(())
    }

    pub fn due(&self, now: i64) -> rusqlite::Result<Vec<OutboxRow>> {
        let mut st = self.db.prepare(
            "SELECT id, sink, match, body, content_type, attempts FROM outbox WHERE done_at IS NULL AND next_at <= ?1 ORDER BY id",
        )?;
        st.query_map([now], |r| {
            Ok(OutboxRow {
                id: r.get(0)?,
                sink: r.get(1)?,
                match_id: r.get(2)?,
                body: r.get(3)?,
                content_type: r.get(4)?,
                attempts: r.get(5)?,
            })
        })?
        .collect()
    }

    pub fn retry(&mut self, id: i64, now: i64) -> rusqlite::Result<()> {
        let attempts: u32 =
            self.db
                .query_row("SELECT attempts FROM outbox WHERE id = ?1", [id], |r| {
                    r.get(0)
                })?;
        self.db.execute(
            "UPDATE outbox SET attempts = ?2, next_at = ?3 WHERE id = ?1",
            params![id, attempts + 1, now + backoff_secs(attempts)],
        )?;
        Ok(())
    }

    pub fn done(&mut self, id: i64, now: i64) -> rusqlite::Result<()> {
        self.db.execute(
            "UPDATE outbox SET done_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    /// `VACUUM INTO` a consistent copy beside the ledger (`backups/ledger-<match>.sqlite`), then keep
    /// only the newest `keep`. Named by the 8-hex match id, so a re-applied result overwrites its
    /// own backup and never adds one.
    pub fn backup(&self, match_id: u32, keep: usize) -> rusqlite::Result<()> {
        let path: String = self
            .db
            .query_row("PRAGMA database_list", [], |r| r.get(2))?;
        // An in-memory ledger has no directory: refuse, rather than write ./backups wherever the
        // process happens to run.
        if path.is_empty() {
            return Err(rusqlite::Error::InvalidPath(":memory:".into()));
        }
        let dir = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("backups");
        let _ = std::fs::create_dir_all(&dir);
        let dest = dir.join(format!("ledger-{match_id:08x}.sqlite"));
        let _ = std::fs::remove_file(&dest);
        self.db
            .execute("VACUUM INTO ?1", [dest.to_string_lossy()])?;
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.file_name().to_string_lossy().starts_with("ledger-"))
                    .collect()
            })
            .unwrap_or_default();
        // Oldest first by mtime; the name breaks ties, so a burst inside one timestamp tick still
        // prunes deterministically.
        files.sort_by_key(|e| (e.metadata().and_then(|m| m.modified()).ok(), e.file_name()));
        let excess = files.len().saturating_sub(keep);
        for f in files.into_iter().take(excess) {
            let _ = std::fs::remove_file(f.path());
        }
        Ok(())
    }
}
