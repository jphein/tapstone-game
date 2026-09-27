use tapstone_proto::follower::{Follower, LOG_CAP, OnCommit};
use tapstone_proto::frame::{Commit, halt_reason};
use tapstone_rules::{Commander, Game, HouseRules, Kind, Record};
use tapstone_sim::{CASTLES, ScriptedSeat, build_deck, claim};

fn lobby(seed: u64) -> Game {
    let d = [build_deck(seed, 0), build_deck(seed, 1)];
    Game::new(HouseRules::default(), CASTLES, [&d[0], &d[1]])
}

/// An interim arbiter (a follower in `arbitrate` mode) plays a whole scripted game; a second
/// follower applies its commits. Returns both.
fn play(seed: u64) -> (Follower, Follower, Vec<Commit>) {
    let mut arb = Follower::new(lobby(seed));
    let mut fol = Follower::new(lobby(seed));
    let mut commits = Vec::new();
    for c in [
        claim(0, CASTLES[0], Commander::LEVEL_1),
        claim(1, CASTLES[1], Commander::LEVEL_1),
    ] {
        commits.push(arb.arbitrate(c, 0, 0).unwrap());
    }
    let mut seats = [ScriptedSeat::new(seed, 0), ScriptedSeat::new(seed, 1)];
    let mut refused = 0;
    for _ in 0..500 {
        if arb.game.phase != tapstone_rules::Phase::Playing {
            break;
        }
        // 0036: every owed draw is a tap. Pay both seats first, from the top of each list.
        for s in 0..2u8 {
            while arb.game.phase == tapstone_rules::Phase::Playing
                && arb.game.seats[s as usize].owed_draws() > 0
            {
                let c = arb.game.top_of_list(s).unwrap();
                commits.push(
                    arb.arbitrate(tapstone_sim::tap(s, Kind::Draw, c, -1, 0, 0), 0, 0)
                        .unwrap(),
                );
            }
        }
        if arb.game.phase != tapstone_rules::Phase::Playing {
            break;
        }
        let a = arb.game.active;
        let tap = seats[a as usize].next_tap(&arb.game);
        match arb.arbitrate(tap, 0, 0) {
            Ok(c) => {
                commits.push(c);
                refused = 0;
            }
            Err(_) => {
                refused += 1;
                if refused >= 3 {
                    let pass = tapstone_sim::tap(a, Kind::Pass, 0, -1, 0, 0);
                    commits.push(arb.arbitrate(pass, 0, 0).unwrap());
                    refused = 0;
                }
            }
        }
    }
    for c in &commits {
        assert!(
            matches!(fol.on_commit(c), OnCommit::Applied { .. }),
            "commit {} not applied",
            c.mseq
        );
    }
    (arb, fol, commits)
}

#[test]
fn a_follower_tracks_the_arbiter_to_the_last_hash() {
    for seed in [1u64, 2, 3] {
        let (arb, fol, commits) = play(seed);
        assert_eq!(fol.head_hash(), arb.head_hash(), "seed {seed}");
        assert_eq!(fol.records(), arb.records());
        assert_eq!(fol.records().len(), commits.len());
        assert!(fol.records().len() < LOG_CAP, "a whole game fits the log");
    }
}

#[test]
fn a_gap_is_nakked_and_a_duplicate_is_acked_and_dropped() {
    let (_, _, commits) = play(1);
    let mut f = Follower::new(lobby(1));
    assert!(matches!(f.on_commit(&commits[0]), OnCommit::Applied { .. }));
    match f.on_commit(&commits[3]) {
        OnCommit::Gap { nak } => assert_eq!((nak.from, nak.to), (1, 2)),
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        f.on_commit(&commits[0]),
        OnCommit::Duplicate { .. }
    ));
    assert_eq!(
        f.records().len(),
        1,
        "neither the gap nor the duplicate was applied"
    );
}

