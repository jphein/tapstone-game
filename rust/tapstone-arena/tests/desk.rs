use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Unsigned};
use tapstone_arena::link::Link;
use tapstone_arena::link::desk::DeskLink;
use tapstone_arena::registry::Registry;

#[test]
fn a_desk_match_runs_the_real_core_to_a_result() {
    let (mut link, book, stats) = DeskLink::new(11);
    let cfg = CoreConfig {
        node: tapstone_arena::link::desk::ARENA_NODE,
        rules: Default::default(),
        ruleset: 1,
        registry_id: 2,
        flat: false,
        epoch_unix: 0,
    };
    let mut core = ArenaCore::new(
        cfg,
        Box::new(stats),
        book,
        Registry::Trusting,
        Box::new(Unsigned),
    );
    let mut result = None;
    for step in 0..20_000u64 {
        let now = step * 10;
        let mut inputs: Vec<Input> = link
            .poll(now)
            .into_iter()
            .map(|r| Input::Frame {
                src: r.src,
                rssi: r.rssi,
                mac_ok: r.mac_ok,
                bytes: r.bytes,
            })
            .collect();
        inputs.push(Input::Tick);
        for i in inputs {
            for o in core.handle(i, now) {
                match o {
                    Output::Send { dst, frame } => link.send(dst, &frame),
                    Output::MatchOver(m) => result = Some(m),
                    _ => {}
                }
            }
        }
        if result.is_some() {
            break;
        }
    }
    let m = result.expect("the desk match ended");
    assert!(tapstone_sim::replay(&m.json).unwrap().matches(&m.json));
}
