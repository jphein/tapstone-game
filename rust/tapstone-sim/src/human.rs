//! A human-playable seat: one seat driven from the terminal, the other by a picker, on the real
//! engine and the real arbiter — so a human game produces the same transcript and the same hash
//! chain a shrine would, and can be replayed and compared with the same tooling.
//!
//! Every balance number this project has produced carries the same caveat: the seats are weighted
//! heuristics that never bluff, never hold a card for a purpose and never race. Two pickers have
//! already flipped the answer twice. This is the cheapest way to get a data point that does not
//! carry that caveat at all.
use std::io::{self, BufRead, Write};

use tapstone_rules::cards::design;
use tapstone_rules::state::{CELLS, LANES, Seat};
use tapstone_rules::{
    Applied, CardKind, Commander, Effect, Game, HouseRules, Keyword, Kind, Phase, Record,
};

use crate::arbiter::Arbiter;
use crate::transcript::Transcript;
use crate::{ScriptedSeat, Style, claim, shuffle_for, tap};

/// The enemy castle as a spell target, as the engine encodes it.
const CASTLE_TARGET: u8 = 0xFF;

/// One legal action, with the consequence the engine itself reported when it was tried.
pub struct Choice {
    /// **Stable.**
    /// Derived from the action, never from its position, so "advance lane 0" is
    /// `a/0` whatever else is legal. Indices moved every turn — Pass was #10, then #9, then #15
    /// on consecutive turns — and someone who learns a number mis-keys, after which the
    /// transcript records the slip as a considered decision.
    pub key: String,
    pub label: String,
    pub tap: Record,
    /// What the engine said this does. Checks read THIS, never the label: keying an analysis to a
    /// human-facing string means rewording the UI silently changes what is measured.
    pub applied: Applied,
}

impl Choice {
    /// Useless rather than illegal: the engine accepts it and it changes nothing worth having.
    ///
    /// **This is the only place usefulness is decided.** It used to be decided twice — enumeration
    /// dropped pointless spell targets, this marked pointless advances — kept in step by hand, and
    /// the two promptly disagreed about own-side damage. The menu now offers everything the engine
    /// accepts and this decides what gets a dot; the detectors read this too, so a move cannot be
    /// useful to the menu and a declined resource to the analysis.
    ///
    /// Note what is NOT here: damage or destroy aimed at your own unit. `cast_unit` refuses with
    /// `CellOccupied`, so killing your own spent 1/2 to free an entry cell is a real tactic, and
    /// Tide holds both Riptide and Tidal Lash to do it with.
    pub fn is_useful(&self, g: &Game) -> bool {
        if matches!(self.applied, Applied::Advanced { moved: 0, .. }) {
            return false;
        }
        if self.tap.kind == Kind::CastSpell
            && self.tap.target != CASTLE_TARGET
            && matches!(
                design(self.tap.card).map(|d| d.kind),
                Some(CardKind::Spell(Effect::Heal { .. }))
            )
        {
            let (s, l, c) = (
                ((self.tap.target >> 4) & 1) as usize,
                ((self.tap.target >> 2) & 3) as usize,
                (self.tap.target & 3) as usize,
            );
            // Healing the other side repairs a unit that is trying to kill you; healing an
            // undamaged one does nothing at all. Offered, because the engine allows both, but
            // never counted as a resource a passing player declined.
            if s != (self.tap.seat & 1) as usize {
                return false;
            }
            if g.seats[s].cells[l][c].is_none_or(|u| u.damage == 0) {
                return false;
            }
        }
        true
    }
}

fn card_name(id: u16) -> &'static str {
    design(id).map_or("?", |d| d.name)
}

fn hand_cards(s: &Seat) -> Vec<u16> {
    let mut v: Vec<u16> = s.hand[..s.hand_len()].to_vec();
    v.sort_unstable();
    v.dedup();
    v
}

fn target_byte(seat: usize, lane: usize, cell: usize) -> u8 {
    ((seat as u8) << 4) | ((lane as u8) << 2) | cell as u8
}