#[test]
fn a_hash_split_halts_and_stays_halted() {
    let (_, _, mut commits) = play(2);
    let mut f = Follower::new(lobby(2));
    let bad = 5;
    commits[bad].hash[0] ^= 0xFF;
    for c in &commits[..bad] {
        f.on_commit(c);
    }
    match f.on_commit(&commits[bad]) {
        OnCommit::Halt(x) => assert_eq!((x.at_mseq, x.reason), (bad as u16, halt_reason::HASH)),
        other => panic!("{other:?}"),
    }
    assert!(matches!(f.on_commit(&commits[bad + 1]), OnCommit::Halt(_)));
}

#[test]
fn a_committed_record_the_engine_refuses_halts() {
    let (_, _, mut commits) = play(3);
    let mut f = Follower::new(lobby(3));
    for c in &commits[..4] {
        f.on_commit(c);
    }
    commits[4].record.kind = Kind::ClaimSeat; // illegal while Playing
    match f.on_commit(&commits[4]) {
        OnCommit::Halt(x) => assert_eq!(x.reason, halt_reason::REFUSED),
        other => panic!("{other:?}"),
    }
}

#[test]
fn hand_back_chunks_reassemble_to_the_records() {
    let (arb, _, _) = play(1);
    let from = 10u16;
    let first = arb.handback(from, 0).unwrap();
    let mut got: Vec<[u8; 32]> = Vec::new();
    for idx in 0..first.count {
        let hb = arb.handback(from, idx).unwrap();
        assert_eq!((hb.from_mseq, hb.count), (from, first.count));
        got.extend_from_slice(&hb.records[..hb.n as usize]);
    }
    assert_eq!(got, arb.records()[from as usize..]);
    assert!(arb.handback(from, first.count).is_none());
}

#[test]
fn records_carry_the_arbiters_seq() {
    let (arb, _, _) = play(1);
    for (i, r) in arb.records().iter().enumerate() {
        assert_eq!(Record::decode(r).unwrap().seq as usize, i);
    }
}

/// The `B` an arbiter holding `lobby(seed)` would send, with the genesis `arb` reached.
fn begin_of(seed: u64, genesis: [u8; 8]) -> tapstone_proto::frame::Begin {
    let d = [build_deck(seed, 0), build_deck(seed, 1)];
    tapstone_proto::frame::Begin::new(&HouseRules::default(), [163, 164], genesis, [&d[0], &d[1]])
}

/// #67 at the follower's own level: built from `B` alone, it applies the arbiter's whole game to
/// the same last hash, and its genesis is the arbiter's.
#[test]
fn a_follower_built_from_begin_alone_tracks_the_arbiter() {
    use tapstone_proto::follower::OnBegin;
    for seed in [1u64, 2, 3] {
        let (arb, _, commits) = play(seed);
        let mut f = Follower::awaiting();
        assert_eq!(f.on_commit(&commits[0]), OnCommit::Unbegun, "no B, no game");
        assert_eq!(
            f.on_begin(7, &begin_of(seed, arb.genesis().unwrap()), 163),
            OnBegin::Begun
        );
        assert_eq!(f.seat_of(164), Some(1));
        for c in &commits {
            assert!(
                matches!(f.on_commit(c), OnCommit::Applied { .. }),
                "seed {seed} mseq {}",
                c.mseq
            );
        }
        assert_eq!(f.genesis(), arb.genesis());
        assert_eq!(f.head_hash(), arb.head_hash());
    }
}

