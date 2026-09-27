//! Two matches back to back through the desk (the harness had never played a second match, so
//! every stale-B finding before this was follower-level only). After a RESULT each shrine goes back
//! to the lobby and claims again; the arena starts a second match with a new id and a new B.
mod harness;
use harness::*;
use tapstone_proto::frame::result_reason;

/// Play until `n` results exist, then drain until the arena stops lingering.
fn until_results(net: &mut Net, n: usize, max: usize) -> bool {
    for _ in 0..max {
        if net.over.len() >= n && !net.core.lingering() {
            return true;
        }
        net.step();
    }
    false
}

fn played(o: &tapstone_arena::core::MatchOver) -> bool {
    [result_reason::LETHAL, result_reason::STOP].contains(&o.result.reason)
}

/// Why a seed failed to play two matches back to back, or `None` when it played both.
fn back_to_back(net: &mut Net, seed: u64) -> Option<String> {
    for s in &mut net.shrines {
        s.rematch = true;
    }
    let mut done = false;
    for _ in 0..80_000 {
        if net.over.len() >= 2 && !net.core.lingering() {
            done = true;
            break;
        }
        // Two matches, not three: once both shrines hold match 2, neither plays on after it. A
        // shrine leaves a match on its final commit, so without this a third can begin while the
        // arena still lingers on the second, and the check below would read match 3.
        if let [first] = net.over.as_slice() {
            let m1 = first.match_id;
            if net
                .shrines
                .iter()
                .all(|s| s.follower.begun().is_some_and(|id| id != m1))
            {
                for s in &mut net.shrines {
                    s.rematch = false;
                }
            }
        }
        net.step();
    }
    if !done {
        let stuck: Vec<String> = net
            .shrines
            .iter()
            .map(|s| {
                format!(
                    "node {}: R heard {}, lobby_after {:?}, phase {:?}",
                    s.node, s.heard_result, s.lobby_after, s.follower.game.phase
                )
            })
            .collect();
        return Some(format!(
            "seed {seed}: {} result(s); {}",
            net.over.len(),
            stuck.join("; ")
        ));
    }
    let (a, b) = (&net.over[0], &net.over[1]);
    if !(played(a) && played(b)) {
        return Some(format!(
            "seed {seed}: ended by {} / {}",
            a.result.reason, b.result.reason
        ));
    }
    if a.match_id == b.match_id {
        return Some(format!("seed {seed}: match 2 reused match 1's id"));
    }
    for s in &net.shrines {
        if s.follower.begun() != Some(b.match_id) || s.follower.head_hash() != b.result.chain {
            return Some(format!(
                "seed {seed} node {}: not at match 2's head: begun {:?} (match 2 {:?}), {} results, phase {:?}, next_mseq {}",
                s.node,
                s.follower.begun(),
                b.match_id,
                net.over.len(),
                s.follower.game.phase,
                s.follower.next_mseq()
            ));
        }
    }
    None
}

/// 50 seeds at 10% loss and 5% duplication, broadcast loss drawn per receiver: both matches
/// finish, have different ids, and both shrines end at the second match's chain head. #101: the
/// RESULT linger closes once both seats ACK the final commit, which does not prove either heard
/// `R`, so a shrine that went back to the lobby only on `R` could sit at `Phase::Over` forever. A
/// shrine now leaves on the committed record that ended its game (ruled 2026-09-27, option 2).
#[test]
fn two_matches_play_back_to_back() {
    let mut failed = Vec::new();
    let mut one_sided = 0;
    for seed in 1..=50u64 {
        let mut net = Net::new(seed, 0.10, 0.05);
        assert!(net.per_receiver_loss, "the mesh this test is about");
        if let Some(why) = back_to_back(&mut net, seed) {
            failed.push(why);
        }
        one_sided += net.one_sided;
    }
    // The instrument: broadcasts that reached one shrine and not the other did happen, so a shrine
    // could hold the final commit while missing R.
    assert!(
        one_sided > 0,
        "no broadcast was ever heard by one shrine only"
    );
    assert!(
        failed.is_empty(),
        "{} of 50 seeds never played match 2:\n{}",
        failed.len(),
        failed.join("\n")
    );
}

/// The mechanism, without luck: neither shrine hears a single `R`, and both still play match 2,
/// because each left match 1 on the commit that ended its game.
#[test]
fn a_shrine_that_never_hears_r_plays_the_next_match() {
    for seed in 1..=10u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        net.drop_result = [true; 2];
        if let Some(why) = back_to_back(&mut net, seed) {
            panic!("{why}");
        }
        assert_eq!(net.results_heard, [0; 2], "seed {seed}: an R got through");
    }
}

