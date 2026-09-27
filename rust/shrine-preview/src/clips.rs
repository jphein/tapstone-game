//! The voice-clip manifest (0033): every sentence the shrine can speak, as a finite list.
//!
//! 0033 pre-renders every predictable voice-band line with Piper and ships it in the SD data pack;
//! only the dynamic remainder is streamed. This module is the list those clips are rendered from.
//!
//! # One source
//!
//! Every clip's text is `Voice::text()` for one concrete `Voice` value — the same function the
//! band draws — so a clip and the line on the glass cannot disagree. Slots are expanded against
//! the real data, never typed lists:
//!
//! * card names from `tapstone_rules::cards::SET1`, filtered by kind (units ask for a lane, spells
//!   that target ask for a target, draw spells say how many);
//! * counts from the house rules (`castle_life`, `commander_return`, the opening hand via
//!   `draws::opening_hand`) and the card table (the highest cost bounds a refusal's numbers);
//! * item names from progression's generated item table (`game/items/set1/*.toml`, #65);
//! * the engine's own `Refusal` list (`voice::REFUSALS`).
//!
//! # Exhaustive by construction
//!
//! [`variant_name`] and [`key`] are exhaustive matches over `Voice`, so adding a variant does not
//! compile until it has a name and a key; the coverage test then fails until [`instances`] yields
//! at least one value of it.

use shrine_render::commander::{
    ITEMS, LEVEL_MAX, ReturnState, Slot, SlotExt, TRINKET_LEVEL, level_gain,
};
use shrine_render::draws::{DrawWhy, SECOND_TAP_MS, opening_hand};
use shrine_render::voice::{BATTERY_THRESHOLDS, COUNTDOWN_S, Dark, REFUSALS, Voice};
use tapstone_rules::HouseRules;
use tapstone_rules::cards::{CardKind, Effect, SET1};
use tapstone_rules::rules::Refusal;

/// How a line reaches the speaker.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Pre-rendered at build time and shipped in the data pack (0033).
    Clip,
    /// Contains words the shrine did not choose (STT output); streamed from the arena (0033).
    Streamed,
    /// Nothing is said.
    Silent,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Clip => "clip",
            Kind::Streamed => "streamed",
            Kind::Silent => "silent",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub key: String,
    pub kind: Kind,
    pub variant: &'static str,
    pub text: String,
    pub voice: Voice<'static>,
}