/// The control: one changed deck byte in `B` is a different game. The follower halts on the record
/// that starts the chain (mseq 1), with its own genesis and the stated one, before hashing on.
#[test]
fn a_begin_with_one_changed_deck_byte_halts_at_genesis() {
    let (arb, _, commits) = play(1);
    let mut b = begin_of(1, arb.genesis().unwrap());
    b.decks[1][0] ^= 0x0001;
    let mut f = Follower::awaiting();
    f.on_begin(7, &b, 163);
    assert!(
        matches!(f.on_commit(&commits[0]), OnCommit::Applied { .. }),
        "a lobby record"
    );
    match f.on_commit(&commits[1]) {
        OnCommit::Halt(x) => {
            assert_eq!((x.at_mseq, x.reason), (1, halt_reason::HASH));
            assert_eq!(x.theirs, arb.genesis().unwrap());
            assert_ne!(x.mine, x.theirs);
        }
        other => panic!("a changed list was not caught at genesis: {other:?}"),
    }
    // Without the stated genesis, the same change is still caught, one record later: at the first
    // hashed commit. The genesis check moves the catch earlier; it is not the only net.
    let mut b0 = b;
    b0.genesis = [0; 8];
    let mut g = Follower::awaiting();
    g.on_begin(7, &b0, 163);
    assert!(matches!(g.on_commit(&commits[0]), OnCommit::Applied { .. }));
    assert!(
        matches!(g.on_commit(&commits[1]), OnCommit::Applied { .. }),
        "unchecked genesis"
    );
    assert!(matches!(g.on_commit(&commits[2]), OnCommit::Halt(x) if x.at_mseq == 2));
}

/// A retransmitted `B` is ignored, and a stray `B` for another match cannot reset a live game.
#[test]
fn a_begin_never_resets_a_live_match() {
    use tapstone_proto::follower::OnBegin;
    let (arb, _, commits) = play(2);
    let b = begin_of(2, arb.genesis().unwrap());
    let mut f = Follower::awaiting();
    assert_eq!(f.on_begin(7, &b, 163), OnBegin::Begun);
    assert_eq!(f.on_begin(7, &b, 163), OnBegin::Ignored, "a retransmit");
    for c in &commits[..10] {
        f.on_commit(c);
    }
    let head = f.head_hash();
    assert_eq!(
        f.on_begin(8, &begin_of(3, [0; 8]), 163),
        OnBegin::Ignored,
        "another match, mid-play"
    );
    assert_eq!((f.head_hash(), f.begun()), (head, Some(7)));
}

/// Oracle on #86, the sequence that voided a match: match 7 over, `B(8)` taken, then a late `B(7)`.
/// Match 7 was PLAYED (its chain started), so its late B is refused as Stale and match 8 converges.
/// A stray B for a match that never started is the other case: see the next test.
#[test]
fn a_late_begin_for_the_match_just_left_is_refused() {
    use tapstone_proto::follower::OnBegin;
    let (arb7, _, commits7) = play(1);
    let (arb8, _, commits8) = play(2);
    let b8 = begin_of(2, arb8.genesis().unwrap());
    let b7 = begin_of(1, arb7.genesis().unwrap());
    // Match 7 played to its end, then 8 begins, then a copy of 7's B arrives late.
    let mut f = Follower::awaiting();
    assert_eq!(f.on_begin(7, &b7, 163), OnBegin::Begun);
    for c in &commits7 {
        assert!(matches!(f.on_commit_in(7, c), OnCommit::Applied { .. }));
    }
    assert_eq!(f.game.phase, tapstone_rules::Phase::Over);
    assert_eq!(f.on_begin(8, &b8, 163), OnBegin::Begun);
    assert_eq!(f.on_begin(7, &b7, 163), OnBegin::Stale, "the late B(7)");
    for c in &commits8 {
        assert!(
            matches!(f.on_commit_in(8, c), OnCommit::Applied { .. }),
            "match 8 mseq {}",
            c.mseq
        );
    }
    assert_eq!(f.head_hash(), arb8.head_hash());
}