/// `R` for a match a shrine has already left carries the result details only: it must not send
/// the shrine back to the lobby a second time (resetting the claim it has in flight), nor mark it
/// as having heard the result of a match it is no longer in.
#[test]
fn a_late_r_does_not_count_the_rematch_twice() {
    use tapstone_proto::frame::Frame;
    let mut net = Net::new(4, 0.0, 0.0);
    for s in &mut net.shrines {
        s.rematch = true;
    }
    net.drop_result[0] = true;
    for _ in 0..80_000 {
        if !net.over.is_empty() && net.shrines[0].pending.is_some() {
            break;
        }
        net.step();
    }
    let over = net.over.first().expect("match 1 ended").clone();
    let s = &net.shrines[0];
    assert_eq!(
        s.lobby_after,
        Some(over.match_id),
        "left on the final commit"
    );
    assert_eq!(
        s.follower.begun(),
        Some(over.match_id),
        "match 2 not begun yet"
    );
    let (pending, lseq) = (s.pending, s.lseq);
    assert!(pending.is_some(), "a claim in flight");
    let r = tapstone_arena::link::desk::encode(ARENA, over.match_id, &Frame::Result(over.result));
    net.drop_result[0] = false;
    net.deliver(0, &r);
    let s = &net.shrines[0];
    assert_eq!(net.results_heard[0], 1, "the late R was delivered");
    assert_eq!(s.lobby_after, Some(over.match_id));
    assert_eq!((s.pending, s.lseq), (pending, lseq), "the claim was reset");
    assert!(!s.heard_result, "R of a match already left");
}

/// The lockout Oracle named on #88: a shrine that HALTED in match 1 (a corrupted B, so match 1 is
/// void) must still play match 2. Also the id collision this run found: match 1 is void at mseq 1,
/// the re-claimed match 2 started in the same unix second, and `(node << 24) ^ unix` gave it match
/// 1's id, so the halted shrine's match-1 HALT voided match 2 over and over. Its engine reads Playing, which used to count as "a game in
/// play", so it ignored B(2) forever and match 2 could never start its chain for that seat.
#[test]
fn a_shrine_halted_in_one_match_plays_the_next() {
    for seed in 1..=10u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        let who = (seed % 2) as usize;
        net.corrupt_begin[who] = true; // match 1's B only
        for s in &mut net.shrines {
            s.rematch = true;
        }
        assert!(
            until_results(&mut net, 2, 80_000),
            "seed {seed}: no second result"
        );
        assert_eq!(
            net.over[0].result.reason,
            result_reason::DESYNC,
            "seed {seed}: match 1"
        );
        // Match 1 is void at once, so match 2 starts in the same second: its id must still differ.
        assert_ne!(
            net.over[0].match_id, net.over[1].match_id,
            "seed {seed}: the id was reused"
        );
        let b = &net.over[1];
        assert!(
            played(b),
            "seed {seed}: match 2 ended by {}",
            b.result.reason
        );
        for s in &net.shrines {
            assert!(s.follower.halted().is_none(), "seed {seed} node {}", s.node);
            assert_eq!(
                s.follower.head_hash(),
                b.result.chain,
                "seed {seed} node {}",
                s.node
            );
        }
    }
}

/// A HALT stamped with the last match's id reaches the arena during this one (a shrine still
/// holding the old match, answering a late retransmit): it must not void this match. The control:
/// the same HALT stamped with this match's id does void it, so the instrument can see.
#[test]
fn a_halt_from_the_last_match_cannot_void_this_one() {
    use tapstone_arena::core::{Input, Output};
    use tapstone_arena::link::desk::encode;
    use tapstone_proto::frame::{Frame, Halt, halt_reason};
    let mut net = Net::new(3, 0.0, 0.0);
    for s in &mut net.shrines {
        s.rematch = true;
    }
    assert!(until_results(&mut net, 1, 40_000));
    let old = net.over[0].match_id;
    for _ in 0..40_000 {
        if net.core.genesis().is_some() {
            break;
        }
        net.step();
    }
    assert!(net.core.genesis().is_some(), "match 2 started");
    let now = net.shrines[0].begin.map(|(id, _)| id).expect("B(2)");
    assert_ne!(now, old);
    let x = Frame::Halt(Halt {
        at_mseq: 1,
        reason: halt_reason::HASH,
        mine: [1; 8],
        theirs: [2; 8],
    });
    let t = net.now;
    let voided = |outs: Vec<Output>| outs.iter().any(|o| matches!(o, Output::MatchOver(_)));
    let stale = Input::Frame {
        src: NODES[0],
        rssi: -40,
        mac_ok: true,
        bytes: encode(NODES[0], old, &x),
    };
    assert!(
        !voided(net.core.handle(stale, t)),
        "the last match's HALT voided this one"
    );
    let live = Input::Frame {
        src: NODES[0],
        rssi: -40,
        mac_ok: true,
        bytes: encode(NODES[0], now, &x),
    };
    assert!(
        voided(net.core.handle(live, t)),
        "control: this match's own HALT must void it"
    );
}

