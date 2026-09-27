//! JSON transcript of one game. The rules crate has no serde; every conversion lives here.
use serde::{Deserialize, Serialize};
use tapstone_rules::{HouseRules, Phase, Winner};

use crate::arbiter::{Arbiter, Committed};

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Clone)]
pub struct HouseRulesJson {
    pub deck_size: u8,
    pub hand: u8,
    pub second_player_bonus: u8,
    pub castle_life: u8,
    pub pressure_from: u8,
    pub pressure: u8,
    pub stop_round: u8,
    pub commander_fall: u8,
    pub commander_return: u8,
}

impl From<&HouseRulesJson> for HouseRules {
    fn from(h: &HouseRulesJson) -> Self {
        HouseRules {
            deck_size: h.deck_size,
            hand: h.hand,
            second_player_bonus: h.second_player_bonus,
            castle_life: h.castle_life,
            pressure_from: h.pressure_from,
            pressure: h.pressure,
            stop_round: h.stop_round,
            commander_fall: h.commander_fall,
            commander_return: h.commander_return,
        }
    }
}

impl From<&HouseRules> for HouseRulesJson {
    fn from(h: &HouseRules) -> Self {
        HouseRulesJson {
            deck_size: h.deck_size,
            hand: h.hand,
            second_player_bonus: h.second_player_bonus,
            castle_life: h.castle_life,
            pressure_from: h.pressure_from,
            pressure: h.pressure,
            stop_round: h.stop_round,
            commander_fall: h.commander_fall,
            commander_return: h.commander_return,
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Clone)]
pub struct RecordJson {
    pub seq: u16,
    pub seat: u8,
    pub kind: String,
    pub card: u16,
    pub lane: i8,
    pub target: u8,
    pub aux: u8,
    pub time_ms: u32,
    /// 14 hex characters.
    pub uid: String,
    pub auth: u8,
    /// 16 hex characters; absent for lobby records.
    pub hash: Option<String>,
    /// `Debug` rendering of the engine's `Applied`.
    pub applied: String,
}

impl From<&Committed> for RecordJson {
    fn from(c: &Committed) -> Self {
        let r = &c.record;
        RecordJson {
            seq: r.seq,
            seat: r.seat,
            kind: format!("{:?}", r.kind),
            card: r.card,
            lane: r.lane,
            target: r.target,
            aux: r.aux,
            time_ms: r.time_ms,
            uid: hex(&r.uid),
            auth: r.auth,
            hash: c.hash.as_ref().map(|h| hex(h)),
            applied: format!("{:?}", c.applied),
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug, Clone)]
pub struct Transcript {
    pub seed: u64,
    pub house_rules: HouseRulesJson,
    pub decks: [Vec<u16>; 2],
    pub records: Vec<RecordJson>,
    pub refusals: u32,
    /// Hex of the chain head, or "" if the game never started.
    pub final_hash: String,
    /// "seat0" | "seat1" | "draw" | null.
    pub winner: Option<String>,
    pub rounds: u8,
    pub game_over: bool,
}

impl Transcript {
    pub fn from_arbiter(seed: u64, a: &Arbiter, decks: [Vec<u16>; 2]) -> Transcript {
        let g = &a.game;
        Transcript {
            seed,
            house_rules: HouseRulesJson::from(&g.rules),
            decks,
            records: a.records.iter().map(RecordJson::from).collect(),
            refusals: a.refusals,
            final_hash: a.chain.map(|c| hex(&c.head())).unwrap_or_default(),
            winner: winner_str(g.winner),
            rounds: g.round,
            game_over: g.phase == Phase::Over,
        }
    }

    /// One-line summary for the CLI.
    pub fn summary(&self) -> String {
        format!(
            "seed={} rounds={} winner={} records={} refusals={} final_hash={}",
            self.seed,
            self.rounds,
            self.winner.as_deref().unwrap_or("none"),
            self.records.len(),
            self.refusals,
            self.final_hash
        )
    }
}

/// "seat0" | "seat1" | "draw" | None — shared by the arbiter path and the replay path.
pub fn winner_str(w: Option<Winner>) -> Option<String> {
    w.map(|w| match w {
        Winner::Seat(0) => "seat0".to_string(),
        Winner::Seat(_) => "seat1".to_string(),
        Winner::Draw => "draw".to_string(),
    })
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
