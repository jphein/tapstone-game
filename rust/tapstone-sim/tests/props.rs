//! Property tests: the engine never panics on arbitrary input, and an independent replay of any
//! accepted transcript reproduces the arbiter's hash chain. Case counts scale with
//! `TAPSTONE_PROPTEST_MULT` (default 1).
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use proptest::prelude::*;
use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};
use tapstone_rules::cards::design;
use tapstone_rules::state::Unit;
use tapstone_rules::{Applied, CardKind, Commander, Game, HouseRules, Kind, Record, Refusal, SET1};
use tapstone_sim::{Arbiter, CASTLES, Transcript, build_deck, claim, play_seeded, replay, tap};

fn cases(default: u32) -> u32 {
    std::env::var("TAPSTONE_PROPTEST_MULT")
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .map_or(default, |m| default.saturating_mul(m.max(1)))
}

fn lobby() -> Game {
    let decks = [build_deck(1, 0), build_deck(1, 1)];
    Game::new(HouseRules::default(), CASTLES, [&decks[0], &decks[1]])
}

/// Where a case begins: an empty Lobby, a freshly started game, or a started game with mana, a
/// unit in every lane on both sides and spells in both hands, so spell effects are reachable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Start {
    Lobby,
    Started,
    Armed,
}

fn start_strategy() -> impl Strategy<Value = Start> {
    prop_oneof![Just(Start::Lobby), Just(Start::Started), Just(Start::Armed)]
}

fn unit_from(id: u16) -> Unit {
    let d = design(id).expect("a set 1 design");
    let CardKind::Unit {
        attack,
        toughness,
        keyword,
    } = d.kind
    else {
        panic!("design {id} is not a unit")
    };
    Unit {
        design: d.id,
        attack,
        toughness,
        damage: 0,
        keyword,
        entered_round: 0,
    }
}

fn armed() -> Game {
    let mut g = lobby().started();
    // Seat 0: Cinder Whelp back / Hearth Warden mid / Ashen Vanguard front, spells Flare, Tidal Lash, Undertow, Riptide.
    // Seat 1: Reef Archer back / Pearl Shieldbearer mid / Tidecaller front, spells Tidal Lash, Undertow, Riptide, Mend.
    let plans: [([u16; 3], [u16; 4]); 2] =
        [([2, 4, 3], [5, 9, 10, 13]), ([6, 8, 7], [9, 10, 13, 12])];
    for (seat, (units, spells)) in g.seats.iter_mut().zip(plans) {
        seat.charged = 6;
        seat.spent = 0;
        for (lane, &u) in units.iter().enumerate() {
            seat.cells[lane][lane] = Some(unit_from(u));
        }
        // Spells first (hand[0..4]), the three unit designs (so CastUnit into an occupied entry cell
        // is reachable), then a second copy of the effect spells so one success does not exhaust a case.
        seat.hand[..4].copy_from_slice(&spells);
        seat.hand[4..7].copy_from_slice(&units);
        seat.hand[7..10].copy_from_slice(&[10, 13, 12]);
        seat.hand_len = 10;
    }
    g
}

fn start(mode: Start) -> Game {
    match mode {
        Start::Lobby => lobby(),
        Start::Started => lobby().started(),
        Start::Armed => armed(),
    }
}

/// Steer more records past the seat/kind/card guards: seat 0/1, kind 1..=8, card < 14.
fn bias(b: &mut [u8; 24]) {
    b[2] &= 1;
    b[3] = 1 + b[3] % 8;
    let card = u16::from_le_bytes([b[4], b[5]]) % 14;
    b[4..6].copy_from_slice(&card.to_le_bytes());
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(cases(2000)))]
    #[test]
    fn apply_never_panics_on_arbitrary_records(
        mut bufs in prop::collection::vec(any::<[u8; 24]>(), 1..=200),
        mode in start_strategy(),
        biased in any::<bool>(),
    ) {
        let mut g = start(mode);
        if biased {
            bufs.iter_mut().for_each(bias);
        }
        for b in &bufs {
            if let Some(r) = Record::decode(b) {
                let _ = g.apply(&r);
            }
        }
    }
}