/// **The engine decides what is legal, not this file.**
///
/// Every candidate is trial-applied to a COPY of the game (`Game` is `Copy`) and kept only if the
/// engine accepts it. Re-deriving legality here would be a second implementation of the rules,
/// free to disagree with the first — and the menu could then offer a move the arbiter refuses.
/// It also means each label can quote what the engine said would actually happen.
pub fn legal_choices(g: &Game, seat: u8) -> Vec<Choice> {
    let (me_i, opp_i) = ((seat & 1) as usize, 1 - (seat & 1) as usize);
    let me = &g.seats[me_i];
    let mut cands: Vec<Record> = Vec::new();

    cands.push(tap(seat, Kind::Mulligan, 0, -1, 0, 0));
    // 0036: a draw names the design tapped, so offer one per distinct undrawn design. The engine
    // accepts them only while a draw is owed, and then accepts nothing else.
    let mut undrawn: Vec<u16> = me.deck[..me.deck_len as usize].to_vec();
    undrawn.sort_unstable();
    undrawn.dedup();
    for d in undrawn {
        cands.push(tap(seat, Kind::Draw, d, -1, 0, 0));
    }
    for card in hand_cards(me) {
        cands.push(tap(seat, Kind::Charge, card, -1, 0, 0));
        for lane in 0..LANES as i8 {
            cands.push(tap(seat, Kind::CastUnit, card, lane, 0, 0));
        }
        // >>> OFFER TARGETS THAT MAKE SENSE, NOT EVERY TARGET THE ENGINE TOLERATES. <<<
        // Enumerating both boards listed "burn your own unit" ABOVE "burn theirs" for every
        // spell, offered heal on undamaged units, and repeated a draw spell once per occupied
        // cell as indistinguishable lines. The engine still validates everything below; this
        // only decides what is worth putting in front of a person.
        // >>> OFFER WHAT THE ENGINE ACCEPTS. <<<
        // Dropping own-side damage and destroy made the menu a strict subset of the rules: the
        // engine allows them, the menu did not list them, and input is matched against the menu,
        // so a legal tactic became unreachable. That matters most in exactly this tool — a tactic
        // the menu cannot express is a tactic the transcript can never record, and the whole point
        // is to see what a person does that a picker cannot. `is_useful()` marks the pointless
        // ones instead; the only thing still collapsed is a draw spell, whose target byte never
        // reaches its effect, so listing it once per occupied cell was repetition, not choice.
        let both_sides = || -> Vec<(usize, usize, usize)> {
            [me_i, opp_i]
                .into_iter()
                .flat_map(|si| (0..LANES).flat_map(move |l| (0..CELLS).map(move |c| (si, l, c))))
                .filter(|&(si, l, c)| g.seats[si].cells[l][c].is_some())
                .collect()
        };
        match design(card).map(|d| d.kind) {
            Some(CardKind::Spell(Effect::Damage { castle_ok, .. })) => {
                if castle_ok {
                    cands.push(tap(seat, Kind::CastSpell, card, -1, CASTLE_TARGET, 0));
                }
                for (si, l, c) in both_sides() {
                    cands.push(tap(
                        seat,
                        Kind::CastSpell,
                        card,
                        -1,
                        target_byte(si, l, c),
                        0,
                    ));
                }
            }
            Some(CardKind::Spell(Effect::Destroy { .. }))
            | Some(CardKind::Spell(Effect::Heal { .. })) => {
                for (si, l, c) in both_sides() {
                    cands.push(tap(
                        seat,
                        Kind::CastSpell,
                        card,
                        -1,
                        target_byte(si, l, c),
                        0,
                    ));
                }
            }
            Some(CardKind::Spell(Effect::Shift)) => {
                for (si, l, c) in both_sides() {
                    for aux in [0u8, 1] {
                        cands.push(tap(
                            seat,
                            Kind::CastSpell,
                            card,
                            -1,
                            target_byte(si, l, c),
                            aux,
                        ));
                    }
                }
            }
            // The target byte never reaches the effect, so one entry rather than one per cell.
            Some(CardKind::Spell(_)) => cands.push(tap(seat, Kind::CastSpell, card, -1, 0, 0)),
            _ => {}
        }
    }
    for lane in 0..LANES as i8 {
        cands.push(tap(seat, Kind::Advance, 0, lane, 0, 0));
    }
    cands.push(tap(seat, Kind::Pass, 0, -1, 0, 0));

    let mut out = Vec::new();
    for r in cands {
        let mut probe = *g;
        if let Ok(applied) = probe.apply(&r) {
            out.push(Choice {
                key: key_for(&r),
                label: describe(&r, applied, g),
                tap: r,
                applied,
            });
        }
    }
    out
}

