//! Decks as data — `decks/<slug>.toml`, the format `docs/design/card-data-format.md` specifies.
//!
//! Until now the two decks were a Rust constant, so the deck a person plays in the simulator could
//! not be the deck they build out of printed cards, and a physical playtest had no way to write
//! down what either player was holding. A deck is a list of DESIGNS; which physical copy you tap
//! does not matter, so nothing here touches UIDs or the copy registry (decision 0003, scry's
//! territory).
//!
//! Validation follows `tools/compile_cards.py`'s standard deliberately — closed vocabularies,
//! unknown keys rejected, file stem tied to the contents, `path: message` on stderr and a non-zero
//! exit. A second tool in the same repo that validated differently would teach two habits.
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tapstone_rules::cards::design;
use tapstone_rules::{CardKind, HouseRules};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deck {
    pub name: String,
    pub owner: String,
    /// Design index of the castle, resolved from its `stN-NNN` id.
    pub castle: u16,
    /// Design indices, in list order. The sim shuffles; the order here is the player's list.
    pub cards: Vec<u16>,
    /// realm-sigil name, filled by tooling that does not exist yet. Accepted empty; not invented.
    pub sigil: String,
}

#[derive(Debug)]
pub struct DeckError {
    pub path: PathBuf,
    pub message: String,
}

impl fmt::Display for DeckError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.path.display(), self.message)
    }
}

impl std::error::Error for DeckError {}

/// `deny_unknown_fields` is the whole point of naming the struct: a typo'd key is a silent
/// half-loaded deck otherwise, which is exactly what the generator refuses for card files.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeckFile {
    name: String,
    owner: String,
    castle: String,
    cards: Vec<String>,
    #[serde(default)]
    sigil: String,
}

/// `"Hearth March"` → `"hearth-march"`. The file stem must equal this, so a deck cannot be found
/// under one name and claim another.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

/// `st1-042` → 42. Same shape the card generator writes, so the two cannot disagree about ids.
fn design_index(id: &str) -> Option<u16> {
    let (prefix, num) = id.split_once('-')?;
    if prefix.len() < 3
        || !prefix.starts_with("st")
        || !prefix[2..].chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    if num.len() != 3 || !num.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    num.parse().ok()
}

/// The directory decks live in, beside `game/cards/`, resolved from the crate rather than the
/// working directory — `compile_cards.py`'s own lesson about paths.
pub fn decks_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../decks")
}

/// Copies of one design a deck may hold (#147, card-data-format.md).
pub const COPY_LIMIT: u32 = 3;

pub fn load(path: &Path, rules: &HouseRules) -> Result<Deck, DeckError> {
    let err = |m: String| DeckError {
        path: path.to_path_buf(),
        message: m,
    };
    let text = std::fs::read_to_string(path).map_err(|e| err(e.to_string()))?;
    let f: DeckFile = toml::from_str(&text).map_err(|e| err(e.message().to_string()))?;

    if f.name.trim().is_empty() {
        return Err(err("`name` must not be empty".into()));
    }
    if f.owner.trim().is_empty() {
        return Err(err("`owner` must not be empty".into()));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if stem != slug(&f.name) {
        return Err(err(format!(
            "file stem {stem:?} does not match the slug of `name` ({:?})",
            slug(&f.name)
        )));
    }

    let castle = design_index(&f.castle)
        .ok_or_else(|| err(format!("`castle` {:?} is not a stN-NNN id", f.castle)))?;
    match design(castle).map(|d| d.kind) {
        Some(CardKind::Castle) => {}
        Some(_) => {
            return Err(err(format!(
                "`castle` {:?} is {}, which is not a castle",
                f.castle,
                design(castle).map_or("?", |d| d.name)
            )));
        }
        None => {
            return Err(err(format!(
                "`castle` {:?} is not in the compiled set",
                f.castle
            )));
        }
    }

    let mut cards = Vec::with_capacity(f.cards.len());
    for id in &f.cards {
        let idx =
            design_index(id).ok_or_else(|| err(format!("card {id:?} is not a stN-NNN id")))?;
        match design(idx).map(|d| d.kind) {
            // A castle claims a seat; it is not shuffled into the deck it defends.
            Some(CardKind::Castle) => {
                return Err(err(format!(
                    "card {id:?} is a castle and cannot be a deck card"
                )));
            }
            Some(_) => cards.push(idx),
            None => return Err(err(format!("card {id:?} is not in the compiled set"))),
        }
    }
    if cards.len() != usize::from(rules.deck_size) {
        return Err(err(format!(
            "{} cards; the house rules ask for {}",
            cards.len(),
            rules.deck_size
        )));
    }

    // #147 (2026-09-27): at most COPY_LIMIT copies of one design. It is tooling, not engine: the
    // rules crate plays whatever list it is handed, and the limit is a deck-building rule.
    let mut seen: BTreeMap<u16, u32> = BTreeMap::new();
    for (id, &idx) in f.cards.iter().zip(&cards) {
        let n = seen.entry(idx).or_insert(0);
        *n += 1;
        if *n > COPY_LIMIT {
            return Err(err(format!(
                "{n} copies of {id}; a deck holds at most {COPY_LIMIT} of one design"
            )));
        }
    }
    Ok(Deck {
        name: f.name,
        owner: f.owner,
        castle,
        cards,
        sigil: f.sigil,
    })
}

pub fn load_named(name: &str, rules: &HouseRules) -> Result<Deck, DeckError> {
    load(&decks_dir().join(format!("{name}.toml")), rules)
}

/// Every deck file, sorted, for a `decks check` sweep.
pub fn load_all(rules: &HouseRules) -> (Vec<Deck>, Vec<DeckError>) {
    let (mut ok, mut bad) = (Vec::new(), Vec::new());
    let mut paths: Vec<PathBuf> = std::fs::read_dir(decks_dir())
        .map(|d| {
            d.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "toml"))
                .collect()
        })
        .unwrap_or_default();
    paths.sort();
    for p in paths {
        match load(&p, rules) {
            Ok(d) => ok.push(d),
            Err(e) => bad.push(e),
        }
    }
    (ok, bad)
}

impl Deck {
    /// design index → copies; the loader refuses any above `COPY_LIMIT`.
    pub fn copies(&self) -> BTreeMap<u16, u32> {
        let mut m = BTreeMap::new();
        for &c in &self.cards {
            *m.entry(c).or_insert(0) += 1;
        }
        m
    }

    pub fn most_copies(&self) -> u32 {
        self.copies().values().copied().max().unwrap_or(0)
    }
}
