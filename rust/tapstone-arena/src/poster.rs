//! Transcript posting (spec §10, D14). Synchronous and called from a blocking task, never from the
//! core or the lobby. A sink that is down, asleep or not yet implemented keeps its rows.
use std::time::Duration;

use serde::Deserialize;

use crate::ledger::Ledger;

#[derive(Debug, Clone, Deserialize)]
pub struct Sink {
    pub name: String,
    /// `{id}` is replaced with the 8-hex match id.
    pub url: String,
    #[serde(default)]
    pub enabled: bool,
}

/// Try every due row once. Returns `(delivered, failed)`.
pub fn drain_once(l: &mut Ledger, sinks: &[Sink], now: i64) -> (u32, u32) {
    let Ok(rows) = l.due(now) else { return (0, 0) };
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(5))
        .build();
    let (mut ok, mut bad) = (0, 0);
    for row in rows {
        let Some(sink) = sinks.iter().find(|s| s.name == row.sink && s.enabled) else {
            continue;
        };
        let url = sink.url.replace("{id}", &row.match_id);
        match agent
            .post(&url)
            .set("Content-Type", &row.content_type)
            .send_bytes(&row.body)
        {
            Ok(r) if (200..300).contains(&r.status()) => {
                let _ = l.done(row.id, now);
                ok += 1;
            }
            _ => {
                let _ = l.retry(row.id, now);
                bad += 1;
            }
        }
    }
    (ok, bad)
}

/// What a finished match puts in the outbox, one row per sink kind (spec §10).
pub fn enqueue_match(
    l: &mut Ledger,
    match_id: u32,
    tsx1: &[u8],
    json: &tapstone_sim::Transcript,
    now: i64,
) -> rusqlite::Result<()> {
    l.enqueue("scry", match_id, tsx1, "application/vnd.tapstone.tsx1", now)?;
    let body = serde_json::to_vec(json).unwrap_or_default();
    l.enqueue("realm", match_id, &body, "application/json", now)
}