/// A key that names the ACTION, so it never moves with the list.
fn key_for(r: &Record) -> String {
    match r.kind {
        Kind::Mulligan => "m".into(),
        Kind::Draw => format!("d/{}", r.card),
        Kind::Charge => format!("c/{}", r.card),
        Kind::CastUnit => format!("u/{}/{}", r.card, r.lane),
        Kind::CastSpell => {
            let dir = match design(r.card).map(|d| d.kind) {
                Some(CardKind::Spell(Effect::Shift)) => {
                    if r.aux == 0 {
                        "<"
                    } else {
                        ">"
                    }
                }
                _ => "",
            };
            if r.target == CASTLE_TARGET {
                format!("s/{}/k", r.card)
            } else {
                format!(
                    "s/{}/{}{}{}",
                    r.card,
                    (r.target >> 2) & 3,
                    r.target & 3,
                    dir
                )
            }
        }
        Kind::Advance => format!("a/{}", r.lane),
        _ => "p".into(),
    }
}

fn describe(r: &Record, applied: Applied, g: &Game) -> String {
    let name = card_name(r.card);
    match r.kind {
        Kind::Mulligan => match applied {
            Applied::Mulliganed { returned } => {
                format!("Mulligan — shuffle your hand back and draw {returned} (0036)")
            }
            _ => "Mulligan".into(),
        },
        Kind::Draw => format!("Draw {name}"),
        Kind::Charge => format!("Charge {name} — spend the card for +1 permanent mana"),
        Kind::CastUnit => match applied {
            Applied::Summoned { lane, cell } => {
                let where_ = ["back", "mid", "front"][cell as usize];
                format!("Cast {name} into lane {lane} ({where_} cell)")
            }
            _ => format!("Cast {name} into lane {}", r.lane),
        },
        Kind::CastSpell => {
            let at = if r.target == 0xFF {
                "the enemy castle".to_string()
            } else {
                let (s, lane, cell) = ((r.target >> 4) & 1, (r.target >> 2) & 3, r.target & 3);
                let who = if s == 0 { "seat 0" } else { "seat 1" };
                // >>> THE SEAT IN THE TARGET BYTE, NOT "THE OPPONENT". <<< This read the
                // opposing board whichever seat the byte named, so a seat-0 menu could label a
                // target with a Tide unit's name that seat 0 cannot own — and anyone choosing a
                // target BY NAME was choosing blind.
                let unit = g.seats[s as usize].cells[lane as usize][cell as usize]
                    .map(|u| card_name(u.design))
                    .unwrap_or("that cell");
                format!(
                    "{who} lane {lane} {} ({unit})",
                    ["back", "mid", "front"][cell as usize]
                )
            };
            let dir = match design(r.card).map(|d| d.kind) {
                Some(CardKind::Spell(Effect::Shift)) => {
                    if r.aux == 0 {
                        " toward lane 0"
                    } else {
                        " toward lane 2"
                    }
                }
                _ => "",
            };
            format!("Cast {name} at {at}{dir}")
        }
        Kind::Advance => match applied {
            // A zero-move advance is legal and strictly harmful: it consumes the lane's once-per-
            // turn advance and moves nothing. It stays on the menu because the engine accepts it
            // and this file does not get to invent rules — but it says so plainly, because an
            // option that can only cost you something should not look like the others.
            Applied::Advanced { lane, moved: 0 } => {
                format!("Advance lane {lane} — nothing can move (wastes this lane's advance)")
            }
            Applied::Advanced { lane, moved } => {
                format!("Advance lane {lane} — {moved} unit(s) move forward")
            }
            _ => format!("Advance lane {}", r.lane),
        },
        Kind::Pass => "Pass — end your turn (combat resolves for both sides)".into(),
        _ => format!("{:?}", r.kind),
    }
}

