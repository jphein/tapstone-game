//! The desk table in the browser (spec 2026-09-25 §2): a person in one seat, the bot in the other,
//! the arena's own core arbitrating. The page renders the view JSON the arena's SSE carries, so
//! app.js's code path is unchanged; the page proposes, the core decides (0037).
use serde::Serialize;
use tapstone_arena::link::desk::DeskTable;
use tapstone_rules::Record;
use tapstone_rules::cards::{CardKind, design};

pub mod ffi;

/// `human` value for a table with nobody seated (both shrines scripted, as `record_desk_match`).
pub const NOBODY: u32 = 255;

pub struct Web {
    table: DeskTable,
    human: Option<usize>,
    /// The taps behind the menu last returned by `choices`, which `propose` indexes into.
    menu: Vec<Record>,
}

/// One menu item. `card`, `lane`, `target` and `aux` are the tap's own fields, so the headset can
/// match a gesture to exactly one item: the key names a spell's target by lane and cell only
/// (`s/<card>/<lane><cell>`), which is the same for my unit and theirs in the same cell.
#[derive(Serialize)]
struct MenuItem<'a> {
    key: &'a str,
    label: &'a str,
    kind: String,
    useful: bool,
    card: u16,
    lane: i8,
    target: u8,
    aux: u8,
}

/// One card in the person's hand, with everything a card face shows.
#[derive(Serialize)]
struct HandCard {
    card: u16,
    name: &'static str,
    faction: String,
    cost: u8,
    /// "unit" | "spell" | "castle"
    kind: &'static str,
    attack: Option<u8>,
    toughness: Option<u8>,
    keyword: Option<String>,
    effect: Option<String>,
}

impl Web {
    /// `human` is the desk shrine (0 or 1) a person drives; `NOBODY` for none.
    pub fn new(seed: u64, human: u32) -> Web {
        let mut table = DeskTable::new(seed);
        let human = (human < 2).then_some(human as usize);
        if let Some(h) = human {
            table.link.manual[h] = true;
        }
        Web {
            table,
            human,
            menu: Vec::new(),
        }
    }

    /// One 10 ms step at `now`: the views, one JSON line each, joined by newlines ("" for none).
    pub fn step(&mut self, now: u64) -> String {
        self.table.step(now).join("\n")
    }

    pub fn done(&self) -> bool {
        self.table.done()
    }

    /// The person's legal moves now, as a JSON array of {key, label, kind, useful, card, lane,
    /// target, aux}: "[]" when it is not their move. `propose(i)` takes an index into the array
    /// last returned.
    pub fn choices(&mut self) -> String {
        self.menu.clear();
        let Some(h) = self.human else {
            return "[]".into();
        };
        let list = self.table.choices(h);
        let g = &self.table.link.shrines[h].follower.game;
        let items: Vec<MenuItem> = list
            .iter()
            .map(|c| MenuItem {
                key: &c.key,
                label: &c.label,
                kind: format!("{:?}", c.tap.kind),
                useful: c.is_useful(g),
                card: c.tap.card,
                lane: c.tap.lane,
                target: c.tap.target,
                aux: c.tap.aux,
            })
            .collect();
        let json = serde_json::to_string(&items).unwrap_or_else(|_| "[]".into());
        self.menu = list.iter().map(|c| c.tap).collect();
        json
    }

    /// The person's hand, as a JSON array of cards (draw order): "[]" with nobody seated. Private
    /// to this page, which holds the person's own shrine; the view model carries only a count.
    pub fn hand(&self) -> String {
        let Some(h) = self.human else {
            return "[]".into();
        };
        let cards: Vec<HandCard> = self.table.link.shrines[h]
            .hand
            .iter()
            .filter_map(|&id| design(id))
            .map(|d| {
                let (kind, attack, toughness, keyword, effect) = match d.kind {
                    CardKind::Unit {
                        attack,
                        toughness,
                        keyword,
                    } => (
                        "unit",
                        Some(attack),
                        Some(toughness),
                        keyword.map(|k| format!("{k:?}")),
                        None,
                    ),
                    CardKind::Spell(e) => ("spell", None, None, None, Some(format!("{e:?}"))),
                    CardKind::Castle => ("castle", None, None, None, None),
                };
                HandCard {
                    card: d.id,
                    name: d.name,
                    faction: format!("{:?}", d.faction).to_lowercase(),
                    cost: d.cost,
                    kind,
                    attack,
                    toughness,
                    keyword,
                    effect,
                }
            })
            .collect();
        serde_json::to_string(&cards).unwrap_or_else(|_| "[]".into())
    }

