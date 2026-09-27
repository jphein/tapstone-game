//! `radio_shrine` — a desk-style shrine behind a real gateway, standing in for the shrine firmware
//! (tapstone#132 item 1; runbook docs/runbooks/radio-match.md).
//!   radio_shrine registry --deck tide-neutral            # a scratch copies.jsonl for its copies
//!   radio_shrine play --port /dev/serial/by-id/…C0:88… --deck tide-neutral --trace b.trace
//!   radio_shrine report --arena a.trace --shrine b.trace # frames and latency, both directions
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use tapstone_arena::link::Link;
use tapstone_arena::link::lines::GwLine;
use tapstone_arena::link::radio::{RadioShrine, registry_rows};
use tapstone_arena::link::serial::SerialLink;
use tapstone_arena::link::trace::{Leg, join, parse_trace};
use tapstone_rules::HouseRules;
use tapstone_sim::deck::load_named;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print registry rows for shrine `index` holding `deck` (its figurine and every copy).
    Registry {
        #[arg(long)]
        deck: String,
        #[arg(long, default_value_t = 0)]
        index: usize,
    },
    /// Play one match through the gateway on `port`, then exit once its RESULT is heard.
    Play {
        /// The gateway's port, by MAC: /dev/serial/by-id/usb-Espressif_…_<MAC>-if00.
        #[arg(long)]
        port: String,
        #[arg(long)]
        deck: String,
        #[arg(long, default_value_t = 0)]
        index: usize,
        #[arg(long, default_value_t = 11)]
        seed: u64,
        /// The arena gateway's node (its HELLO id): where frames for the arena go.
        #[arg(long)]
        arena_node: u8,
        /// Append every serial line, stamped, here (`link::trace`).
        #[arg(long)]
        trace: Option<PathBuf>,
        /// Propose nothing: the stall control.
        #[arg(long)]
        no_propose: bool,
        /// Give up after this many seconds (exit 3).
        #[arg(long, default_value_t = 900)]
        deadline_s: u64,
        /// After RESULT, keep answering this long, so the arena's linger sees the final ACKs.
        #[arg(long, default_value_t = 6)]
        linger_s: u64,
        /// Write a JSON summary (the shrine's own chain head, counts) here.
        #[arg(long)]
        summary: Option<PathBuf>,
    },
    /// Join the arena's and the shrine's traces: per direction, frames sent, delivered, lost, and
    /// host-to-host latency.
    Report {
        #[arg(long)]
        arena: PathBuf,
        #[arg(long)]
        shrine: PathBuf,
        /// An RX may be matched to a TX of the same bytes at most this long before it.
        #[arg(long, default_value_t = 1_000_000)]
        window_us: u64,
    },
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn leg_line(name: &str, l: &Leg) -> String {
    let q = |x: f64| {
        l.quantile(x)
            .map_or("-".into(), |v| format!("{:.1}", v as f64 / 1000.0))
    };
    format!(
        "{name}: tx {} txok {} txerr {} unanswered {} delivered {} lost {} (air {}, txerr {}, unanswered {}) after_close {} foreign_rx {} src_mismatch {} sender_logs {} | latency ms p50 {} p95 {} max {} (n {})",
        l.tx,
        l.txok,
        l.txerr.len(),
        l.unanswered,
        l.delivered,
        l.lost,
        l.air_lost(),
        l.lost_txerr,
        l.lost_unanswered,
        l.after_close,
        l.foreign_rx,
        l.src_mismatch,
        l.logs,
        q(0.5),
        q(0.95),
        q(1.0),
        l.latency_us.len()
    )
}

fn read_trace(p: &PathBuf) -> Result<Vec<tapstone_arena::link::trace::Entry>, String> {
    let text = std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
    parse_trace(&text)
}

fn main() -> std::process::ExitCode {
    match run(Cli::parse()) {
        Ok(code) => std::process::ExitCode::from(code),
        Err(e) => {
            eprintln!("radio_shrine: {e}");
            std::process::ExitCode::from(2)
        }
    }
}

fn run(cli: Cli) -> Result<u8, String> {
    match cli.cmd {
        Cmd::Registry { deck, index } => {
            let d = load_named(&deck, &HouseRules::default()).map_err(|e| e.to_string())?;
            print!("{}", registry_rows(index, &d));
            Ok(0)
        }
        Cmd::Report {
            arena,
            shrine,
            window_us,
        } => {
            let (a, s) = (read_trace(&arena)?, read_trace(&shrine)?);
            let down = join(&a, &s, window_us);
            let up = join(&s, &a, window_us);
            println!("{}", leg_line("arena->shrine", &down));
            println!("{}", leg_line("shrine->arena", &up));
            for (id, why) in down.txerr.iter().chain(&up.txerr) {
                println!("txerr {id}: {why}");
            }
            // Nothing delivered one way means the instrument saw nothing: not a pass.
            Ok(if down.delivered > 0 && up.delivered > 0 {
                0
            } else {
                1
            })
        }
        Cmd::Play {
            port,
            deck,
            index,
            seed,
            arena_node,
            trace,
            no_propose,
            deadline_s,
            linger_s,
            summary,
        } => play(PlayArgs {
            port,
            deck,
            index,
            seed,
            arena_node,
            trace,
            no_propose,
            deadline_s,
            linger_s,
            summary,
        }),
    }
}

