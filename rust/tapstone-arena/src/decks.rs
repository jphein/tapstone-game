//! Deck records (`decks/*.toml`) found by the sigil a shrine beacons in `L`.
use tapstone_proto::ids::deck_sigil;
use tapstone_rules::HouseRules;
use tapstone_sim::deck::{Deck, load_all};

pub struct DeckBook {
    decks: Vec<Deck>,
}

impl DeckBook {
    pub fn new(decks: Vec<Deck>) -> DeckBook {
        DeckBook { decks }
    }

    /// Every deck under the repo's `decks/` (tapstone-sim's loader and validation).
    pub fn load_repo() -> Result<DeckBook, String> {
        let (decks, errors) = load_all(&HouseRules::default());
        if let Some(e) = errors.first() {
            return Err(e.to_string());
        }
        Ok(DeckBook { decks })
    }

    /// Add a deck: the remote seat's, in desk mode, beside the two desk decks (0038).
    pub fn push(&mut self, deck: Deck) {
        self.decks.push(deck);
    }

    pub fn by_sigil(&self, sigil: u32) -> Option<&Deck> {
        self.decks.iter().find(|d| deck_sigil(&d.cards) == sigil)
    }

    pub fn iter(&self) -> impl Iterator<Item = &Deck> {
        self.decks.iter()
    }

    pub fn len(&self) -> usize {
        self.decks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.decks.is_empty()
    }
}
