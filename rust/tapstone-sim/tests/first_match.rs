//! The "first match" ruleset (VR spec 2026-09-25 §3.4): castle_life 10, pressure_from 4,
//! stop_round 6, every other house rule the default. §3.4 owes two numbers before it is adopted:
//! the median match length in taps, and the bot's win rate against a play-out player.
//!
//! Picker: both seats `Style::PlayOut`, which is what the desk table's bot is
//! (`DeskShrine` builds `ScriptedSeat::new`, the default style) and what "a play-out player" names.
//! The person sits in seat 0 (the headset's `HUMAN`), so the bot is seat 1. Decks: the default
//! (asymmetric) built-in lists, as `desk_decks` builds them. Taps are committed records, claims
//! and draws included, since each one is a gesture at the table.
//!
//! The spec quotes these numbers, so this test measures them and then checks the spec says the
//! same (verification.md: a number in a document is only a measurement if a test runs the tool).
//!
//! Run: cargo test --release -p tapstone-sim --test first_match -- --nocapture
use tapstone_rules::HouseRules;
use tapstone_sim::{Style, play_seeded_styled};

fn first_match() -> HouseRules {
    HouseRules {
        castle_life: 10,
        pressure_from: 4,
        stop_round: 6,
        ..HouseRules::default()
    }
}

fn median(v: &mut [u32]) -> f64 {
    v.sort_unstable();
    let n = v.len();
    if n % 2 == 1 {
        f64::from(v[n / 2])
    } else {
        f64::from(v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

const SPEC: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/superpowers/specs/2026-09-25-tapstone-vr-design.md"
);

#[test]
fn first_match_numbers_are_the_ones_the_spec_quotes() {
    let games: u64 = 4000;
    let (mut all, mut person, mut bot) = (vec![], vec![], vec![]);
    let (mut wins, mut unfinished, mut rounds) = ([0u32; 3], 0u32, 0u64);
    for seed in 1..=games {
        let t = play_seeded_styled(seed, 500, first_match(), Style::PlayOut);
        let by = |s: u8| t.records.iter().filter(|r| r.seat == s).count() as u32;
        all.push(t.records.len() as u32);
        person.push(by(0));
        bot.push(by(1));
        rounds += u64::from(t.rounds);
        match t.winner.as_deref() {
            Some("seat0") => wins[0] += 1,
            Some("seat1") => wins[1] += 1,
            _ => wins[2] += 1,
        }
        if !t.game_over {
            unfinished += 1;
        }
    }
    let n = games as f64;
    let bot_p = f64::from(wins[1]) / n;
    let (m_all, m_person, m_bot) = (median(&mut all), median(&mut person), median(&mut bot));
    let (p10, p90) = (person[person.len() / 10], person[person.len() * 9 / 10]);
    let bot_pct = format!(
        "{:.1}% ±{:.1}",
        100.0 * bot_p,
        100.0 * 1.96 * (bot_p * (1.0 - bot_p) / n).sqrt()
    );
    println!(
        "first match (life 10, from 4, stop 6), play-out vs play-out, seeds 1..={games}: median taps \
         {m_all} ({m_person} person, p10-p90 {p10}-{p90}; {m_bot} bot), mean rounds {:.2}, \
         bot wins {bot_pct}, draws {}, unfinished {unfinished}",
        rounds as f64 / n,
        wins[2]
    );
    // The spec's sentence, rebuilt from this run; it must appear in §3.4 verbatim.
    let spec = std::fs::read_to_string(SPEC).expect("the VR spec");
    let spec = spec.split_whitespace().collect::<Vec<_>>().join(" ");
    for quoted in [
        format!(
            "median **{m_all} taps** a match ({m_person} the person's, p10–p90 {p10}–{p90}; {m_bot} the bot's)"
        ),
        format!("{:.1} rounds", rounds as f64 / n),
        format!("The bot wins **{bot_pct}**."),
    ] {
        assert!(spec.contains(&quoted), "§3.4 does not say: {quoted}");
    }
    assert_eq!(unfinished, 0);
    assert_eq!(wins[2], 0, "no draws");
}
