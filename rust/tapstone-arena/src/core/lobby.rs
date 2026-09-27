//! Lobby (arena spec §5.1): the arena beacons `L` with the ARENA bit, shrines claim with a
//! castle-figurine tap, seats go in claim order, and the arena writes the commander's stats.
use std::collections::BTreeMap;

use tapstone_progression::{Loadout, derive_commander, flat_loadout};
use tapstone_proto::frame::{
    BROADCAST, Begin, Frame, Lobby as LobbyFrame, Tap, arena_refusal, lobby_flags, refusal_code,
};
use tapstone_proto::ids::rules_id;
use tapstone_rules::{Applied, Chain, Commander, Game, Kind, Record};

use super::{ArenaCore, JournalOp, Match, Output, Table};

pub const BEACON_MS: u64 = 2000;

#[derive(Debug, Clone)]
pub struct Claim {
    pub node: u8,
    pub lseq: u16,
    pub figurine: [u8; 7],
    pub castle: u16,
    pub level: u8,
    pub loadout: Loadout,
    pub deck: Vec<u16>,
    pub sigil: u32,
}

#[derive(Default)]
pub struct Lobby {
    pub claims: Vec<Claim>,
    /// The last `L` each node sent: its deck sigil and hashes.
    pub seen: BTreeMap<u8, LobbyFrame>, // ordered: determinism by structure, not by never iterating
    /// The finished board, kept up until the next match starts (the canvas shows the result).
    pub last_over: Option<Box<crate::view::ViewModel>>,
}

impl ArenaCore {
    pub(crate) fn lobby_tick(&mut self, now: u64, out: &mut Vec<Output>) {
        if self.last_beacon.is_some_and(|t| now - t < BEACON_MS) {
            return;
        }
        self.last_beacon = Some(now);
        let l = LobbyFrame {
            seat_pref: 0xFF,
            deck_sigil: 0,
            ruleset: self.cfg.ruleset,
            registry: self.cfg.registry_id,
            rules: rules_id(&self.cfg.rules),
            flags: lobby_flags::ARENA,
        };
        self.send(out, tapstone_proto::frame::BROADCAST, 0, &Frame::Lobby(l));
    }

    fn reject(&self, out: &mut Vec<Output>, node: u8, lseq: u16, reason: u8) {
        self.send(out, node, 0, &Frame::Tap(Tap::Reject { lseq, reason }));
    }

    pub(crate) fn lobby_frame(&mut self, src: u8, f: Frame, now: u64, out: &mut Vec<Output>) {
        let Table::Lobby(lobby) = &mut self.table else {
            return;
        };
        match f {
            Frame::Lobby(l) => {
                lobby.seen.insert(src, l);
            }
            Frame::Tap(Tap::Propose { lseq, record }) if record.kind == Kind::ClaimSeat => {
                self.claim(src, lseq, record, now, out);
            }
            Frame::Tap(Tap::Propose { lseq, .. }) => {
                self.reject(out, src, lseq, arena_refusal::NOT_SEATED)
            }
            Frame::Equip(e) => {
                let Table::Lobby(lobby) = &self.table else {
                    return;
                };
                let Some(c) = lobby.claims.iter().find(|c| c.node == src).cloned() else {
                    return;
                };
                let seat = lobby.claims.iter().position(|x| x.node == src).unwrap_or(0) as u8;
                match self.stats.equip(c.figurine, &e, &self.registry) {
                    Ok(mut doll) => {
                        doll.seat = seat; // the ledger does not know seats; the lobby does
                        self.send(out, src, 0, &Frame::Doll(doll));
                    }
                    Err(code) => self.reject(out, src, 0, code),
                }
            }
            _ => {}
        }
    }

    fn claim(&mut self, src: u8, lseq: u16, r: Record, now: u64, out: &mut Vec<Output>) {
        let Table::Lobby(lobby) = &self.table else {
            return;
        };
        if lobby.claims.iter().any(|c| c.node == src) {
            return; // a retransmit of a claim already taken
        }
        if lobby.claims.len() == 2 {
            return self.reject(out, src, lseq, arena_refusal::TABLE_FULL);
        }
        let Some(sigil) = lobby.seen.get(&src).map(|l| l.deck_sigil) else {
            return self.reject(out, src, lseq, arena_refusal::UNKNOWN_DECK);
        };
        let Some(deck) = self.decks.by_sigil(sigil).map(|d| d.cards.clone()) else {
            return self.reject(out, src, lseq, arena_refusal::UNKNOWN_DECK);
        };
        let Some(castle) = self.registry.resolve_or(r.uid, r.card) else {
            return self.reject(out, src, lseq, arena_refusal::UNKNOWN_UID);
        };
        let (level, loadout) = match self.stats.commander(r.uid, castle) {
            Ok(x) => x,
            Err(code) => return self.reject(out, src, lseq, code),
        };
        let seat = lobby.claims.len() as u8;
        let claim = Claim {
            node: src,
            lseq,
            figurine: r.uid,
            castle,
            level,
            loadout,
            deck,
            sigil,
        };
        if let Some(doll) = self.stats.doll(r.uid, seat) {
            self.send(out, src, 0, &Frame::Doll(doll));
        }
        let Table::Lobby(lobby) = &mut self.table else {
            return;
        };
        lobby.claims.push(claim);
        if lobby.claims.len() == 2 {
            self.start(now, out);
        }
    }