struct PlayArgs {
    port: String,
    deck: String,
    index: usize,
    seed: u64,
    arena_node: u8,
    trace: Option<PathBuf>,
    no_propose: bool,
    deadline_s: u64,
    linger_s: u64,
    summary: Option<PathBuf>,
}

fn play(a: PlayArgs) -> Result<u8, String> {
    let d = load_named(&a.deck, &HouseRules::default()).map_err(|e| e.to_string())?;
    // serialport opens with TIOCEXCL, and the arena's `discover` leaves a port it merely probed
    // open until that port's next line ends the probe's reader thread: wait that out.
    let t_open = Instant::now();
    let mut link = loop {
        match SerialLink::open_path(&a.port) {
            Ok(l) => break l,
            Err(e) if t_open.elapsed() < Duration::from_secs(5) => {
                println!("{}: {e}; retrying", a.port);
                std::thread::sleep(Duration::from_millis(250));
            }
            Err(e) => return Err(format!("{}: {e}", a.port)),
        }
    };
    if let Some(t) = &a.trace {
        link.trace_to(t)
            .map_err(|e| format!("{}: {e}", t.display()))?;
    }
    // Our own node, from the gateway's HELLO.
    let Some(GwLine::Hello { node, mac, fw, .. }) = link.await_hello(Duration::from_secs(3)) else {
        return Err(format!("{}: no HELLO in 3 s", a.port));
    };
    println!("gateway {mac} node {node} fw {fw} on {}", a.port);
    let mut s = RadioShrine::new(a.seed, a.index, node, &d, a.arena_node);
    println!(
        "radio shrine: index {} deck {} castle {} -> arena node {}{}",
        a.index,
        a.deck,
        d.castle,
        a.arena_node,
        if a.no_propose {
            " (no-propose control)"
        } else {
            ""
        }
    );
    let deadline = Duration::from_secs(a.deadline_s);
    let (mut sent, mut heard) = (0u64, 0u64);
    let mut result_at: Option<Instant> = None;
    let mut last_status = Instant::now();
    let (mut seat_said, mut logs_seen) = (None, 0usize);
    let start = Instant::now();
    loop {
        let now = start.elapsed().as_millis() as u64;
        let mut out = Vec::new();
        for rx in link.poll(now) {
            heard += 1;
            out.extend(s.rx(&rx));
        }
        out.extend(s.tick(now, a.no_propose));
        for (dst, bytes) in out {
            link.send(dst, &bytes);
            sent += 1;
        }
        for l in &link.logs[logs_seen..] {
            if l.starts_with("tx ") {
                println!("[gw] {l}"); // a TXERR
            }
        }
        logs_seen = link.logs.len();
        let sh = &s.shrine;
        if seat_said != sh.seat() {
            seat_said = sh.seat();
            println!(
                "seat {:?} in match {:08x}",
                seat_said,
                sh.follower.begun().unwrap_or(0)
            );
        }
        if last_status.elapsed() >= Duration::from_secs(5) {
            last_status = Instant::now();
            let g = &sh.follower.game;
            println!(
                "t {:.0}s phase {:?} round {} active {} next_mseq {} proposed {} sent {sent} heard {heard}",
                start.elapsed().as_secs_f64(),
                g.phase,
                g.round,
                g.active,
                sh.follower.next_mseq(),
                sh.proposed.len()
            );
        }
        if sh.heard_result && result_at.is_none() {
            result_at = Some(Instant::now());
            println!(
                "RESULT heard: match {:08x} head {} next_mseq {} winner {:?} round {}",
                sh.follower.begun().unwrap_or(0),
                hex(&sh.follower.head_hash()),
                sh.follower.next_mseq(),
                sh.follower.game.winner,
                sh.follower.game.round
            );
        }
        let lingered = result_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(a.linger_s));
        let timed_out = start.elapsed() >= deadline;
        if lingered || timed_out {
            let g = &sh.follower.game;
            let json = serde_json::json!({
                "node": node,
                "arena_node": a.arena_node,
                "deck": a.deck,
                "index": a.index,
                "no_propose": a.no_propose,
                "match_id": format!("{:08x}", sh.follower.begun().unwrap_or(0)),
                "seat": sh.seat(),
                "heard_result": sh.heard_result,
                "head": hex(&sh.follower.head_hash()),
                "next_mseq": sh.follower.next_mseq(),
                "phase": format!("{:?}", g.phase),
                "round": g.round,
                "winner": format!("{:?}", g.winner),
                "proposed": sh.proposed.len(),
                "refused": sh.refused,
                "stale_rejects": sh.stale_rejects,
                "false_confirms": sh.false_confirms,
                "halted": sh.follower.halted().is_some(),
                "frames_sent": sent,
                "frames_heard": heard,
                "gateway_txerr": link.logs.iter().filter(|l| l.starts_with("tx ")).count(),
                "seconds": start.elapsed().as_secs_f64(),
            });
            println!("summary {json}");
            if let Some(p) = &a.summary {
                let mut f =
                    std::fs::File::create(p).map_err(|e| format!("{}: {e}", p.display()))?;
                writeln!(f, "{json:#}").map_err(|e| e.to_string())?;
            }
            if lingered {
                return Ok(0);
            }
            println!(
                "STALLED: no RESULT in {} s (phase {:?}, next_mseq {})",
                a.deadline_s,
                g.phase,
                sh.follower.next_mseq()
            );
            return Ok(3);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
