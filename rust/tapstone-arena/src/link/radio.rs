//! A desk-style shrine behind a real gateway (tapstone#132 item 1): the reference follower plus a
//! `ScriptedSeat` (desk.rs's `DeskShrine`), with its frames addressed for the air. The
//! `radio_shrine` bin runs this over `SerialLink`, so every frame between it and the arena crosses
//! two gateways and the radio, standing in for the shrine firmware.
//!
//! It stamps every cast and charge with a copy's UID (`DeskShrine::stamp_uids`): the arena behind
//! a gateway runs a strict registry. Two more things differ from the desk, both in addressing:
//! - the desk arena is node 200 (`ARENA_NODE`); over the air it is the arena gateway's own node,
//!   and a gateway answers `TXERR unknown-dst` for a node it has never heard (smol#548's README);
//! - a desk shrine beacons its lobby every 10 ms tick, which over the air is 100 frames a second
//!   from one seat. One beacon per `beacon_ms` is kept; claims and play taps pass untouched.
use tapstone_proto::frame::Frame;
use tapstone_sim::deck::Deck;

use super::Rx;
use super::desk::{ARENA_NODE, DeskShrine, copy_uid};

/// How often the radio shrine lets a lobby beacon through (the arena's own is every 2 s).
pub const BEACON_MS: u64 = 250;

pub struct RadioShrine {
    pub shrine: DeskShrine,
    /// The arena gateway's node, from its `HELLO`: where frames the desk sends to 200 go.
    pub arena: u8,
    pub beacon_ms: u64,
    last_beacon: Option<u64>,
}

impl RadioShrine {
    /// Shrine `index` (its figurine and copy UIDs, `copy_uid(index, k)`) on gateway node `node`,
    /// holding `deck` and claiming with its castle, talking to the arena on node `arena`.
    pub fn new(seed: u64, index: usize, node: u8, deck: &Deck, arena: u8) -> RadioShrine {
        let mut shrine = DeskShrine::with(seed, index, node, deck.castle, &deck.cards);
        shrine.stamp_uids = true; // the arena behind a gateway resolves casts by UID
        RadioShrine {
            shrine,
            arena,
            beacon_ms: BEACON_MS,
            last_beacon: None,
        }
    }

    /// The shrine's frames as the gateway should send them.
    fn address(&mut self, now: u64, frames: Vec<(u8, Vec<u8>)>) -> Vec<(u8, Vec<u8>)> {
        let mut out = Vec::with_capacity(frames.len());
        for (dst, bytes) in frames {
            if matches!(Frame::decode(&bytes), Some((_, Frame::Lobby(_)))) {
                if self
                    .last_beacon
                    .is_some_and(|t| now.saturating_sub(t) < self.beacon_ms)
                {
                    continue;
                }
                self.last_beacon = Some(now);
            }
            let dst = if dst == ARENA_NODE { self.arena } else { dst };
            out.push((dst, bytes));
        }
        out
    }

    /// A frame the shrine's gateway received: the replies to send (ACK, NAK, X, or nothing).
    pub fn rx(&mut self, rx: &Rx) -> Vec<(u8, Vec<u8>)> {
        let Some((h, f)) = Frame::decode(&rx.bytes) else {
            return Vec::new();
        };
        let replies = self.shrine.rx(&h, &f);
        // Replies carry no beacon, so the clock only matters for the throttle, which they skip.
        self.address(u64::MAX, replies)
    }

    /// One scheduler tick (`DeskShrine::act` with the claim always allowed): the frames to send.
    /// `manual` proposes nothing, the stall control.
    pub fn tick(&mut self, now: u64, manual: bool) -> Vec<(u8, Vec<u8>)> {
        let frames = self.shrine.act(now, true, manual);
        self.address(now, frames)
    }
}

/// `registry/copies.jsonl` rows for shrine `index` holding `deck`: its figurine (the castle's
/// design) and one row per list entry (`copy_uid(index, k)`), in the registry's `st1-NNN` form.
/// A scratch registry for a radio match; never JP's real one.
pub fn registry_rows(index: usize, deck: &Deck) -> String {
    let row = |uid: [u8; 7], design: u16| {
        let hex: Vec<String> = uid.iter().map(|b| format!("{b:02X}")).collect();
        format!(
            "{{\"uid\":\"{}\",\"design\":\"st1-{design:03}\"}}\n",
            hex.join(":")
        )
    };
    let mut s = row([4, 0, 0, 0, 0, 0, index as u8], deck.castle);
    for (k, &d) in deck.cards.iter().enumerate() {
        s.push_str(&row(copy_uid(index, k), d));
    }
    s
}