/// Oracle on #89: a TAP stamped with the last match's id was COMMITTED into the running one (a
/// move nobody made in this match). A TAP or NAK from another match is dropped. The control: the
/// same TAP with this match's id commits, and the same NAK replays.
#[test]
fn a_tap_or_nak_from_the_last_match_is_dropped() {
    use tapstone_arena::core::{Input, Output};
    use tapstone_arena::link::desk::encode;
    use tapstone_proto::frame::{Frame, Nak, Tap};
    use tapstone_rules::Kind;
    let mut net = Net::new(3, 0.0, 0.0);
    for s in &mut net.shrines {
        s.rematch = true;
    }
    assert!(until_results(&mut net, 1, 40_000));
    let old = net.over[0].match_id;
    net.manual = [true; 2]; // match 2: claims only, so seat 0 still owes its opening draws
    for _ in 0..40_000 {
        if net.core.genesis().is_some() {
            break;
        }
        net.step();
    }
    let now = net.core.match_id().expect("match 2 is running");
    assert_ne!(now, old);
    let card = net.shrines[0]
        .follower
        .game
        .top_of_list(0)
        .expect("an undrawn copy");
    let mut draw = tapstone_sim::tap(0, Kind::Draw, card, -1, 0, 0);
    draw.uid = [4, 9, 9, 9, 9, 9, 1];
    let tap = Frame::Tap(Tap::Propose {
        lseq: 900,
        record: draw,
    });
    let input = |id: u32, f: &Frame| Input::Frame {
        src: NODES[0],
        rssi: -40,
        mac_ok: true,
        bytes: encode(NODES[0], id, f),
    };
    let t = net.now;
    let before = net.core.log_len();
    net.core.handle(input(old, &tap), t);
    assert_eq!(
        net.core.log_len(),
        before,
        "the last match's TAP was committed into this one"
    );
    net.core.handle(input(now, &tap), t);
    assert_eq!(
        net.core.log_len(),
        before + 1,
        "control: this match's TAP commits"
    );
    let replays = |outs: Vec<Output>| {
        outs.iter()
            .filter(|o| matches!(o, Output::Send { frame, .. } if frame.get(14) == Some(&b'C')))
            .count()
    };
    let nak = Frame::Nak(Nak {
        from: 0,
        to: 0xFFFF,
    });
    assert_eq!(
        replays(net.core.handle(input(old, &nak), t)),
        0,
        "the last match's NAK replayed this one"
    );
    assert!(
        replays(net.core.handle(input(now, &nak), t)) > 0,
        "control: this match's NAK replays"
    );
}

/// Oracle on #89: a REVIVED arena must not reuse the id of the match it recovered. Match 1 starts,
/// the arena goes dark 30 ms later with seat 1's B withheld, and the revived core sends seat 1 a
/// corrupted B, so match 1 is void on the REVIVED core. The re-claimed match 2 starts in the same
/// unix second. Without `recover` remembering the recovered id, match 2 got match 1's id.
#[test]
fn a_revived_arena_never_reuses_the_recovered_matchs_id() {
    let mut same_second = 0;
    for seed in 1..=10u64 {
        let mut net = Net::new(seed, 0.0, 0.0);
        for s in &mut net.shrines {
            s.rematch = true;
        }
        net.corrupt_begin[1] = true; // match 1's B only
        net.drop_begin[1] = u32::MAX; // seat 1 hears no B until after the revival
        for _ in 0..5_000 {
            if net.core.genesis().is_some() {
                break;
            }
            net.step();
        }
        let m1 = net.core.match_id().expect("match 1 started");
        net.go_dark();
        for _ in 0..3 {
            net.step(); // 30 ms dark
        }
        net.drop_begin[1] = 0;
        net.revive();
        // Oracle's first attempt was invalid: match 2 had already started before the revive.
        assert_eq!(
            net.core.match_id(),
            Some(m1),
            "seed {seed}: the revived core holds match 1"
        );
        assert!(
            net.over.is_empty(),
            "seed {seed}: match 1 is still running at the revival"
        );
        assert!(
            until_results(&mut net, 2, 80_000),
            "seed {seed}: no second result"
        );
        let (a, b) = (&net.over[0], &net.over[1]);
        assert_eq!(
            (a.match_id, a.result.reason),
            (m1, result_reason::DESYNC),
            "seed {seed}: match 1 void on the revived core"
        );
        assert_ne!(
            b.match_id, m1,
            "seed {seed}: match 2 reused the recovered id"
        );
        // The bump fires only when match 2 started in match 1's second: count the seeds that met
        // that case, so the check above cannot pass by never meeting it. Counted from the
        // journal's start seconds, never from the ids: `m1 + 1` is also match 2's NATURAL id
        // whenever match 1's second is even ((node << 24) ^ (s + 1) = ((node << 24) ^ s) + 1), so an
        // id-based count stayed green with `recover`'s last_match deleted and match 2 a second
        // later (Oracle on #92).
        let starts: Vec<u32> = net
            .journal
            .iter()
            .filter_map(|j| match j {
                tapstone_arena::core::JournalOp::Begin { start_unix, .. } => Some(*start_unix),
                _ => None,
            })
            .collect();
        assert_eq!(starts.len(), 2, "seed {seed}: two journaled matches");
        same_second += usize::from(starts[0] == starts[1]);
    }
    assert!(
        same_second >= 5,
        "only {same_second} of 10 seeds started match 2 in match 1's second"
    );
}