/// Oracle on #86, the lockout: B(6), B(7), B(8), none started, then a late B(6) with a DIFFERENT
/// list. It is taken (nothing is in play, and no id order exists to refuse it by), so match 8's
/// commits are dropped as `OtherMatch`. The shrine asks with J, and the answer's B(8) must be taken
/// again, after which match 8 converges. Under the old rule every B recorded the match it replaced
/// as `left`, so the late B(6) made 8 "left", and 8's B was refused as Stale until a reboot.
#[test]
fn a_stray_older_begin_costs_one_join_and_heals() {
    use tapstone_proto::follower::OnBegin;
    let (arb8, _, commits8) = play(2);
    let b8 = begin_of(2, arb8.genesis().unwrap());
    let mut b6 = begin_of(1, [0; 8]);
    b6.decks[0][0] ^= 0x0001;
    let b7 = begin_of(3, [0; 8]);
    let mut f = Follower::awaiting();
    assert_eq!(f.on_begin(6, &b6, 163), OnBegin::Begun);
    assert_eq!(f.on_begin(7, &b7, 163), OnBegin::Begun);
    assert_eq!(f.on_begin(8, &b8, 163), OnBegin::Begun);
    assert_eq!(
        f.on_begin(6, &b6, 163),
        OnBegin::Begun,
        "the stray B(6): nothing refuses it"
    );
    assert_eq!(
        f.on_commit_in(8, &commits8[0]),
        OnCommit::OtherMatch,
        "8's commits are dropped"
    );
    // The J round-trip: the arena answers with B(8) and the full replay.
    assert_eq!(
        f.on_begin(8, &b8, 163),
        OnBegin::Begun,
        "the live B, retaken"
    );
    for c in &commits8 {
        assert!(
            matches!(f.on_commit_in(8, c), OnCommit::Applied { .. }),
            "mseq {}",
            c.mseq
        );
    }
    assert_eq!(f.head_hash(), arb8.head_hash());
}

/// A `B` for a match this node is not seated in is refused and changes nothing.
#[test]
fn a_begin_that_does_not_seat_this_node_is_refused() {
    use tapstone_proto::follower::OnBegin;
    let b = begin_of(1, [0; 8]); // seats nodes 163 and 164
    let mut f = Follower::awaiting();
    assert_eq!(f.on_begin(9, &b, 99), OnBegin::NotSeated);
    assert_eq!(f.begun(), None);
    assert_eq!(f.on_begin(9, &b, 164), OnBegin::Begun);
    assert_eq!(f.seat_of(164), Some(1));
}

/// A commit from another match is dropped. Oracle's case: a follower still holding match 7 (over)
/// hears match 8's mseq 0. Through `on_commit` it would be a Duplicate, acked with 7's hash at that
/// mseq, which the arena takes as proof the seat heard its B and stops re-sending it.
#[test]
fn a_commit_from_another_match_is_dropped() {
    let (arb, _, commits) = play(1);
    let mut f = Follower::awaiting();
    f.on_begin(7, &begin_of(1, arb.genesis().unwrap()), 163);
    for c in &commits {
        f.on_commit_in(7, c);
    }
    let (n, head) = (f.records().len(), f.head_hash());
    let (_, _, next) = play(2);
    assert_eq!(f.on_commit_in(8, &next[0]), OnCommit::OtherMatch);
    assert_eq!(
        (f.records().len(), f.head_hash()),
        (n, head),
        "changed nothing"
    );
    // What the unguarded path does with the same frame: the instrument sees the difference.
    assert!(matches!(f.on_commit(&next[0]), OnCommit::Duplicate { .. }));
}

fn sorted(mut v: Vec<u16>) -> Vec<u16> {
    v.sort_unstable();
    v
}

