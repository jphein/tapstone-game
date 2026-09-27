//! The canvas's view model (spec §9). Built from the arena's own `Game`; serialised as JSON and
//! pushed over SSE. State that only the view needs (arrival flashes, "returns in N") is computed
//! in the page by diffing consecutive models (0027 amendment), never added here.
use serde::Serialize;
use tapstone_rules::cards::design;
use tapstone_rules::state::{CELLS, COMMANDER_DESIGN, LANES};
use tapstone_rules::{Game, Phase, Winner};

use crate::core::Match;
use crate::core::lobby::Lobby;

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct ViewModel {
    /// "lobby" | "playing" | "paused" | "resuming" | "over"
    pub phase: String,
    pub match_id: Option<String>,
    pub round: u8,
    pub active: u8,
    pub seq: u16,
    pub seats: Vec<SeatView>,
    pub lobby: Vec<LobbySeat>,
    pub last: Option<LastEvent>,
    pub winner: Option<u8>,
    pub head: Option<String>,
    pub last_over: Option<Box<ViewModel>>,
    /// The remote seat's join code while joining is open (0038). The arena binary fills it in;
    /// the core never does. Absent when `None`, so a table without a remote seat serialises as
    /// it always has (`the_canvas_fixture_is_current`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_code: Option<String>,
    /// Every still-open remote slot's join code, in slot order (two slots: JP against a second player).
    /// Absent when empty, for the same reason. `remote_code` stays for clients that read one code
    /// (the Roblox place, Part B): it is the first of these.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub remote_codes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SeatView {
    pub castle: String,
    pub faction: String,
    pub life: u8,
    pub charged: u8,
    pub spent: u8,
    pub hand: u8,
    pub deck_left: u8,
    /// 0036: draws this seat owes before anything else ("drawing 3 of 6", spec §5.3).
    pub owed_draws: u8,
    /// `cells[lane][cell]`, cell 0 = back (next to this seat's castle), 2 = front.
    pub cells: Vec<Vec<Option<UnitView>>>,
    /// 0 = on the board, else the round it returns in (0029).
    pub commander_returns: u8,
    pub commander_lane: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UnitView {
    pub name: String,
    pub faction: String,
    pub attack: u8,
    pub toughness: u8,
    pub damage: u8,
    pub keyword: Option<String>,
    pub entered_round: u8,
    pub commander: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LobbySeat {
    pub node: u8,
    pub level: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LastEvent {
    pub seq: u16,
    pub seat: u8,
    pub kind: String,
    pub card: Option<String>,
    pub applied: String,
}

/// The record kinds whose `card` field names a card: a draw, a charge, a cast, and the castle a
/// seat is claimed with.
fn carries_card(k: tapstone_rules::Kind) -> bool {
    use tapstone_rules::Kind;
    matches!(
        k,
        Kind::Draw | Kind::Charge | Kind::CastUnit | Kind::CastSpell | Kind::ClaimSeat
    )
}

fn faction_name(f: tapstone_rules::Faction) -> String {
    format!("{f:?}").to_lowercase()
}

fn seat_view(g: &Game, s: usize) -> SeatView {
    let seat = &g.seats[s];
    let castle = design(seat.castle_design);
    SeatView {
        castle: castle.map_or("?".into(), |d| d.name.to_string()),
        faction: castle.map_or("neutral".into(), |d| faction_name(d.faction)),
        life: seat.castle.life,
        charged: seat.charged,
        spent: seat.spent,
        hand: seat.hand_len,
        deck_left: seat.deck_len, // 0036: the list holds only undrawn copies
        owed_draws: seat.owed_draws(),
        cells: (0..LANES)
            .map(|l| {
                (0..CELLS)
                    .map(|c| {
                        seat.cells[l][c].map(|u| {
                            let commander = u.design == COMMANDER_DESIGN;
                            let d = design(u.design);
                            UnitView {
                                name: if commander {
                                    "Commander".into()
                                } else {
                                    d.map_or("?".into(), |d| d.name.to_string())
                                },
                                faction: if commander {
                                    faction_name(
                                        castle.map_or(tapstone_rules::Faction::Neutral, |c| {
                                            c.faction
                                        }),
                                    )
                                } else {
                                    d.map_or("neutral".into(), |d| faction_name(d.faction))
                                },
                                attack: u.attack,
                                toughness: u.toughness,
                                damage: u.damage,
                                keyword: u.keyword.map(|k| format!("{k:?}")),
                                entered_round: u.entered_round,
                                commander,
                            }
                        })
                    })
                    .collect()
            })
            .collect(),
        commander_returns: seat.commander.returns,
        commander_lane: seat.commander.lane,
    }
}

impl ViewModel {
    pub(crate) fn of_match(m: &Match, _last: Option<usize>) -> ViewModel {
        let g = &m.game;
        let phase = if m.dark.is_some() {
            "resuming"
        } else if g.phase == Phase::Over {
            "over"
        } else if m.paused {
            "paused"
        } else {
            "playing"
        };
        ViewModel {
            phase: phase.into(),
            match_id: Some(format!("{:08x}", m.id)),
            round: g.round,
            active: g.active,
            seq: g.seq,
            seats: (0..2).map(|s| seat_view(g, s)).collect(),
            lobby: Vec::new(),
            last: m.log.last().map(|c| LastEvent {
                seq: c.record.seq,
                seat: c.record.seat,
                kind: format!("{:?}", c.record.kind),
                // Only the kinds that carry a card name one. A Pass, an Advance or a Mulligan has
                // card 0, and design 0 is a real card (the Ember Castle).
                card: carries_card(c.record.kind)
                    .then(|| design(c.record.card))
                    .flatten()
                    .map(|d| d.name.to_string()),
                applied: format!("{:?}", c.applied),
            }),
            winner: match g.winner {
                Some(Winner::Seat(s)) => Some(s),
                _ => None,
            },
            head: m
                .chain
                .map(|c| c.head().iter().map(|b| format!("{b:02x}")).collect()),
            last_over: None,
            remote_code: None,
            remote_codes: Vec::new(),
        }
    }

    pub(crate) fn of_lobby(l: &Lobby) -> ViewModel {
        ViewModel {
            phase: "lobby".into(),
            lobby: l
                .claims
                .iter()
                .map(|c| LobbySeat {
                    node: c.node,
                    level: c.level,
                })
                .collect(),
            last_over: l.last_over.clone(),
            ..ViewModel::default()
        }
    }
}
