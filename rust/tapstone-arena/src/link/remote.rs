//! The remote seat (0038): a manual desk-style shrine per remote *slot* inside the arena process,
//! riding beside the table's real link (the gateway's, or a desk link for the test table). A slot is
//! the 0-based position in the list of remote shrines the arena was started with: one slot plays
//! against the desk bot or a real shrine, two play each other with both desk shrines off (JP against
//! a second player, both in Roblox). Sans-IO like the rest of `link`; its HTTP face is `crate::remote`.
use std::collections::VecDeque;

use serde::Serialize;

use tapstone_proto::frame::{BROADCAST, Frame};
use tapstone_rules::Record;
use tapstone_sim::deck::Deck;
use tapstone_sim::human::Choice;

use super::desk::{DeskShrine, arena_bound, copy_uid};
use super::{Link, Rx};
use tapstone_progression::{Loadout, level_for_xp};
use tapstone_proto::frame::{Doll, Equip, arena_refusal};

use crate::core::StatsSource;
use crate::registry::Registry;

/// Slot 0's mesh node; slot `k` is `REMOTE_NODE + k`. Its frames never touch the radio; the numbers
/// only have to differ from every real shrine's and from the desk shrines' 163 and 164.
pub const REMOTE_NODE: u8 = 165;
/// Slot 0's index: its figurine is `[4, 0, 0, 0, 0, 0, 2]` and its copies are `copy_uid(2, k)`.
/// Slot `k` is `REMOTE_INDEX + k`, so no two slots, and no slot and desk shrine, share a UID.
pub const REMOTE_INDEX: usize = 2;
/// A table has two seats: one remote slot beside a shrine, or two remote slots and no shrine.
pub const MAX_SLOTS: usize = 2;

/// What the arena loop needs from a link that carries remote seats, by slot. The unslotted methods
/// are slot 0's, which is the only slot of a one-slot table.
pub trait RemoteSeat {
    /// How many remote slots this link carries (1 or 2).
    fn slots(&self) -> usize;
    /// Let each slot's shrine claim once its slot is joined (`joined[slot]`; a missing entry is
    /// not joined). Beside a shrine (one slot), only as the second claim, so it is seat 1 (spec §2);
    /// with two slots, the first to claim is seat 0.
    fn gate_slots(&mut self, joined: &[bool], seated: &[u8]);
    /// Slot `slot`'s legal moves now; empty off-turn or while a tap is pending.
    fn choices_at(&self, slot: usize) -> Vec<Choice>;
    /// Send a tap slot `slot`'s player chose. False when the shrine did not send it.
    fn propose_at(&mut self, slot: usize, now: u64, tap: Record) -> bool;
    /// Slot `slot`'s figurine: a guest commander (spec §6).
    fn figurine_at(&self, slot: usize) -> [u8; 7];
    /// The arena seat slot `slot`'s shrine holds in the running match; `None` before its claim
    /// lands and once it is back in the lobby.
    fn seat_at(&self, slot: usize) -> Option<u8>;
    /// The remote API's menu for slot `slot` (spec §2): what `choices_at` offers, labelled, with
    /// the tap behind each item at the same index.
    fn menu_at(&self, slot: usize) -> (Vec<MenuItem>, Vec<Record>);

    /// Slot 0 only: `gate_slots(&[joined], seated)`.
    fn gate(&mut self, joined: bool, seated: &[u8]) {
        self.gate_slots(&[joined], seated)
    }
    fn choices(&self) -> Vec<Choice> {
        self.choices_at(0)
    }
    fn propose(&mut self, now: u64, tap: Record) -> bool {
        self.propose_at(0, now, tap)
    }
    fn figurine(&self) -> [u8; 7] {
        self.figurine_at(0)
    }
    fn menu(&self) -> (Vec<MenuItem>, Vec<Record>) {
        self.menu_at(0)
    }
    fn seat(&self) -> Option<u8> {
        self.seat_at(0)
    }
}

pub struct RemoteLink<L: Link> {
    pub inner: L,
    /// Slot 0's shrine (the field a one-slot table has always had).
    pub shrine: DeskShrine,
    /// The shrines of slots 1 and up: empty on a one-slot table.
    pub more: Vec<DeskShrine>,
    may_claim: Vec<bool>,
    out: VecDeque<Rx>,
}