    /// Both seats claimed: build the game, derive both commanders (flat mode applied), and commit
    /// the two ClaimSeat records. The second one starts the chain (0022 genesis).
    fn start(&mut self, now: u64, out: &mut Vec<Output>) {
        let Table::Lobby(lobby) = take_lobby(&mut self.table) else {
            return;
        };
        let c = &lobby.claims;
        let level = if self.cfg.flat {
            c[0].level.min(c[1].level)
        } else {
            0
        };
        let mut commanders = [Commander::LEVEL_1; 2];
        for s in 0..2 {
            let (lv, kit) = if self.cfg.flat {
                (level, flat_loadout(level, &c[s].loadout))
            } else {
                (c[s].level, c[s].loadout)
            };
            commanders[s] = match derive_commander(lv, &kit) {
                Ok(k) => k,
                Err(_) => {
                    self.reject(out, c[s].node, c[s].lseq, arena_refusal::BAD_LOADOUT);
                    return; // table back to an empty lobby; both shrines re-claim
                }
            };
        }
        let start_unix = self.cfg.epoch_unix + (now / 1000) as u32;
        let mut match_id = (u32::from(self.cfg.node) << 24) ^ start_unix;
        // Two matches started in the same second got the same id: a match voided at once, then
        // re-claimed, reused it, so the last match's frames (a halted shrine's X) judged the new
        // one. Found by the first two-match desk run. Every guard a follower keeps (`left`, its
        // RESULT, `OtherMatch`) compares ids, so consecutive matches must differ.
        if self.last_match == Some(match_id) {
            match_id = match_id.wrapping_add(1);
        }
        self.last_match = Some(match_id);
        let decks = [c[0].deck.clone(), c[1].deck.clone()];
        let game = Game::new(
            self.cfg.rules,
            [c[0].castle, c[1].castle],
            [&decks[0], &decks[1]],
        );
        // The two ClaimSeat records, built before anything is sent: genesis is taken over the game
        // they start, so it can go out in B ahead of them (#67).
        let claims: Vec<(u8, u16, Record)> = c
            .iter()
            .enumerate()
            .map(|(seat, x)| {
                let k = commanders[seat];
                let rec = Record {
                    seq: 0,
                    seat: seat as u8,
                    kind: Kind::ClaimSeat,
                    card: x.castle,
                    lane: k.keyword.map_or(-1, |kw| kw.code() as i8),
                    target: k.attack,
                    aux: k.toughness,
                    time_ms: 0,
                    uid: x.figurine,
                    auth: 0,
                };
                (x.node, x.lseq, rec)
            })
            .collect();
        let genesis = genesis_after(game, claims.iter().map(|(_, _, r)| r));
        let nodes = [c[0].node, c[1].node];
        let begin = Begin::new(&self.cfg.rules, nodes, genesis, [&decks[0], &decks[1]]);
        out.push(Output::Journal(JournalOp::Begin {
            match_id,
            rules: self.cfg.rules.bytes(),
            nodes,
            figurines: [c[0].figurine, c[1].figurine],
            decks: decks.clone(),
            start_unix,
        }));
        let m = Match {
            id: match_id,
            game,
            chain: None,
            log: Vec::new(),
            nodes,
            figurines: [c[0].figurine, c[1].figurine],
            decks,
            begin,
            sigils: [c[0].sigil, c[1].sigil],
            started_ms: now,
            start_unix,
            acked: [None; 2],
            last_heard: [now; 2],
            last_tx: [now; 2],
            tries: [0; 2],
            last_lseq: [None; 2],
            last_broadcast: now,
            paused: false,
            dark: None,
            handover_ms: None,
            drawn: Default::default(),
            in_hand: Default::default(),
        };
        self.table = Table::Match(Box::new(m));
        // B before the claims: a shrine that hears it first applies them as they arrive.
        self.send(out, BROADCAST, match_id, &Frame::Begin(begin));
        for (node, lseq, rec) in claims {
            if let Err(e) = self.commit(rec, lseq, now, out) {
                self.reject(out, node, lseq, refusal_code(&e));
            }
        }
    }
}

/// The genesis hash `records` reach from `game`, on a copy; all zero if they never start the chain
/// (the real commit then refuses the same record).
pub(crate) fn genesis_after<'a>(
    mut game: Game,
    records: impl Iterator<Item = &'a Record>,
) -> [u8; 8] {
    for r in records {
        match game.apply(r) {
            Ok(Applied::Started) => return Chain::genesis(&game).head(),
            Ok(_) => {}
            Err(_) => break,
        }
    }
    [0; 8]
}

/// Swap the lobby out of the table, leaving an empty one behind.
fn take_lobby(t: &mut Table) -> Table {
    std::mem::replace(t, Table::Lobby(Lobby::default()))
}