fn cell_text(c: &Option<tapstone_rules::state::Unit>) -> String {
    match c {
        None => " ".repeat(16),
        Some(u) => {
            let kw = match u.keyword {
                Some(Keyword::Ranged) => "R",
                Some(Keyword::Shield1) => "S",
                Some(Keyword::Haste) => "H",
                Some(Keyword::Rush) => "U",
                Some(Keyword::Taunt) => "T",
                None => " ",
            };
            let n: String = card_name(u.design).chars().take(9).collect();
            format!(
                "{n:<9} {}/{}{kw}",
                u.attack,
                u.toughness.saturating_sub(u.damage)
            )
        }
    }
}

fn seat_line(s: &Seat, idx: usize, show_hand: bool) -> String {
    let hand = if show_hand {
        let names: Vec<&str> = s.hand[..s.hand_len()]
            .iter()
            .map(|&c| card_name(c))
            .collect();
        format!("hand: {}", names.join(", "))
    } else {
        format!("hand {} cards", s.hand_len())
    };
    format!(
        "seat {idx}  castle {:<3} mana {}/{}  deck {}  {hand}",
        s.castle.life,
        s.available_mana(),
        s.charged,
        s.deck_len, // 0036: the list holds only the undrawn copies
    )
}

/// The board as the engine holds it. Front cells face each other across the middle rule.
pub fn render(g: &Game, human: u8) -> String {
    let mut out = String::new();
    let turn = if g.active == human {
        "YOUR TURN"
    } else {
        "opponent"
    };
    out.push_str(&format!(
        "\n  round {}  ·  seat {} to act ({turn})  ·  you are seat {human}\n\n",
        g.round, g.active
    ));
    let rows = |seat: usize, order: [usize; 3]| -> String {
        let mut s = String::new();
        for cell in order {
            let label = ["back ", "mid  ", "front"][cell];
            let cells: Vec<String> = (0..LANES)
                .map(|l| cell_text(&g.seats[seat].cells[l][cell]))
                .collect();
            s.push_str(&format!("    {label} [{}]\n", cells.join("][")));
        }
        s
    };
    out.push_str(&format!("  {}\n", seat_line(&g.seats[1], 1, human == 1)));
    out.push_str(&rows(1, [0, 1, 2]));
    out.push_str(&format!("    {}\n", "─".repeat(52)));
    out.push_str(&rows(0, [2, 1, 0]));
    out.push_str(&format!("  {}\n", seat_line(&g.seats[0], 0, human == 0)));
    out.push_str("\n             lane 0            lane 1            lane 2\n");
    out
}

