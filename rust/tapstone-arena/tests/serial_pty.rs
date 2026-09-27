//! A pseudo-terminal stands in for the gateway board: the arena opens the slave side by path; the
//! test plays the firmware on the master side.
use std::io::{BufRead, BufReader, Write};
use std::os::fd::{AsRawFd, FromRawFd};

use nix::pty::openpty;
use tapstone_arena::link::Link;
use tapstone_arena::link::serial::SerialLink;

#[test]
fn frames_cross_a_pty_in_both_directions_and_logs_are_skipped() {
    let pty = openpty(None, None).unwrap();
    let slave_path = nix::unistd::ttyname(&pty.slave).unwrap();
    let master = unsafe { std::fs::File::from_raw_fd(pty.master.as_raw_fd()) };
    std::mem::forget(pty.master);
    let mut fw_out = master.try_clone().unwrap();
    let mut fw_in = BufReader::new(master);

    let mut link = SerialLink::open_path(slave_path.to_str().unwrap()).unwrap();
    // Firmware → arena: a log line, then a frame.
    fw_out
        .write_all(b"I (12) boot: hello\n@TS1 RX 163 -40 1 534d4f4c\n")
        .unwrap();
    let mut got = Vec::new();
    for _ in 0..100 {
        got.extend(link.poll(0));
        if !got.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(got.len(), 1, "the log line is not a frame");
    assert_eq!((got[0].src, got[0].bytes.as_slice()), (163, &b"SMOL"[..]));
    // A frame whose group MAC did not verify is still delivered, flagged: the MAC is in observe
    // mode fleet-wide (protocol §7), so dropping unverified frames would drop every frame today.
    fw_out.write_all(b"@TS1 RX 164 -50 0 4d41\n").unwrap();
    let mut more = Vec::new();
    for _ in 0..100 {
        more.extend(link.poll(0));
        if !more.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(more.len(), 1, "an unverified frame is not dropped");
    assert_eq!(
        (more[0].src, more[0].mac_ok),
        (164, false),
        "and it is flagged"
    );
    // Arena → firmware.
    link.send(255, b"\x01\x02");
    let mut line = String::new();
    fw_in.read_line(&mut line).unwrap();
    assert!(
        line.starts_with("@TS1 TX ") && line.trim_end().ends_with(" 255 0102"),
        "{line:?}"
    );
}

/// `trace_to`: every line read and written, stamped, in the format `link::trace` joins. A frame
/// sent and a frame received both appear, each once, with the wall clock of now.
#[test]
fn the_serial_trace_records_both_directions_with_the_wall_clock() {
    use tapstone_arena::link::trace::{Dir, join, parse_trace};
    let pty = openpty(None, None).unwrap();
    let slave_path = nix::unistd::ttyname(&pty.slave).unwrap();
    let master = unsafe { std::fs::File::from_raw_fd(pty.master.as_raw_fd()) };
    std::mem::forget(pty.master);
    let mut fw_out = master.try_clone().unwrap();
    let mut fw_in = BufReader::new(master);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("trace.txt");

    let mut link = SerialLink::open_path(slave_path.to_str().unwrap()).unwrap();
    link.trace_to(&path).unwrap();
    let t0 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_micros() as u64;
    link.send(62, b"\xaa\xbb");
    let mut line = String::new();
    fw_in.read_line(&mut line).unwrap();
    fw_out
        .write_all(b"@TS1 TXOK 1\n@TS1 RX 62 -40 1 aabb\n")
        .unwrap();
    let mut got = Vec::new();
    for _ in 0..100 {
        got.extend(link.poll(0));
        if !got.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(got.len(), 1);
    std::thread::sleep(std::time::Duration::from_millis(20));
    let t = parse_trace(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let lines: Vec<(Dir, &str)> = t.iter().map(|e| (e.dir, e.line.as_str())).collect();
    assert_eq!(
        lines,
        vec![
            (Dir::Out, "@TS1 TX 1 62 aabb"),
            (Dir::In, "@TS1 TXOK 1"),
            (Dir::In, "@TS1 RX 62 -40 1 aabb"),
        ]
    );
    assert!(
        t.iter().all(|e| e.t_us >= t0 && e.t_us < t0 + 10_000_000),
        "{t:?}"
    );
    // The trace joins with itself as a loopback: the frame sent is the frame heard.
    let leg = join(&t, &t, 1_000_000);
    assert_eq!((leg.tx, leg.txok, leg.delivered, leg.lost), (1, 1, 1, 0));
}

/// The first line after the port opens can carry a stale prefix (katana, 2026-09-26: the S3's
/// USB-Serial-JTAG FIFO held `@TS1 ` from a line cut off while no host read it, so the answer to
/// PING arrived as `@TS1 @TS1 HELLO …` and parsed as a log). `await_hello` asks again until one
/// parses, so one mangled answer cannot hide a gateway.
#[test]
fn await_hello_pings_again_when_the_first_answer_is_mangled() {
    use std::time::Duration;
    use tapstone_arena::link::lines::GwLine;
    let pty = openpty(None, None).unwrap();
    let slave_path = nix::unistd::ttyname(&pty.slave).unwrap();
    let master = unsafe { std::fs::File::from_raw_fd(pty.master.as_raw_fd()) };
    std::mem::forget(pty.master);
    let mut fw_out = master.try_clone().unwrap();
    let mut fw_in = BufReader::new(master);
    // The firmware: the first PING's HELLO is mangled, every later one is whole.
    let fw = std::thread::spawn(move || {
        let mut pings = 0;
        let mut line = String::new();
        while pings < 2 && fw_in.read_line(&mut line).is_ok() {
            if line.trim_end() == "@TS1 PING" {
                pings += 1;
                let prefix = if pings == 1 { "@TS1 " } else { "" };
                let hello = format!("{prefix}@TS1 HELLO 14:c1:9f:d1:c6:38 61 1f400a7 1\n");
                fw_out.write_all(hello.as_bytes()).unwrap();
            }
            line.clear();
        }
        // Hand the port back open: a closed master hangs up the slave before it reads the answer.
        (pings, fw_out)
    });
    let mut link = SerialLink::open_path(slave_path.to_str().unwrap()).unwrap();
    let hello = link.await_hello(Duration::from_secs(3));
    assert!(
        matches!(hello, Some(GwLine::Hello { node: 61, .. })),
        "no HELLO after a mangled first answer: {hello:?}"
    );
    assert_eq!(fw.join().unwrap().0, 2, "it pinged twice");
}
