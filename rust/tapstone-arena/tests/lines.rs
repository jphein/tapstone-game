use tapstone_arena::link::lines::{GwLine, parse, ping_line, tx_line};

#[test]
fn every_gateway_line_parses() {
    assert_eq!(
        parse("@TS1 HELLO ac:a7:04:b9:77:14 200 1a2b3c4d 7"),
        GwLine::Hello {
            mac: "ac:a7:04:b9:77:14".into(),
            node: 200,
            fw: "1a2b3c4d".into(),
            epoch: 7
        }
    );
    assert_eq!(
        parse("@TS1 RX 163 -48 1 534d4f4c7631204d41544348200141"),
        GwLine::Rx {
            src: 163,
            rssi: -48,
            mac_ok: true,
            bytes: b"SMOLv1 MATCH \x01A".to_vec()
        }
    );
    assert_eq!(parse("@TS1 TXOK 42"), GwLine::TxOk(42));
    assert_eq!(
        parse("@TS1 TXERR 42 no-peer"),
        GwLine::TxErr(42, "no-peer".into())
    );
    assert_eq!(
        parse("@TS1 ROSTER 163:ac:a7:04:00:00:01:-40,164:ac:a7:04:00:00:02:-55"),
        GwLine::Roster(vec![
            (163, "ac:a7:04:00:00:01".into(), -40),
            (164, "ac:a7:04:00:00:02".into(), -55)
        ])
    );
}

#[test]
fn anything_else_is_a_log_line_including_near_misses() {
    for l in [
        "I (123) smol: I am Eldritch Jewel (id 8)",
        "@TS2 RX 1 2 3 00",
        "@TS1 RX 163 -48 1 zz",
        "@TS1 RX 163",
        "",
    ] {
        assert!(
            matches!(parse(l), GwLine::Log(_)),
            "{l:?} should be a log line"
        );
    }
}

#[test]
fn arena_lines_are_one_line_each() {
    assert_eq!(tx_line(7, 255, b"\x00\xff"), "@TS1 TX 7 255 00ff\n");
    assert_eq!(ping_line(), "@TS1 PING\n");
}
