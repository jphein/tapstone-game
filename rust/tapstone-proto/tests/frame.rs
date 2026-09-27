use proptest::prelude::*;
use tapstone_proto::frame::*;
use tapstone_rules::{Kind, Record};

fn rec() -> Record {
    Record {
        seq: 7,
        seat: 1,
        kind: Kind::CastUnit,
        card: 3,
        lane: 2,
        target: 0,
        aux: 0,
        time_ms: 1234,
        uid: [4, 1, 3, 0, 0, 0, 9],
        auth: 0,
    }
}

fn all_frames() -> Vec<Frame> {
    let mut data = [0u8; SNAP_DATA_MAX];
    data[..5].copy_from_slice(b"hello");
    vec![
        Frame::Lobby(Lobby {
            seat_pref: 2,
            deck_sigil: 0xA1,
            ruleset: 0xB2,
            registry: 0xC3,
            rules: 0xD4,
            flags: lobby_flags::ARENA,
        }),
        Frame::Tap(Tap::Propose {
            lseq: 9,
            record: rec(),
        }),
        Frame::Tap(Tap::Reject { lseq: 9, reason: 3 }),
        Frame::Commit(Commit {
            mseq: 7,
            lseq: 9,
            record: rec(),
            hash: [1; 8],
        }),
        Frame::Ack(Ack {
            mseq: 7,
            hash: [2; 8],
        }),
        Frame::Nak(Nak {
            from: 3,
            to: 0xFFFF,
        }),
        Frame::Join(Join {
            role: join_role::ARENA,
            have_mseq: 12,
        }),
        Frame::Snap(Snap {
            at_mseq: 5,
            idx: 0,
            count: 1,
            total_len: 5,
            len: 5,
            data,
        }),
        Frame::SnapNak(SnapNak {
            at_mseq: 5,
            bitmap: 0b101,
        }),
        Frame::Halt(Halt {
            at_mseq: 8,
            reason: halt_reason::HASH,
            mine: [3; 8],
            theirs: [4; 8],
        }),
        Frame::Result(MatchResult::unsigned(
            40,
            1,
            result_reason::LETHAL,
            [5; 8],
            [6; 32],
        )),
        Frame::Doll(Doll {
            seat: 0,
            level: 3,
            xp: 12,
            xp_next: 15,
            slots: 2,
            loadout: [0, NONE16, NONE16],
            inv_len: 1,
            inv: [0; GRID_MAX],
            keyword: NONE8,
            name_seed: 0xDEAD,
        }),
        Frame::Equip(Equip {
            slot: 1,
            op: equip_op::LOOT,
            design: 2,
            uid: [0; 7],
        }),
        // Only the first `n` records travel; the fixture must be a frame the wire can carry.
        Frame::Handback(Handback {
            from_mseq: 10,
            idx: 0,
            count: 2,
            n: 1,
            last_lseq: [3, 0x0102],
            records: {
                let mut r = [[0; 32]; HANDBACK_RECORDS];
                r[0] = [7; 32];
                r
            },
        }),
        Frame::HandbackNak(HandbackNak {
            from_mseq: 10,
            bitmap: 0b10,
        }),
        Frame::Begin(Begin::new(
            &tapstone_rules::HouseRules::default(),
            [163, 164],
            [9; 8],
            [&[1, 2, 3], &[4, 5]],
        )),
    ]
}

/// `B` at its largest: both lists at `DECK_MAX`.
fn full_begin() -> Frame {
    let list = [0xABCDu16; tapstone_rules::state::DECK_MAX];
    Frame::Begin(Begin::new(
        &tapstone_rules::HouseRules::default(),
        [163, 164],
        [9; 8],
        [&list, &list],
    ))
}

/// #67: the largest `B` is one frame, and `BEGIN_MAX` is what the codec really encodes.
#[test]
fn a_full_begin_fits_one_frame_and_round_trips() {
    let f = full_begin();
    let mut buf = [0u8; FRAME_MAX];
    let n = f.encode(
        &Header {
            match_id: 1,
            src: 2,
        },
        &mut buf,
    );
    assert_eq!(n - HEADER_LEN, BEGIN_MAX);
    assert_eq!(BEGIN_MAX, 141, "9 + 2 + 8 + 2 × (1 + 2 × 30)");
    assert!(fits_payload(n - HEADER_LEN));
    assert_eq!(
        Frame::decode(&buf[..n]).map(|(_, g)| g),
        Some(f),
        "round trip"
    );
}

