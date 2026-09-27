//! Independent replay of a transcript: a second path over the rules crate that never touches the
//! `Arbiter`, so a divergence between the two would show.
use tapstone_rules::{Applied, Chain, Game, Kind, Phase, Record, Refusal};

use crate::CASTLES;
use crate::transcript::{RecordJson, Transcript, hex, winner_str};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Replay {
    pub final_hash: String,
    /// One entry per record: the chain head after it, `None` for lobby records.
    pub hashes: Vec<Option<String>>,
    pub game_over: bool,
    pub winner: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReplayError {
    BadKind { seq: u16, kind: String },
    BadUid { seq: u16, uid: String },
    Refused { seq: u16, refusal: Refusal },
}

impl std::fmt::Display for ReplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReplayError::BadKind { seq, kind } => write!(f, "record {seq}: unknown kind {kind:?}"),
            ReplayError::BadUid { seq, uid } => {
                write!(f, "record {seq}: uid {uid:?} is not 14 hex digits")
            }
            ReplayError::Refused { seq, refusal } => {
                write!(f, "record {seq}: refused on replay: {refusal:?}")
            }
        }
    }
}

impl std::error::Error for ReplayError {}

fn parse_kind(s: &str) -> Option<Kind> {
    Some(match s {
        "ClaimSeat" => Kind::ClaimSeat,
        "Mulligan" => Kind::Mulligan,
        "Charge" => Kind::Charge,
        "CastUnit" => Kind::CastUnit,
        "CastSpell" => Kind::CastSpell,
        "Advance" => Kind::Advance,
        "Pass" => Kind::Pass,
        "Leave" => Kind::Leave,
        "Draw" => Kind::Draw,
        _ => return None,
    })
}

fn parse_uid(s: &str) -> Option<[u8; 7]> {
    if s.len() != 14 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; 7];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

/// Decode one JSON record back into the wire record the arbiter applied.
pub fn decode_record(r: &RecordJson) -> Result<Record, ReplayError> {
    let kind = parse_kind(&r.kind).ok_or_else(|| ReplayError::BadKind {
        seq: r.seq,
        kind: r.kind.clone(),
    })?;
    let uid = parse_uid(&r.uid).ok_or_else(|| ReplayError::BadUid {
        seq: r.seq,
        uid: r.uid.clone(),
    })?;
    Ok(Record {
        seq: r.seq,
        seat: r.seat,
        kind,
        card: r.card,
        lane: r.lane,
        target: r.target,
        aux: r.aux,
        time_ms: r.time_ms,
        uid,
        auth: r.auth,
    })
}

/// Rebuild the game from the transcript's rules and decks, apply every record through a fresh
/// `Game` and a fresh `Chain` started at `Applied::Started`, and report what that path computes.
pub fn replay(t: &Transcript) -> Result<Replay, ReplayError> {
    let mut g = Game::new((&t.house_rules).into(), CASTLES, [&t.decks[0], &t.decks[1]]);
    let mut chain: Option<Chain> = None;
    let mut hashes = Vec::with_capacity(t.records.len());
    for rj in &t.records {
        let r = decode_record(rj)?;
        let applied = g.apply(&r).map_err(|refusal| ReplayError::Refused {
            seq: r.seq,
            refusal,
        })?;
        let h = if applied == Applied::Started {
            chain = Some(Chain::genesis(&g));
            None
        } else if let Some(c) = chain.as_mut() {
            c.step(&r, &g);
            Some(hex(&c.head()))
        } else {
            None
        };
        hashes.push(h);
    }
    Ok(Replay {
        final_hash: chain.map(|c| hex(&c.head())).unwrap_or_default(),
        hashes,
        game_over: g.phase == Phase::Over,
        winner: winner_str(g.winner),
    })
}

impl Replay {
    /// Does this replay agree with the hashes the transcript itself carries?
    pub fn matches(&self, t: &Transcript) -> bool {
        self.final_hash == t.final_hash
            && self.game_over == t.game_over
            && self.winner == t.winner
            && self.hashes.len() == t.records.len()
            && self
                .hashes
                .iter()
                .zip(&t.records)
                .all(|(h, r)| *h == r.hash)
    }
}
