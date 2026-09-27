//! The JSON rendering of a match: tapstone-sim's `Transcript`, the goldens' shape, so
//! `tapstone_sim::replay` can re-derive every hash through a fresh engine (spec §13).
use tapstone_rules::{HouseRules, Phase};
use tapstone_sim::transcript::{HouseRulesJson, RecordJson, Transcript, hex, winner_str};

use crate::core::Match;

pub(crate) fn to_json(m: &Match, rules: &HouseRules) -> Transcript {
    let records = m
        .log
        .iter()
        .map(|c| {
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
        })
        .collect();
    Transcript {
        seed: u64::from(m.id),
        house_rules: HouseRulesJson::from(rules),
        decks: m.decks.clone(),
        records,
        refusals: 0,
        final_hash: m.chain.map(|c| hex(&c.head())).unwrap_or_default(),
        winner: winner_str(m.game.winner),
        rounds: m.game.round,
        game_over: m.game.phase == Phase::Over,
    }
}