/// The variant's name. Exhaustive: a new `Voice` variant fails to compile here.
pub fn variant_name(v: &Voice<'_>) -> &'static str {
    match v {
        Voice::Invite => "invite",
        Voice::CastOrCharge { .. } => "cast_or_charge",
        Voice::Lane { .. } => "lane",
        Voice::Target { .. } => "target",
        Voice::Refused(_) => "refused",
        Voice::Return(_) => "return",
        Voice::Returned => "returned",
        Voice::CastleAt { .. } => "castle_at",
        Voice::Loadout { .. } => "loadout",
        Voice::Equipped { .. } => "equipped",
        Voice::SecondKeyword => "second_keyword",
        Voice::TooLow { .. } => "too_low",
        Voice::Loot { .. } => "loot",
        Voice::Melted { .. } => "melted",
        Voice::LevelUp { .. } => "level_up",
        Voice::Lobby => "lobby",
        Voice::Dark(_) => "dark",
        Voice::Listening => "listening",
        Voice::Heard { .. } => "heard",
        Voice::Silent => "silent",
        Voice::Draw { .. } => "draw",
        Voice::Drew { .. } => "drew",
        Voice::MulliganOffer => "mulligan_offer",
        Voice::DeckEmpty => "deck_empty",
        Voice::MulliganPrompt { .. } => "mulligan_prompt",
    }
}

/// How the line is delivered. Exhaustive, for the same reason.
pub fn kind(v: &Voice<'_>) -> Kind {
    match v {
        Voice::Heard { .. } => Kind::Streamed,
        Voice::Silent => Kind::Silent,
        Voice::Invite
        | Voice::CastOrCharge { .. }
        | Voice::Lane { .. }
        | Voice::Target { .. }
        | Voice::Refused(_)
        | Voice::Return(_)
        | Voice::Returned
        | Voice::CastleAt { .. }
        | Voice::Loadout { .. }
        | Voice::Equipped { .. }
        | Voice::SecondKeyword
        | Voice::TooLow { .. }
        | Voice::Loot { .. }
        | Voice::Melted { .. }
        | Voice::LevelUp { .. }
        | Voice::Lobby
        | Voice::Dark(_)
        | Voice::Listening
        | Voice::Draw { .. }
        | Voice::Drew { .. }
        | Voice::MulliganOffer
        | Voice::MulliganPrompt { .. }
        | Voice::DeckEmpty => Kind::Clip,
    }
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// A stable key per concrete line: the variant and its slot values. Exhaustive.
pub fn key(v: &Voice<'_>) -> String {
    let n = variant_name(v);
    match *v {
        Voice::CastOrCharge { card } | Voice::Lane { card, .. } | Voice::Target { card, .. } => {
            format!("{n}.{}", slug(card))
        }
        Voice::Refused(r) => format!("{n}.{}", slug(&format!("{r:?}"))),
        Voice::Return(r) => format!("{n}.{}", slug(&format!("{r:?}"))),
        Voice::CastleAt { castle, life } => format!("{n}.{}.{life}", slug(castle)),
        Voice::Equipped { item, slot } => format!("{n}.{}.{}", slug(item), slot.name()),
        Voice::Loot { item } | Voice::Melted { item } => format!("{n}.{}", slug(item)),
        Voice::LevelUp { level, .. } => format!("{n}.{level}"),
        Voice::TooLow { item, level } => format!("{n}.{}.{level}", slug(item)),
        Voice::Dark(d) => format!("{n}.{}", slug(&format!("{d:?}"))),
        Voice::Draw { n: count, why } => match why {
            DrawWhy::Spell { card } => format!("{n}.spell.{}.{count}", slug(card)),
            other => format!("{n}.{}.{count}", slug(&format!("{other:?}"))),
        },
        Voice::Drew { card, left } => format!("{n}.{}.{left}", slug(card)),
        Voice::Loadout { .. }
        | Voice::Invite
        | Voice::Returned
        | Voice::SecondKeyword
        | Voice::Lobby
        | Voice::Listening
        | Voice::Heard { .. }
        | Voice::Silent
        | Voice::MulliganOffer
        | Voice::MulliganPrompt { .. }
        | Voice::DeckEmpty => n.to_string(),
    }
}

/// The most draws a seat can owe at once under `rules`: the larger opening hand, a seat-1 mulligan
/// returning its opening hand plus the turn-start card (0036 as clarified), or a draw spell.
pub fn max_owed(rules: &HouseRules) -> u8 {
    let spell = SET1
        .iter()
        .filter_map(|d| match d.kind {
            CardKind::Spell(Effect::Draw { count }) => Some(count),
            _ => None,
        })
        .max()
        .unwrap_or(0);
    opening_hand(rules, 0)
        .max(opening_hand(rules, 1) + 1)
        .max(spell)
}

/// Every concrete line the shrine can say at the default table, in a stable order.
pub fn instances() -> Vec<Voice<'static>> {
    let rules = HouseRules::default();
    let deck: Vec<_> = SET1
        .iter()
        .filter(|d| !matches!(d.kind, CardKind::Castle))
        .collect();
    let units = deck
        .iter()
        .filter(|d| matches!(d.kind, CardKind::Unit { .. }));
    let targeted = deck.iter().filter(|d| {
        matches!(
            d.kind,
            CardKind::Spell(
                Effect::Damage { .. }
                    | Effect::Heal { .. }
                    | Effect::Destroy { .. }
                    | Effect::Shift
            )
        )
    });
    let castles = SET1.iter().filter(|d| matches!(d.kind, CardKind::Castle));
    let max_cost = deck.iter().map(|d| d.cost).max().unwrap_or(0);
    let owed_max = max_owed(&rules);

    let mut v = vec![Voice::Invite];
    v.extend(deck.iter().map(|d| Voice::CastOrCharge { card: d.name }));
    v.extend(units.map(|d| Voice::Lane {
        card: d.name,
        secs: COUNTDOWN_S,
    }));
    v.extend(targeted.map(|d| Voice::Target {
        card: d.name,
        secs: COUNTDOWN_S,
    }));
    for r in REFUSALS {
        match r {
            // Every (need, have) a real card can produce: need is a card's cost, have below it.
            Refusal::NoMana { .. } => {
                for need in 1..=max_cost {
                    for have in 0..need {
                        v.push(Voice::Refused(Refusal::NoMana { need, have }));
                    }
                }
            }
            other => v.push(Voice::Refused(other)),
        }
    }
    for n in 1..=rules.commander_return {
        v.push(Voice::Return(ReturnState::In(n)));
    }
    v.push(Voice::Return(ReturnState::ThisTurn));
    v.push(Voice::Return(ReturnState::Blocked));
    v.push(Voice::Returned);
    for c in castles {
        for life in 1..=rules.castle_life {
            v.push(Voice::CastleAt {
                castle: c.name,
                life,
            });
        }
    }
    v.push(Voice::Loadout { secs: COUNTDOWN_S });
    for it in ITEMS {
        v.push(Voice::Equipped {
            item: it.name,
            slot: it.slot,
        });
    }
    v.push(Voice::SecondKeyword);
    // Refused for level: only a trinket before its slot opens (min_level is loot-table only).
    for it in ITEMS.iter().filter(|it| it.slot == Slot::Trinket) {
        v.push(Voice::TooLow {
            item: it.name,
            level: TRINKET_LEVEL,
        });
    }
    v.extend(ITEMS.iter().map(|it| Voice::Loot { item: it.name }));
    v.extend(ITEMS.iter().map(|it| Voice::Melted { item: it.name }));
    for level in 2..=LEVEL_MAX {
        v.push(Voice::LevelUp {
            level,
            gain: level_gain(level).unwrap_or(""),
        });
    }
    v.push(Voice::Lobby);
    v.push(Voice::Dark(Dark::ArenaGone));
    v.push(Voice::Dark(Dark::Dormant));
    // The lead's ruling (2026-09-23): the battery is announced only at its thresholds.
    for pct in BATTERY_THRESHOLDS {
        v.push(Voice::Dark(Dark::BatteryLow { pct }));
    }
    v.push(Voice::Listening);
    v.push(Voice::Heard { words: "<words>" });
    v.push(Voice::Silent);
    for seat in 0..2 {
        v.push(Voice::Draw {
            n: opening_hand(&rules, seat),
            why: DrawWhy::Opening,
        });
    }
    // A mulligan owes the hand returned (0036 as clarified): seat 0's opening hand, seat 1's plus
    // its turn-start card.
    v.push(Voice::Draw {
        n: opening_hand(&rules, 0),
        why: DrawWhy::Mulligan,
    });
    v.push(Voice::Draw {
        n: opening_hand(&rules, 1) + 1,
        why: DrawWhy::Mulligan,
    });
    v.push(Voice::Draw {
        n: 1,
        why: DrawWhy::TurnStart,
    });
    for d in &deck {
        if let CardKind::Spell(Effect::Draw { count }) = d.kind {
            v.push(Voice::Draw {
                n: count,
                why: DrawWhy::Spell { card: d.name },
            });
        }
    }
    for d in &deck {
        for left in 0..owed_max {
            v.push(Voice::Drew { card: d.name, left });
        }
    }
    v.push(Voice::MulliganOffer);
    v.push(Voice::MulliganPrompt {
        secs: (SECOND_TAP_MS / 1000) as u8,
    });
    v.push(Voice::DeckEmpty);
    // The same sentence can arise from two slot values (the two mulligan counts are equal at a
    // table with no bonus): keep the first.
    let mut seen = std::collections::BTreeSet::new();
    v.retain(|x| seen.insert(key(x)));
    v
}

/// The manifest entries, in `instances` order.
pub fn entries() -> Vec<Entry> {
    instances()
        .into_iter()
        .map(|v| Entry {
            key: key(&v),
            kind: kind(&v),
            variant: variant_name(&v),
            text: v.text().to_string(),
            voice: v,
        })
        .collect()
}

/// Variant indices with no entry, for the coverage check.
pub fn missing(entries: &[Entry]) -> Vec<usize> {
    let mut seen = [false; shrine_render::voice::VOICE_VARIANTS];
    for e in entries {
        seen[e.voice.index()] = true;
    }
    (0..seen.len()).filter(|i| !seen[*i]).collect()
}

/// Labelled estimates for Piper time and SD size. **Estimates, not measurements**: the speaking
/// rate is an assumed ~14 characters a second (about 150 words a minute), and the byte rates are
/// 0033's codec figures at 22,050 Hz (4-bit ADPCM ~11 KB/s, 16-bit mono ~44 KB/s).
pub struct Estimate {
    pub clips: usize,
    pub chars: usize,
    pub seconds: f32,
    pub adpcm_bytes: f32,
    pub pcm16_bytes: f32,
}

pub const ASSUMED_CHARS_PER_S: f32 = 14.0;
pub const SAMPLE_RATE_HZ: f32 = 22_050.0;

pub fn estimate(entries: &[Entry]) -> Estimate {
    let clips: Vec<_> = entries.iter().filter(|e| e.kind == Kind::Clip).collect();
    let chars: usize = clips.iter().map(|e| e.text.len()).sum();
    let seconds = chars as f32 / ASSUMED_CHARS_PER_S;
    Estimate {
        clips: clips.len(),
        chars,
        seconds,
        adpcm_bytes: seconds * SAMPLE_RATE_HZ * 0.5,
        pcm16_bytes: seconds * SAMPLE_RATE_HZ * 2.0,
    }
}

/// Is the committed manifest the one the code generates? The staleness test and its control both
/// call this, so the control exercises the real check rather than a comparison of its own.
pub fn is_current(committed: &str, generated: &str) -> bool {
    committed == generated
}

/// The committed TSV: a commented header, then `key \t kind \t variant \t text`.
pub fn tsv(entries: &[Entry]) -> String {
    let e = estimate(entries);
    let mut s = String::new();
    s.push_str(
        "# Tapstone shrine voice clips (0033). Generated by `shrine-preview clips`; do not edit.\n",
    );
    s.push_str("# Source: shrine_render::voice::Voice::text(), expanded against set 1, the default house rules\n");
    s.push_str("# and progression's generated item table (game/items/set1).\n");
    s.push_str(&format!(
        "# {} clips, {} characters; ESTIMATE at {} chars/s: {:.0} s of speech, ~{:.1} MB ADPCM, ~{:.1} MB 16-bit.\n",
        e.clips,
        e.chars,
        ASSUMED_CHARS_PER_S,
        e.seconds,
        e.adpcm_bytes / 1e6,
        e.pcm16_bytes / 1e6
    ));
    s.push_str("key\tkind\tvariant\ttext\n");
    for x in entries {
        s.push_str(&format!(
            "{}\t{}\t{}\t{}\n",
            x.key,
            x.kind.as_str(),
            x.variant,
            x.text
        ));
    }
    s
}
