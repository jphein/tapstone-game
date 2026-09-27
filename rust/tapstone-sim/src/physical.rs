//! The paper deck at a simulated seat (0036): shuffled once, drawn from the top, one `Draw` tap
//! per card. The engine holds only the LIST; the order lives here, as it lives in a player's hand
//! at the table.
//!
//! The initial order is the shuffle the sim always used (`shuffle_for`), and a draw takes the top
//! card. So until a mulligan, every game draws exactly the cards it drew when the engine held the
//! order. A mulligan returns the hand to the list and the player shuffles it back into the paper
//! deck, which this module does with its own seeded stream, so the scripted seats' decision stream
//! is untouched.
use rand::SeedableRng;
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use tapstone_rules::state::SEATS;
use tapstone_rules::{Game, Kind, Phase, Record};

use crate::arbiter::Arbiter;
use crate::tap;

pub struct PhysicalDecks {
    /// `decks[s][0]` is the top card of seat `s`'s paper deck.
    decks: [Vec<u16>; SEATS],
    rng: StdRng,
}

/// Count of `design` in a slice.
fn count(xs: &[u16], design: u16) -> usize {
    xs.iter().filter(|&&c| c == design).count()
}

impl PhysicalDecks {
    /// `decks` in paper order, top first: the same order `Game::new` was given.
    pub fn new(seed: u64, decks: [Vec<u16>; SEATS]) -> PhysicalDecks {
        PhysicalDecks {
            decks,
            rng: StdRng::seed_from_u64(seed ^ 0x0D5A_CEED_0036),
        }
    }

    /// Make the paper deck hold exactly the engine's undrawn list. Cards the engine returned (a
    /// mulligan) are shuffled into the paper deck. A card the engine no longer lists, which no rule
    /// produces today, is removed so the two can never disagree about what can be drawn.
    fn reconcile(&mut self, g: &Game, seat: usize) {
        let s = &g.seats[seat];
        let list = &s.deck[..s.deck_len as usize];
        let paper = &mut self.decks[seat];
        // Keep each paper card while the list still has a copy of it for that card…
        let mut kept: Vec<u16> = Vec::with_capacity(paper.len());
        for &c in paper.iter() {
            if count(&kept, c) < count(list, c) {
                kept.push(c);
            }
        }
        // …and collect every listed copy the paper does not hold: the returned hand.
        let mut returned: Vec<u16> = Vec::new();
        for &d in list {
            if count(&kept, d) + count(&returned, d) < count(list, d) {
                returned.push(d);
            }
        }
        *paper = kept;
        if !returned.is_empty() {
            paper.extend(returned);
            paper.shuffle(&mut self.rng);
        }
    }

    /// Seat `seat`'s paper deck, top first.
    pub fn paper(&self, seat: u8) -> &[u16] {
        &self.decks[seat as usize]
    }

    /// The `Draw` tap `seat` makes next, if it owes one: the top card of its paper deck.
    pub fn next_draw(&mut self, g: &Game, seat: u8) -> Option<Record> {
        let s = seat as usize;
        if g.phase != Phase::Playing || g.seats[s].owed_draws() == 0 {
            return None;
        }
        self.reconcile(g, s);
        let top = *self.decks[s].first()?;
        Some(tap(seat, Kind::Draw, top, -1, 0, 0))
    }

    /// Pay every draw both seats owe, through the arbiter, so each is a committed record. Seat 1's
    /// opening draws are paid during seat 0's turn, as at the table.
    pub fn pay(&mut self, a: &mut Arbiter) {
        for seat in 0..SEATS as u8 {
            while let Some(r) = self.next_draw(&a.game, seat) {
                if a.commit(r).is_err() {
                    break; // cannot happen after reconcile; never loop on it
                }
                self.decks[seat as usize].remove(0);
            }
        }
    }
}