    /// The seat the person's shrine holds, once its claim has landed.
    pub fn seat(&self) -> Option<usize> {
        self.human.and_then(|h| self.table.link.shrines[h].seat())
    }

    /// Send menu item `i` from the last `choices`. False for a stale or out-of-range index. The
    /// menu is spent either way, so a second pinch can't resend it.
    pub fn propose(&mut self, i: u32, now: u64) -> bool {
        let tap = self.menu.get(i as usize).copied();
        self.menu.clear();
        match (self.human, tap) {
            (Some(h), Some(tap)) => self.table.propose(h, now, tap),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tapstone_arena::link::desk::record_desk_match;

    #[test]
    fn nobody_seated_is_record_desk_match() {
        let mut web = Web::new(11, NOBODY);
        let mut lines = Vec::new();
        for step in 0..20_000u64 {
            let s = web.step(step * 10);
            if !s.is_empty() {
                lines.push(s);
            }
            if web.done() {
                break;
            }
        }
        assert_eq!(lines.join("\n"), record_desk_match(11).join("\n"));
    }

    /// The hand the page shows must be the engine's hand: at every step of a whole match (a person
    /// in seat 0 choosing as the web gate does), its length equals the view's own hand count, and
    /// every menu item names a card the hand holds, or none (draws, passes, advances, mulligans).
    #[test]
    fn the_hand_follows_the_engine_through_a_whole_match() {
        let mut web = Web::new(11, 0);
        let (mut checked, mut done) = (0, false);
        for step in 0..60_000u64 {
            let now = step * 10;
            let lines = web.step(now);
            if let (Some(line), Some(seat)) = (lines.lines().last(), web.seat()) {
                let v: serde_json::Value = serde_json::from_str(line).unwrap();
                if let Some(count) = v["seats"][seat]["hand"].as_u64() {
                    let hand: Vec<serde_json::Value> = serde_json::from_str(&web.hand()).unwrap();
                    assert_eq!(
                        hand.len() as u64,
                        count,
                        "step {step}: the page's hand vs the engine's count"
                    );
                    checked += 1;
                }
            }
            if web.done() {
                done = true;
                break;
            }
            let menu: Vec<serde_json::Value> = serde_json::from_str(&web.choices()).unwrap();
            let hand: Vec<serde_json::Value> = serde_json::from_str(&web.hand()).unwrap();
            let held: Vec<u64> = hand.iter().map(|c| c["card"].as_u64().unwrap()).collect();
            for m in &menu {
                let kind = m["kind"].as_str().unwrap();
                if matches!(kind, "CastUnit" | "CastSpell" | "Charge") {
                    assert!(
                        held.contains(&m["card"].as_u64().unwrap()),
                        "step {step}: {kind} of a card not in the hand: {m}"
                    );
                }
            }
            if let Some(i) = menu
                .iter()
                .position(|m| m["useful"] == true && m["kind"] != "Mulligan")
            {
                web.propose(i as u32, now);
            }
        }
        assert!(done, "the match finished");
        // Seed 11 with a person in seat 0 gives 46 views once the seat is known (measured).
        assert!(
            checked > 30,
            "the hand was checked on real views ({checked})"
        );
    }

    #[test]
    fn menu_items_carry_the_tap_fields() {
        let mut web = Web::new(11, 0);
        for step in 0..40_000u64 {
            web.step(step * 10);
            let menu: Vec<serde_json::Value> = serde_json::from_str(&web.choices()).unwrap();
            if let Some(m) = menu.first() {
                for f in ["card", "lane", "target", "aux"] {
                    assert!(
                        m.get(f).is_some_and(|x| x.is_number()),
                        "{f} missing from {m}"
                    );
                }
                return;
            }
        }
        panic!("never offered a menu");
    }

    #[test]
    fn a_stale_menu_index_sends_nothing() {
        let mut web = Web::new(11, 0);
        for step in 0..40_000u64 {
            let now = step * 10;
            web.step(now);
            let menu: Vec<serde_json::Value> = serde_json::from_str(&web.choices()).unwrap();
            if !menu.is_empty() {
                assert!(
                    !web.propose(menu.len() as u32, now),
                    "an out-of-range index was sent"
                );
                web.choices();
                assert!(
                    web.propose(0, now),
                    "a fresh menu's first item was not sent"
                );
                assert!(!web.propose(0, now), "a spent menu was sent twice");
                return;
            }
        }
        panic!("never offered a menu");
    }
}