fn assert_replay_matches(t: &Transcript) {
    let r = replay(t).expect("a transcript holds only accepted events");
    assert_eq!(r.final_hash, t.final_hash, "final_hash");
    let recorded: Vec<Option<String>> = t.records.iter().map(|r| r.hash.clone()).collect();
    assert_eq!(r.hashes, recorded, "per-record hashes");
    assert_eq!(r.game_over, t.game_over, "game_over");
    assert_eq!(r.winner, t.winner, "winner");
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(cases(300)))]
    #[test]
    fn accepted_records_replay_to_the_same_chain(seed in any::<u64>(), budget in 20usize..=400) {
        let t = play_seeded(seed, budget);
        assert_replay_matches(&t);
    }
}

static REFUSALS: AtomicU32 = AtomicU32::new(0);
static ATTEMPTS: AtomicUsize = AtomicUsize::new(0);
/// Refusal and Applied variants seen over the whole run, plus successful Shift/Destroy/Heal casts.
static TALLY: Mutex<BTreeMap<String, u32>> = Mutex::new(BTreeMap::new());

fn tally(key: impl Into<String>) {
    *TALLY.lock().unwrap().entry(key.into()).or_insert(0) += 1;
}

fn variant_name(debug: &str) -> &str {
    debug.split([' ', '(', '{']).next().unwrap_or(debug)
}

const EVERY_REFUSAL: [&str; 13] = [
    "NotYourTurn",
    "NotInHand",
    "NoMana",
    "CellOccupied",
    "AlreadyChargedThisRound",
    "AlreadyAdvancedLane",
    "BadTarget",
    "UnknownCard",
    "LaneOutOfRange",
    "NotPlaying",
    "SeatTaken",
    "MulliganClosed",
    "LobbyClosed",
];

/// The coverage floor's sample is FIXED. The asserts below ("every Refusal appeared", "a Shift and
/// a Destroy succeeded") are claims about a SAMPLE, and on an unseeded runner a rare sample with no
/// successful Destroy failed a debug run (selene, 2026-09-27; 12 debug and 6 release reruns were
/// green). A floor that depends on luck is a flake, not a check. So the sample is a fixed ChaCha
/// stream, and the margin is measured, not hoped for: see `COVERAGE_SEED`'s note.
///
/// `TAPSTONE_COVERAGE_SEED=<u64>` picks another fixed sample. `=random` explores with a seed taken
/// from the clock and PRINTED, so any failure it finds can be replayed. The other properties in this
/// file stay random.
///
/// The margin, measured 2026-09-27 (debug, 300 cases, after #166's 30-card decks), as successful
/// casts and the thinnest Refusal:
///
/// |                          | Destroy | Shift | Heal | thinnest Refusal      |
/// |--------------------------|---------|-------|------|-----------------------|
/// | this seed                | 24      | 28    | 23   | 21 AlreadyAdvancedLane |
/// | worst of seeds 1..=20    | 10      | 12    | 23   | 8 AlreadyAdvancedLane  |
/// | unbiased cards, worst    | 3       | 1     | 7    | 12                    |
///
/// The last row is why the card strategy is biased (see `card` below). Controls: two cases make it
/// red (`Refusal::NoMana never appeared`); not counting Destroy makes it red (`no successful Destroy`).
const COVERAGE_SEED: u64 = 20_260_927;

fn coverage_rng() -> (u64, TestRng) {
    let seed = match std::env::var("TAPSTONE_COVERAGE_SEED").ok().as_deref() {
        None | Some("") => COVERAGE_SEED,
        Some("random") => std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(1, |d| d.as_nanos() as u64),
        Some(s) => s
            .parse()
            .unwrap_or_else(|_| panic!("TAPSTONE_COVERAGE_SEED={s:?}: a u64 or \"random\"")),
    };
    let mut bytes = [0u8; 32];
    bytes[..8].copy_from_slice(&seed.to_le_bytes());
    (seed, TestRng::from_seed(RngAlgorithm::ChaCha, &bytes))
}