impl<L: Link> RemoteLink<L> {
    /// One slot: `inner` carries the table's other seat; the remote shrine holds `deck`'s list as
    /// virtual copies (draws are taps, 0036) and claims with `deck`'s castle.
    pub fn new(inner: L, seed: u64, deck: &Deck) -> RemoteLink<L> {
        RemoteLink::with_slots(inner, seed, std::slice::from_ref(deck))
    }

    /// A slot per deck, in order (1 or 2). With two, `inner` should carry no seat of its own (a
    /// desk link with both shrines off).
    pub fn with_slots(inner: L, seed: u64, decks: &[Deck]) -> RemoteLink<L> {
        assert!(
            (1..=MAX_SLOTS).contains(&decks.len()),
            "a table has 1 or 2 remote slots, got {}",
            decks.len()
        );
        let mut shrines = decks.iter().enumerate().map(|(k, deck)| {
            let mut s = DeskShrine::with(
                seed,
                REMOTE_INDEX + k,
                REMOTE_NODE + k as u8,
                deck.castle,
                &deck.cards,
            );
            s.rematch = true; // every match gets fresh join codes (spec §2)
            s
        });
        let shrine = shrines.next().expect("at least one slot");
        RemoteLink {
            inner,
            shrine,
            more: shrines.collect(),
            may_claim: vec![false; decks.len()],
            out: VecDeque::new(),
        }
    }

    /// The slots for a table behind a gateway, whose registry is strict: every slot stamps its
    /// casts and charges with a copy's UID (`DeskShrine::stamp_uids`), and `registry` learns every
    /// slot's virtual copies, refusing any UID that names a real one. Gateway mode's one
    /// constructor (`main.rs`), so a test of it tests what the binary runs.
    pub fn at_gateway(
        inner: L,
        seed: u64,
        decks: &[Deck],
        registry: &mut Registry,
    ) -> Result<RemoteLink<L>, String> {
        let mut r = RemoteLink::with_slots(inner, seed, decks);
        for k in 0..r.remote_slots() {
            r.shrine_at_mut(k).stamp_uids = true;
        }
        for (uid, design) in r.virtual_uids() {
            registry.add_virtual(uid, design)?;
        }
        Ok(r)
    }

    /// How many remote slots (1 or 2).
    pub fn remote_slots(&self) -> usize {
        1 + self.more.len()
    }

    pub fn shrine_at(&self, slot: usize) -> &DeskShrine {
        if slot == 0 {
            &self.shrine
        } else {
            &self.more[slot - 1]
        }
    }

    pub fn shrine_at_mut(&mut self, slot: usize) -> &mut DeskShrine {
        if slot == 0 {
            &mut self.shrine
        } else {
            &mut self.more[slot - 1]
        }
    }

    fn slot_of_node(&self, node: u8) -> Option<usize> {
        (0..self.remote_slots()).find(|&k| self.shrine_at(k).node == node)
    }

    /// Every UID a remote shrine can tap, with its design: each slot's figurine (its castle) and
    /// one copy per list entry. A strict registry learns these (`Registry::add_virtual`).
    pub fn virtual_uids(&self) -> Vec<([u8; 7], u16)> {
        let mut v = Vec::new();
        for k in 0..self.remote_slots() {
            let s = self.shrine_at(k);
            v.push((s.figurine(), s.castle));
            v.extend(
                s.deck
                    .iter()
                    .enumerate()
                    .map(|(c, &d)| (copy_uid(s.index, c), d)),
            );
        }
        v
    }
}

impl<L: Link> Link for RemoteLink<L> {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        let decoded = Frame::decode(frame);
        for k in 0..self.remote_slots() {
            let node = self.shrine_at(k).node;
            if (dst == BROADCAST || dst == node)
                && let Some((h, f)) = &decoded
            {
                let replies = self.shrine_at_mut(k).rx(h, f);
                self.out.extend(arena_bound(node, replies));
            }
        }
        if self.slot_of_node(dst).is_none() {
            self.inner.send(dst, frame);
        }
    }

    fn poll(&mut self, now: u64) -> Vec<Rx> {
        let mut rx = self.inner.poll(now);
        for k in 0..self.remote_slots() {
            let may_claim = self.may_claim[k];
            let s = self.shrine_at_mut(k);
            let node = s.node;
            let frames = s.act(now, may_claim, true);
            self.out.extend(arena_bound(node, frames));
        }
        rx.extend(self.out.drain(..));
        rx
    }

    fn remote(&mut self) -> Option<&mut dyn RemoteSeat> {
        Some(self)
    }
}