/// A list length past `DECK_MAX` is refused, not read past: the decoder must never build a list the
/// engine would clamp differently.
#[test]
fn a_begin_claiming_more_than_deck_max_does_not_decode() {
    let mut buf = [0u8; FRAME_MAX];
    let n = full_begin().encode(
        &Header {
            match_id: 1,
            src: 2,
        },
        &mut buf,
    );
    let len0 = HEADER_LEN + 9 + 2 + 8;
    assert_eq!(
        buf[len0] as usize,
        tapstone_rules::state::DECK_MAX,
        "the offset is the length byte"
    );
    buf[len0] += 1;
    assert!(Frame::decode(&buf[..n]).is_none());
}

#[test]
fn every_frame_round_trips() {
    let h = Header {
        match_id: 0xA300_1F2C,
        src: 163,
    };
    for f in all_frames() {
        let mut buf = [0u8; FRAME_MAX];
        let n = f.encode(&h, &mut buf);
        let (h2, f2) = Frame::decode(&buf[..n]).unwrap_or_else(|| panic!("{f:?} did not decode"));
        assert_eq!((h2, f2), (h, f.clone()));
    }
}

#[test]
fn payload_sizes_are_the_documented_ones_and_fit_the_budget() {
    // The draft's table (§2) plus Task 4's two changes. A size is a wire commitment.
    let want: &[(u8, usize)] = &[
        (b'L', 18),
        (b'T', 27),
        (b'C', 36),
        (b'A', 10),
        (b'N', 4),
        (b'J', 3),
        (b'Q', 10),
        (b'X', 19),
        (b'R', 45),
        (b'D', 43),
        (b'E', 11),
        (b'K', 10),
    ];
    let h = Header {
        match_id: 1,
        src: 2,
    };
    for f in all_frames() {
        let mut buf = [0u8; FRAME_MAX];
        let n = f.encode(&h, &mut buf);
        assert!(
            fits_payload(n - HEADER_LEN),
            "{} is over the 221 B budget",
            f.kind() as char
        );
        let checked = want
            .iter()
            .find(|(k, _)| *k == f.kind())
            .filter(|_| !matches!(f, Frame::Tap(Tap::Reject { .. })));
        if let Some(&(_, size)) = checked {
            assert_eq!(n - HEADER_LEN, size, "kind {}", f.kind() as char);
        }
    }
    assert_eq!(
        PAYLOAD_MAX,
        250 - 20 - 9,
        "derived from the MTU, header and MAC trailer"
    );
    // The control: a payload one byte past the budget must be refused by the same predicate, or the
    // check above could not fail at all (verification.md: prove the check can see its subject).
    assert!(fits_payload(PAYLOAD_MAX) && !fits_payload(PAYLOAD_MAX + 1));
}

#[test]
fn foreign_and_truncated_frames_do_not_decode() {
    assert!(Frame::decode(b"SMOLv1 HELLO 007").is_none());
    let h = Header {
        match_id: 1,
        src: 2,
    };
    let mut buf = [0u8; FRAME_MAX];
    let n = Frame::Ack(Ack {
        mseq: 1,
        hash: [0; 8],
    })
    .encode(&h, &mut buf);
    for cut in 0..n {
        assert!(
            Frame::decode(&buf[..cut]).is_none(),
            "decoded a {cut}-byte prefix"
        );
    }
    buf[14] = b'Z';
    assert!(Frame::decode(&buf[..n]).is_none(), "unknown kind");
}

proptest! {
    #[test]
    fn decode_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..300)) {
        let _ = Frame::decode(&bytes);
        let mut tagged = TAG.to_vec();
        tagged.extend_from_slice(&bytes);
        let _ = Frame::decode(&tagged);
    }
}

/// The largest `H` the follower sends: six records plus the per-seat `last_lseq` (ruled
/// 2026-09-23). 2 + 1 + 1 + 1 + 2 × 2 + 6 × 32 = 201 B, inside the 221 B budget.
#[test]
fn a_full_handback_chunk_fits_the_payload() {
    let hb = Frame::Handback(Handback {
        from_mseq: 1,
        idx: 0,
        count: 1,
        n: HANDBACK_RECORDS as u8,
        last_lseq: [u16::MAX; 2],
        records: [[0xAB; 32]; HANDBACK_RECORDS],
    });
    let mut buf = [0u8; FRAME_MAX];
    let n = hb.encode(
        &Header {
            match_id: 1,
            src: 2,
        },
        &mut buf,
    );
    assert_eq!(n - HEADER_LEN, 201);
    assert!(fits_payload(n - HEADER_LEN));
    assert_eq!(
        Frame::decode(&buf[..n]).map(|(_, f)| f),
        Some(hb),
        "round trip"
    );
}