#[test]
fn random_taps_through_the_arbiter_replay_equivalently() {
    // Most cards come from the armed hands and half the targets from the armed cells, so spell
    // effects resolve often enough to be asserted on; the rest stays uniform.
    // A third of the cards are Shift (10), Heal (12) or Destroy (13), the targeted spells whose
    // successes the floor below counts. Unbiased, over 20 fixed seeds the thinnest sample held 1 Shift
    // and 3 Destroys; biased toward Shift and Destroy alone, Heal fell to 3 (2026-09-27). See
    // COVERAGE_SEED.
    let card = prop_oneof![
        prop::sample::select(vec![10u16, 12, 13]),
        prop::sample::select(vec![5u16, 9, 10, 11, 12, 13, 2, 3, 4, 6, 7, 8]),
        // Six ids past the set, so Refusal::UnknownCard keeps firing however large SET1 grows.
        0u16..SET1.len() as u16 + 6
    ];
    let target = prop_oneof![
        prop::sample::select(vec![0x00u8, 0x05, 0x0A, 0x10, 0x15, 0x1A, 0xFF]),
        any::<u8>(),
    ];
    // Kinds lean toward CastSpell/CastUnit so effects resolve; the rest stays uniform over 1..=8.
    let kind = prop_oneof![2 => Just(5u8), 1 => Just(4u8), 5 => 1u8..=8];
    let strategy = (
        start_strategy(),
        prop::collection::vec((0u8..=1, kind, card, -1i8..=3, target, 0u8..=1), 1..=300),
    );
    let (seed, rng) = coverage_rng();
    println!("coverage seed: {seed} (TAPSTONE_COVERAGE_SEED)");
    let mut runner = TestRunner::new_with_rng(
        Config::with_cases(cases(300)).clone_with_source_file(file!()),
        rng,
    );
    runner
        .run(&strategy, |(mode, taps)| {
            let mut a = Arbiter::new(start(mode));
            let mut injected = 0usize;
            if mode == Start::Lobby {
                a.commit(claim(1, CASTLES[1], Commander::LEVEL_1)).unwrap();
                prop_assert_eq!(
                    a.commit(claim(1, CASTLES[1], Commander::LEVEL_1)),
                    Err(Refusal::SeatTaken)
                );
                tally("refusal:SeatTaken");
                injected += 1;
                a.commit(claim(0, CASTLES[0], Commander::LEVEL_1)).unwrap();
            }
            prop_assert_eq!(
                a.game.with_rules(HouseRules::default()),
                Err(Refusal::LobbyClosed)
            );
            tally("refusal:LobbyClosed");
            let lobby_records = a.records.len();
            let attempts = taps.len();
            for (seat, kind, card, lane, target, aux) in taps {
                let kind = Kind::from_u8(kind).unwrap();
                match a.commit(tap(seat, kind, card, lane, target, aux)) {
                    Ok(applied) => {
                        tally(format!("applied:{}", variant_name(&format!("{applied:?}"))));
                        if applied == Applied::Spell {
                            match card {
                                10 => tally("effect:Shift ok"),
                                13 => tally("effect:Destroy ok"),
                                12 => tally("effect:Heal ok"),
                                5 | 9 => tally("effect:Damage ok"),
                                11 => tally("effect:Draw ok"),
                                _ => {}
                            }
                        }
                    }
                    Err(e) => tally(format!("refusal:{}", variant_name(&format!("{e:?}")))),
                }
            }
            prop_assert_eq!(
                a.refusals as usize + (a.records.len() - lobby_records),
                attempts + injected,
                "every attempt is either recorded or refused"
            );
            REFUSALS.fetch_add(a.refusals, Ordering::Relaxed);
            ATTEMPTS.fetch_add(attempts, Ordering::Relaxed);
            if mode == Start::Lobby {
                // Only a game that began from `Game::new` + records can be rebuilt by `replay`.
                let decks = [build_deck(1, 0), build_deck(1, 1)];
                let t = Transcript::from_arbiter(1, &a, decks);
                assert_replay_matches(&t);
            }
            Ok(())
        })
        .unwrap();

    let (refused, attempted) = (
        REFUSALS.load(Ordering::Relaxed),
        ATTEMPTS.load(Ordering::Relaxed),
    );
    let tallies = TALLY.lock().unwrap();
    println!("random taps: {refused} refusals over {attempted} attempts");
    for (k, v) in tallies.iter() {
        println!("  {k}: {v}");
    }
    assert!(refused > 0, "random taps must exercise the refusal paths");
    if cfg!(debug_assertions) {
        for v in EVERY_REFUSAL {
            assert!(
                tallies.get(&format!("refusal:{v}")).is_some_and(|&n| n > 0),
                "Refusal::{v} never appeared"
            );
        }
        assert!(
            tallies.get("effect:Shift ok").is_some_and(|&n| n > 0),
            "no successful Shift"
        );
        assert!(
            tallies.get("effect:Destroy ok").is_some_and(|&n| n > 0),
            "no successful Destroy"
        );
    }
}

#[test]
fn goldens_replay() {
    for seed in [1u64, 2, 3] {
        let path = format!("{}/golden/seed-{seed}.json", env!("CARGO_MANIFEST_DIR"));
        let t: Transcript = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_replay_matches(&t);
    }
}