/// #76: at EVERY record of 20 seeded games, the `B` an interim rebuilds from its own state has both
/// original lists (as multisets: the order is not a rule input) and its genesis, and a follower
/// built from it replays the interim's records to the same head. Checked at every point, not only
/// at the end, because mulligans and draws move cards between list and hand mid-game.
#[test]
fn an_interim_rebuilds_the_begin_it_was_built_from_at_every_record() {
    use tapstone_proto::follower::OnBegin;
    for seed in 1..=20u64 {
        let (_, _, commits) = play(seed);
        let original = begin_of(seed, [0; 8]);
        let mut interim = Follower::awaiting();
        interim.on_begin(7, &original, 163);
        for (n, c) in commits.iter().enumerate() {
            assert!(
                matches!(interim.on_commit(c), OnCommit::Applied { .. }),
                "seed {seed}"
            );
            let b = interim.begin_frame().expect("a begun follower rebuilds B");
            for s in 0..2 {
                assert_eq!(
                    sorted(b.deck(s).to_vec()),
                    sorted(original.deck(s).to_vec()),
                    "seed {seed} after mseq {n}: seat {s}'s list"
                );
            }
            assert_eq!((b.rules, b.nodes), (original.rules, original.nodes));
            assert_eq!(
                b.genesis,
                interim.genesis().unwrap_or([0; 8]),
                "seed {seed} mseq {n}"
            );
        }
        // The rebuilt B at the head starts a follower that reaches the interim's head.
        let mut rebooted = Follower::awaiting();
        assert_eq!(
            rebooted.on_begin(7, &interim.begin_frame().unwrap(), 164),
            OnBegin::Begun
        );
        for c in &commits {
            assert!(
                matches!(rebooted.on_commit(c), OnCommit::Applied { .. }),
                "seed {seed}"
            );
        }
        assert_eq!(rebooted.head_hash(), interim.head_hash(), "seed {seed}");
    }
}

/// The control: one rebuilt card that differs (a list the arithmetic got wrong) is caught at the
/// record that starts the chain, because the rebuilt `B` states the interim's real genesis.
#[test]
fn a_rebuilt_begin_with_one_wrong_card_is_caught_at_genesis() {
    let (_, _, commits) = play(4);
    let mut interim = Follower::awaiting();
    interim.on_begin(7, &begin_of(4, [0; 8]), 163);
    for c in &commits {
        interim.on_commit(c);
    }
    let mut b = interim.begin_frame().unwrap();
    b.decks[1][0] ^= 0x0001;
    let mut rebooted = Follower::awaiting();
    rebooted.on_begin(7, &b, 164);
    rebooted.on_commit(&commits[0]);
    assert!(
        matches!(rebooted.on_commit(&commits[1]), OnCommit::Halt(x) if x.at_mseq == 1 && x.reason == halt_reason::HASH),
        "a wrong rebuilt card was not caught at genesis"
    );
}

/// `H` chunks replay the interim's record list to a follower that holds only the rebuilt `B`: every
/// record is checked against its carried hash, an out-of-order chunk is a gap, and the chunk's
/// per-seat `last_lseq` is taken. The control: one flipped hash byte halts.
#[test]
fn handback_chunks_bring_a_rebooted_follower_to_the_head() {
    use tapstone_proto::follower::OnHandback;
    let (_, _, commits) = play(5);
    let mut interim = Follower::awaiting();
    interim.on_begin(7, &begin_of(5, [0; 8]), 163);
    for (k, c) in commits.iter().enumerate() {
        let lseq = k as u16 + 1; // any monotone per-seat counter
        let mut c = *c;
        c.lseq = lseq;
        interim.on_commit(&c);
    }
    let count = interim.handback(0, 0).unwrap().count;
    let mut f = Follower::awaiting();
    f.on_begin(7, &interim.begin_frame().unwrap(), 164);
    assert_eq!(
        f.on_handback_in(8, &interim.handback(0, 0).unwrap()),
        OnHandback::OtherMatch,
        "another match's chunk"
    );
    assert_eq!(f.next_mseq(), 0, "and it changed nothing");
    if count > 1 {
        let late = interim.handback(0, 1).unwrap();
        assert_eq!(
            f.on_handback(&late),
            OnHandback::Gap { next: 0 },
            "chunk 1 before chunk 0"
        );
    }
    for idx in 0..count {
        assert!(matches!(
            f.on_handback(&interim.handback(0, idx).unwrap()),
            OnHandback::Applied { .. }
        ));
    }
    assert_eq!(f.head_hash(), interim.head_hash());
    assert_eq!(f.last_lseq(), interim.last_lseq(), "the resume point");
    // Control.
    let mut g = Follower::awaiting();
    g.on_begin(7, &interim.begin_frame().unwrap(), 164);
    let mut bad = interim.handback(0, count - 1).unwrap();
    for idx in 0..count - 1 {
        g.on_handback(&interim.handback(0, idx).unwrap());
    }
    bad.records[(bad.n - 1) as usize][31] ^= 0x01;
    assert!(
        matches!(g.on_handback(&bad), OnHandback::Halt(_)),
        "a flipped carried hash halts"
    );
}