/// The totals a size cell quotes, one per variant (variants are separated by " / "): the number
/// after the last "=" (a sum such as "5 + 4 + ≤6 × 32 = ≤201"), else the cell's leading number.
/// Incidental numbers inside a note ("`mseq` 2 · record 24") are never read.
fn cell_totals(cell: &str) -> Vec<usize> {
    cell.split(" / ")
        .filter_map(|part| {
            let tail = part.rsplit('=').next().unwrap_or(part);
            let digits: String = tail
                .trim_start_matches(|c: char| c.is_whitespace() || c == '≤')
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            digits.parse().ok()
        })
        .collect()
}

/// The protocol draft's §2 table quotes, for EVERY kind the codec implements, exactly the payload
/// sizes the codec encodes, and frame = payload + 20 and on-air = frame + 9 (verification.md: a
/// document quoting a number is checked against the code that has it). Every size is measured by
/// encoding. `P` (PAIR) is the arena-less fallback: tapstone-proto does not implement it, so it is
/// the one row not checked, and this test says so. Also §6's TSX1 header.
#[test]
fn the_protocol_draft_quotes_the_codecs_sizes() {
    let draft = include_str!("../../../docs/protocol/tapstone-protocol-draft.md");
    let h = Header {
        match_id: 1,
        src: 2,
    };
    let payload = |f: &Frame| {
        let mut buf = [0u8; FRAME_MAX];
        f.encode(&h, &mut buf) - HEADER_LEN
    };
    let mut sizes: std::collections::BTreeMap<u8, std::collections::BTreeSet<usize>> =
        Default::default();
    let mut add = |f: Frame| {
        sizes.entry(f.kind()).or_default().insert(payload(&f));
    };
    for f in all_frames()
        .into_iter()
        .filter(|f| !matches!(f.kind(), b'S' | b'H' | b'R' | b'B'))
    {
        add(f);
    }
    // The variable frames at their largest, and every RESULT signature kind.
    add(Frame::Snap(Snap {
        at_mseq: 1,
        idx: 0,
        count: 1,
        total_len: 200,
        len: 200,
        data: [0; SNAP_DATA_MAX],
    }));
    add(Frame::Handback(Handback {
        from_mseq: 1,
        idx: 0,
        count: 1,
        n: HANDBACK_RECORDS as u8,
        last_lseq: [0; 2],
        records: [[0; 32]; HANDBACK_RECORDS],
    }));
    add(full_begin());
    for kind in [0u8, 1, 2] {
        let mut r = MatchResult::unsigned(1, 0, 0, [0; 8], [0; 32]);
        r.sig_kind = kind;
        add(Frame::Result(r));
    }
    let table_kinds: Vec<u8> = draft
        .lines()
        .filter_map(|l| l.strip_prefix("| `")?.bytes().next())
        .collect();
    for kind in table_kinds {
        let row = draft
            .lines()
            .find(|l| l.starts_with(&format!("| `{}` |", kind as char)))
            .unwrap();
        let cells: Vec<&str> = row.split('|').collect();
        let Some(want) = sizes.get(&kind) else {
            assert_eq!(
                kind, b'P',
                "§2 lists `{}`, which the codec does not implement",
                kind as char
            );
            continue;
        };
        let quoted: std::collections::BTreeSet<usize> = cell_totals(cells[4]).into_iter().collect();
        assert_eq!(
            &quoted, want,
            "§2 `{}` payload cell {:?}",
            kind as char, cells[4]
        );
        let frames: std::collections::BTreeSet<usize> = cell_totals(cells[5]).into_iter().collect();
        let air: std::collections::BTreeSet<usize> = cell_totals(cells[6]).into_iter().collect();
        assert_eq!(
            frames,
            want.iter().map(|p| p + HEADER_LEN).collect(),
            "§2 `{}` frame cell {:?}",
            kind as char,
            cells[5]
        );
        assert_eq!(
            air,
            want.iter().map(|p| p + HEADER_LEN + MAC_TRAILER).collect(),
            "§2 `{}` on-air cell {:?}",
            kind as char,
            cells[6]
        );
    }
    for kind in sizes.keys() {
        assert!(
            draft.contains(&format!("| `{}` |", *kind as char)),
            "the codec's `{}` has no §2 row",
            *kind as char
        );
    }
    let tsx1 = tapstone_proto::transcript::HEADER_LEN;
    assert!(
        draft.contains(&format!("Header {tsx1} B")),
        "§6 must give the TSX1 header as {tsx1} B"
    );
}
