use tapstone_arena::decks::DeckBook;
use tapstone_arena::registry::Registry;
use tapstone_proto::ids::deck_sigil;

#[test]
fn the_registry_maps_colon_uids_to_design_indices_and_skips_foreign_rows() {
    let jsonl = concat!(
        r#"{"uid":"04:89:4F:72:D5:2A:81","design":"st1-003","batch":"b","tag":"NTAG215"}"#,
        "\n",
        r#"{"uid":"04:77:C8:BD:CC:2A:81","design":"demo-hullbreaker-horror","batch":"b","tag":"NTAG215"}"#,
        "\n",
    );
    // A numbered id from another game: only the `st` prefix check can refuse it, since its number
    // parses (the demo row above is refused by the number alone, so it cannot see the prefix check).
    let jsonl = format!(
        "{jsonl}{}\n",
        r#"{"uid":"04:11:22:33:44:55:66","design":"mt1-004","batch":"b","tag":"NTAG215"}"#
    );
    let r = Registry::from_jsonl(&jsonl).unwrap();
    assert_eq!(
        r.resolve([0x04, 0x89, 0x4F, 0x72, 0xD5, 0x2A, 0x81]),
        Some(3)
    );
    assert_eq!(
        r.resolve([0x04, 0x77, 0xC8, 0xBD, 0xCC, 0x2A, 0x81]),
        None,
        "not a Tapstone design"
    );
    assert_eq!(
        r.resolve([0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
        None,
        "another game's numbered id"
    );
    assert_eq!(r.len(), 1);
}

#[test]
fn a_trusting_registry_believes_the_card_field() {
    let r = Registry::Trusting;
    assert_eq!(r.resolve_or([9; 7], 5), Some(5));
    let strict = Registry::from_jsonl("").unwrap();
    assert_eq!(strict.resolve_or([9; 7], 5), None);
}

#[test]
fn the_repo_decks_load_and_are_found_by_sigil() {
    let book = DeckBook::load_repo().unwrap();
    assert!(book.len() >= 2);
    for d in book.iter() {
        assert_eq!(
            book.by_sigil(deck_sigil(&d.cards)).map(|x| &x.name),
            Some(&d.name)
        );
    }
}