/// Leaving a finished match happens ONCE per match (#101 gate, the lead's perturbation): the
/// shrine's game stays `Phase::Over` until the next B, and every tick in between must not send it
/// back to the lobby again. A second trip resets the claim in flight, so the claim went out every
/// tick instead of every `claim_retry_ms`.
#[test]
fn a_finished_match_is_left_once_and_the_claim_keeps_its_cadence() {
    let mut net = Net::new(4, 0.0, 0.0);
    for s in &mut net.shrines {
        s.rematch = true;
    }
    net.drop_result = [true; 2]; // the final commit is the only way out
    for _ in 0..80_000 {
        if !net.over.is_empty() && net.shrines[0].pending.is_some() {
            break;
        }
        net.step();
    }
    let over = net.over.first().expect("match 1 ended").clone();
    let s = &mut net.shrines[0];
    assert_eq!(
        s.lobby_after,
        Some(over.match_id),
        "left on the final commit"
    );
    assert_eq!(
        s.follower.begun(),
        Some(over.match_id),
        "match 2 not begun yet"
    );
    let (_, sent) = s.pending.expect("a claim in flight");
    let retry = s.claim_retry_ms;
    for dt in 1..retry {
        s.act(sent + dt, true, false);
        assert_eq!(
            (s.pending, s.lseq),
            (Some((1, sent)), 1),
            "+{dt} ms: the claim was reset (left the match again)"
        );
    }
    s.act(sent + retry, true, false);
    assert_eq!(s.pending, Some((1, sent + retry)), "re-sent on its cadence");
}

/// What a second trip to the lobby also wipes: `heard_unbegun`. A shrine that left match 1 on its
/// final commit and then lost every retransmit of match 2's B hears match 2's commits, and must ask
/// for B (#67). Leaving match 1 again each tick cleared the flag before the ask could read it, so
/// the shrine never asked and match 2 stalled with it seatless.
#[test]
fn a_shrine_that_left_on_the_final_commit_still_asks_for_a_lost_b() {
    for seed in 1..=10u64 {
        let who = (seed % 2) as usize;
        let mut net = Net::new(seed, 0.0, 0.0);
        for s in &mut net.shrines {
            s.rematch = true;
        }
        net.drop_result = [true; 2];
        for _ in 0..80_000 {
            if !net.over.is_empty() && net.shrines.iter().all(|s| s.lobby_after.is_some()) {
                break;
            }
            net.step();
        }
        let m1 = net.over.first().expect("match 1 ended").match_id;
        assert_eq!(net.shrines[who].lobby_after, Some(m1), "seed {seed}");
        net.drop_begin[who] = 5; // match 2's B and its retransmits, as a_dropped_begin_is_asked_for
        let asks = net.shrines[who].begin_asks;
        let mut begun = false;
        for _ in 0..80_000 {
            if net.shrines[who].follower.begun().is_some_and(|id| id != m1) {
                begun = true;
                break;
            }
            net.step();
        }
        assert!(
            net.shrines[who].begin_asks > asks,
            "seed {seed}: never asked for match 2's B"
        );
        assert!(begun, "seed {seed}: never took match 2's B");
    }
}