impl<L: Link> RemoteSeat for RemoteLink<L> {
    fn slots(&self) -> usize {
        self.remote_slots()
    }

    fn gate_slots(&mut self, joined: &[bool], seated: &[u8]) {
        let n = self.remote_slots();
        // The seats not held by a remote slot must be taken first: one beside a single slot (the
        // bot or a real shrine), none with two slots.
        let others = seated
            .iter()
            .filter(|&&node| self.slot_of_node(node).is_none())
            .count();
        let open = seated.len() < 2 && others >= 2 - n;
        for k in 0..n {
            let mine = seated.contains(&self.shrine_at(k).node);
            self.may_claim[k] = joined.get(k).copied().unwrap_or(false) && open && !mine;
        }
    }

    fn choices_at(&self, slot: usize) -> Vec<Choice> {
        self.shrine_at(slot).choices()
    }

    fn propose_at(&mut self, slot: usize, now: u64, tap: Record) -> bool {
        let s = self.shrine_at_mut(slot);
        let node = s.node;
        let frames = s.propose(now, tap);
        let sent = !frames.is_empty();
        self.out.extend(arena_bound(node, frames));
        sent
    }

    fn figurine_at(&self, slot: usize) -> [u8; 7] {
        self.shrine_at(slot).figurine()
    }

    fn seat_at(&self, slot: usize) -> Option<u8> {
        let s = self.shrine_at(slot);
        let back_in_lobby = s.lobby_after.is_some() && s.lobby_after == s.follower.begun();
        if back_in_lobby {
            return None;
        }
        s.seat().map(|x| x as u8)
    }

    fn menu_at(&self, slot: usize) -> (Vec<MenuItem>, Vec<Record>) {
        let s = self.shrine_at(slot);
        let g = &s.follower.game;
        let choices = s.choices();
        let items = choices
            .iter()
            .map(|c| MenuItem {
                key: c.key.clone(),
                label: c.label.clone(),
                kind: format!("{:?}", c.tap.kind),
                useful: c.is_useful(g),
            })
            .collect();
        (items, choices.iter().map(|c| c.tap).collect())
    }
}

/// A result's credit mask (`Ledger::apply_result_credit`): each seat's figurine earns unless it is
/// a remote slot's guest (spec §6).
pub fn credit(figurines: [[u8; 7]; 2], guests: &[[u8; 7]]) -> [bool; 2] {
    figurines.map(|f| !guests.contains(&f))
}

/// Which figurines are guests: one (`[u8; 7]`, the one-slot table) or a set, one per slot.
pub trait Guests {
    fn is_guest(&self, figurine: &[u8; 7]) -> bool;
}

impl Guests for [u8; 7] {
    fn is_guest(&self, figurine: &[u8; 7]) -> bool {
        self == figurine
    }
}

impl Guests for Vec<[u8; 7]> {
    fn is_guest(&self, figurine: &[u8; 7]) -> bool {
        self.contains(figurine)
    }
}

/// The ledger as the core sees it, with guests (spec §6): each remote slot's figurine plays as
/// 0030's fresh commander (level 1, nothing worn) and is never written. Every other figurine goes
/// to `inner`. `guest` is one figurine, or a set of them with two slots.
pub struct GuestStats<S, G = [u8; 7]> {
    pub inner: S,
    pub guest: G,
}

impl<S: StatsSource, G: Guests> StatsSource for GuestStats<S, G> {
    fn commander(&mut self, figurine: [u8; 7], castle: u16) -> Result<(u8, Loadout), u8> {
        if self.guest.is_guest(&figurine) {
            return Ok((level_for_xp(0), [None; 3]));
        }
        self.inner.commander(figurine, castle)
    }

    fn doll(&mut self, figurine: [u8; 7], seat: u8) -> Option<Doll> {
        if self.guest.is_guest(&figurine) {
            return None; // no station to show it on
        }
        self.inner.doll(figurine, seat)
    }

    fn equip(&mut self, figurine: [u8; 7], e: &Equip, registry: &Registry) -> Result<Doll, u8> {
        if self.guest.is_guest(&figurine) {
            return Err(arena_refusal::BAD_LOADOUT);
        }
        self.inner.equip(figurine, e, registry)
    }
}

/// One remote menu item, as `/remote/choices` shows it (tapstone-web's shape).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MenuItem {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub useful: bool,
}