/// A HALTED follower (§5: it stops applying, and its engine still reads Playing) takes the next
/// match's `B`. It used to ignore it as "a game in play", locking it out of every later match
/// until a reboot.
#[test]
fn a_halted_follower_takes_the_next_matchs_begin() {
    use tapstone_proto::follower::OnBegin;
    let (arb7, _, commits7) = play(1);
    let (arb8, _, commits8) = play(2);
    let mut bad = begin_of(1, arb7.genesis().unwrap());
    bad.decks[1][0] ^= 0x0001;
    let mut f = Follower::awaiting();
    f.on_begin(7, &bad, 163);
    f.on_commit_in(7, &commits7[0]);
    assert!(matches!(f.on_commit_in(7, &commits7[1]), OnCommit::Halt(_)));
    assert_eq!(
        f.game.phase,
        tapstone_rules::Phase::Playing,
        "halted, and still Playing"
    );
    let b8 = begin_of(2, arb8.genesis().unwrap());
    assert_eq!(f.on_begin(8, &b8, 163), OnBegin::Begun);
    for c in &commits8 {
        assert!(matches!(f.on_commit_in(8, c), OnCommit::Applied { .. }));
    }
    assert_eq!(f.head_hash(), arb8.head_hash());
}

/// A follower that missed its match's last commit still reads Playing. It refuses the next `B`
/// until it hears that match's RESULT (a stray B must not reset a live game), then takes it.
#[test]
fn a_follower_stuck_playing_takes_the_next_begin_after_the_result() {
    use tapstone_proto::follower::OnBegin;
    let (arb7, _, commits7) = play(1);
    let (arb8, _, commits8) = play(2);
    let mut f = Follower::awaiting();
    f.on_begin(7, &begin_of(1, arb7.genesis().unwrap()), 163);
    for c in &commits7[..commits7.len() - 1] {
        f.on_commit_in(7, c);
    }
    assert_eq!(
        f.game.phase,
        tapstone_rules::Phase::Playing,
        "the last commit was missed"
    );
    let b8 = begin_of(2, arb8.genesis().unwrap());
    assert_eq!(
        f.on_begin(8, &b8, 163),
        OnBegin::Ignored,
        "before R: still a game in play"
    );
    f.on_result(9);
    assert_eq!(
        f.on_begin(8, &b8, 163),
        OnBegin::Ignored,
        "another match's R changes nothing"
    );
    f.on_result(7);
    assert_eq!(
        f.on_begin(8, &b8, 163),
        OnBegin::Begun,
        "after its own match's R"
    );
    for c in &commits8 {
        assert!(matches!(f.on_commit_in(8, c), OnCommit::Applied { .. }));
    }
    assert_eq!(f.head_hash(), arb8.head_hash());
    // Match 7 was played, so a late B(7) now is Stale, not a reset.
    assert_eq!(
        f.on_begin(7, &begin_of(1, arb7.genesis().unwrap()), 163),
        OnBegin::Stale
    );
}