/// Play one game with `human` at the terminal. Returns the transcript, which is the point: a
/// human game is an artefact that replays and hashes like any other, not an anecdote.
pub fn play_human(
    seed: u64,
    max_taps: usize,
    human: u8,
    style: Style,
    // Per seat: the castle design and the player's deck list BEFORE shuffling, so a deck read
    // from `decks/*.toml` and the compiled-in default reach the engine by the same path.
    lists: [(u16, Vec<u16>); 2],
    rules: HouseRules,
) -> io::Result<Transcript> {
    let castles = [lists[0].0, lists[1].0];
    let deck_lists = [
        shuffle_for(seed, 0, lists[0].1.clone()),
        shuffle_for(seed, 1, lists[1].1.clone()),
    ];
    let game = Game::new(rules, castles, [&deck_lists[0], &deck_lists[1]]);
    let mut arbiter = Arbiter::new(game);
    let mut bot = ScriptedSeat::with_style(seed, 1 - (human & 1), style);
    let mut paper = crate::physical::PhysicalDecks::new(seed, deck_lists.clone());

    arbiter
        .commit(claim(1, castles[1], Commander::LEVEL_1))
        .expect("seat 1 claim");
    arbiter
        .commit(claim(0, castles[0], Commander::LEVEL_1))
        .expect("seat 0 claim");

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut attempts = 0;

    while arbiter.game.phase == Phase::Playing && attempts < max_taps {
        attempts += 1;
        // 0036: draws are taps. The terminal harness taps them for both seats from the paper
        // deck and says what the human drew; a table game taps each one on the stone.
        let before = arbiter.records.len();
        paper.pay(&mut arbiter);
        for c in &arbiter.records[before..] {
            if c.record.seat == human {
                let name = tapstone_rules::cards::design(c.record.card).map_or("?", |d| d.name);
                println!("  you draw {name}");
            }
        }
        if arbiter.game.phase != Phase::Playing {
            break;
        }
        if arbiter.game.active != human {
            let r = bot.next_tap(&arbiter.game);
            match arbiter.commit(r) {
                Ok(a) => println!("  opponent: {}", describe(&r, a, &arbiter.game)),
                Err(_) => continue, // the picker proposed something illegal; it will try again
            }
            continue;
        }

        print!("{}", render(&arbiter.game, human));
        let choices = legal_choices(&arbiter.game, human);
        // Fixed sections in a fixed order, each entry under its own stable key. Nothing moves
        // when the board changes, so a key learned on turn 2 still means the same thing on turn 9.
        for (title, want) in [
            ("draw", Kind::Draw),
            ("mulligan", Kind::Mulligan),
            ("charge", Kind::Charge),
            ("deploy", Kind::CastUnit),
            ("cast", Kind::CastSpell),
            ("advance", Kind::Advance),
            ("end turn", Kind::Pass),
        ] {
            let section: Vec<&Choice> = choices.iter().filter(|c| c.tap.kind == want).collect();
            if section.is_empty() {
                continue;
            }
            println!("   {title}:");
            for c in section {
                let mark = if c.is_useful(&arbiter.game) {
                    " "
                } else {
                    "·"
                };
                println!("     {mark} {:<10} {}", c.key, c.label);
            }
        }
        print!("\n  choose (key, p to pass, q to resign): ");
        io::stdout().flush()?;
        let Some(line) = lines.next() else { break };
        let line = line?;
        let line = line.trim();
        if line.eq_ignore_ascii_case("q") {
            println!("  resigned.");
            break;
        }
        // `p` is Pass by name rather than by index, because the index moves with the board and a
        // muscle-memory number is how you throw a game away by accident.
        // Keys only. A number would be muscle memory pointing at whatever happens to be there.
        let chosen = if line.eq_ignore_ascii_case("p") {
            choices.iter().find(|c| c.tap.kind == Kind::Pass)
        } else {
            choices.iter().find(|c| c.key.eq_ignore_ascii_case(line))
        };
        match chosen {
            Some(c) => {
                // It was legal when offered; the engine is still the authority on the commit.
                match arbiter.commit(c.tap) {
                    Ok(a) => println!("  you: {}", describe(&c.tap, a, &arbiter.game)),
                    Err(e) => {
                        println!("  refused: {e:?} — the board moved under that choice, pick again")
                    }
                }
            }
            None => println!("  no such key — nothing was sent to the arbiter"),
        }
    }

    let g = &arbiter.game;
    println!("{}", render(g, human));
    match g.winner {
        Some(w) => println!("  result: {w:?}   (round {})", g.round),
        None => println!("  unfinished after {attempts} taps"),
    }
    Ok(Transcript::from_arbiter(seed, &arbiter, deck_lists))
}
