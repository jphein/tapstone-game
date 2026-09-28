//! `tapstone-arena` — run the arena for one table.
//!   tapstone-arena                 # gateway on USB serial, config from ~/.config/tapstone-arena
//!   tapstone-arena --desk          # two scripted shrines in process, no radio (spec §9)
//!   tapstone-arena --desk --remote tide-neutral --ledger <new file>   # a desk match, journaled
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use clap::Parser;
use tapstone_arena::config::{Config, default_path, ledger_path, resolve_sinks};
use tapstone_arena::core::{ArenaCore, CoreConfig, Input, Output, Signer, StatsSource, Unsigned};
use tapstone_arena::decks::DeckBook;
use tapstone_arena::http::{AppState, DevCmd, router};
use tapstone_arena::ledger::Ledger;
use tapstone_arena::link::Link;
use tapstone_arena::link::desk::{ARENA_NODE, DeskLink};
use tapstone_arena::link::lines::GwLine;
use tapstone_arena::link::serial::SerialLink;
use tapstone_arena::poster::{Sink, drain_once, enqueue_match};
use tapstone_arena::registry::Registry;
use tapstone_proto::frame::{FRAME_MAX, Frame, Header, Tap};
use tapstone_rules::{Kind, Record};
use tokio::sync::{mpsc, watch};

use std::sync::{Arc, Mutex};

use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::link::remote::{GuestStats, MAX_SLOTS, RemoteLink, credit};
use tapstone_arena::remote::{Hub, RemoteCmd, RemoteState, remote_router};
use tapstone_rules::HouseRules;
use tapstone_sim::deck::{Deck, load_named};
use tokio::sync::Notify;

#[derive(Parser)]
struct Cli {
    #[arg(long)]
    config: Option<PathBuf>,
    /// Two scripted shrines in process; no gateway, and no ledger file unless `--ledger`.
    #[arg(long)]
    desk: bool,
    /// Desk mode only: journal to a scratch ledger at this absolute path, which must not exist yet,
    /// so a desk match can be checked afterwards like a radio one (`radio_verify.py`; the scry tap
    /// bridge's replay, docs/runbooks/radio-match.md). Never a real ledger: gateway mode's is the
    /// config's `ledger_path`.
    #[arg(long)]
    ledger: Option<PathBuf>,
    #[arg(long, default_value_t = 11)]
    desk_seed: u64,
    /// Append every view the board is sent to this file, one JSON line each (a canvas fixture).
    #[arg(long)]
    record: Option<PathBuf>,
    /// Exit after the first match ends and its RESULT linger closes.
    #[arg(long)]
    once: bool,
    /// A remote seat (0038) holding this deck: an exact stem under `decks/`, e.g. `ember-neutral`.
    /// Once beside the bot or a real shrine; twice for two remote slots and no bot (two players,
    /// both in Roblox: `--desk --remote ember-neutral --remote tide-neutral`). Slot k is the k-th given.
    #[arg(long)]
    remote: Vec<String>,
    /// The remote seat's own listener, `/remote/*` only: the one port a tunnel may expose.
    #[arg(long, default_value = "127.0.0.1:7791")]
    remote_bind: String,
    /// The board listener's address, overriding desk mode's 127.0.0.1:7790 or the config's
    /// `http_bind`: two arenas on one host (a smoke beside a playtest) must not share it.
    #[arg(long)]
    bind: Option<String>,
}

/// Everything one table needs, built for desk or gateway mode.
struct Parts {
    link: Box<dyn Link>,
    core: ArenaCore,
    /// The ledger and its path (the poster opens its own connection to the same file).
    ledger: Option<(Ledger, PathBuf)>,
    bind: String,
    sinks: Vec<Sink>,
    /// Frames the core produced before the loop started (recovery's `J`).
    pending: Vec<(u8, Vec<u8>)>,
    /// The remote slots' figurines, the guests the ledger never credits (spec §6).
    remote_figurines: Vec<[u8; 7]>,
}

fn unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Every remote slot's figurine, in slot order (none without a remote seat).
fn figurines(link: &mut dyn Link) -> Vec<[u8; 7]> {
    link.remote()
        .map(|r| (0..r.slots()).map(|k| r.figurine_at(k)).collect())
        .unwrap_or_default()
}

fn desk_parts(seed: u64, remotes: &[Deck]) -> Parts {
    let (mut desk, mut book, stats) = DeskLink::new(seed);
    let mut link: Box<dyn Link> = match remotes.len() {
        0 => Box::new(desk),
        n => {
            // The Roblox side's test table: one slot plays the desk bot on shrine 0 from the
            // second chair; two slots play each other with both desk shrines off. A fresh match
            // after each result, for the next join.
            desk.off[1] = true;
            desk.off[0] = n == 2;
            desk.shrines[0].rematch = true;
            for deck in remotes {
                book.push(deck.clone());
            }
            Box::new(RemoteLink::with_slots(desk, seed, remotes))
        }
    };
    let remote_figurines = figurines(link.as_mut());
    let cfg = CoreConfig {
        node: ARENA_NODE,
        rules: Default::default(),
        ruleset: 1,
        registry_id: 0,
        flat: false,
        epoch_unix: unix() as u32,
    };
    let core = ArenaCore::new(
        cfg,
        Box::new(stats),
        book,
        Registry::Trusting,
        Box::new(Unsigned),
    );
    Parts {
        link,
        core,
        ledger: None,
        bind: "127.0.0.1:7790".into(),
        sinks: vec![],
        pending: vec![],
        remote_figurines,
    }
}

/// Desk mode's scratch ledger (`--ledger`): the same guard as gateway mode's (absolute, never under
/// /tmp or /var/tmp), and a file that does not exist yet, so a desk run can never write into a real
/// ledger's commanders.
fn desk_ledger(path: &std::path::Path) -> Result<(Ledger, PathBuf), String> {
    let path = ledger_path(Some(path.to_path_buf()))?;
    if path.exists() {
        return Err(format!(
            "{}: a desk ledger is scratch, and this file exists",
            path.display()
        ));
    }
    let l = Ledger::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    println!("desk ledger at {}", path.display());
    Ok((l, path))
}

fn gateway_parts(path: PathBuf, remotes: &[Deck]) -> Result<Parts, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let cfg: Config = toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let (port, serial) = SerialLink::discover(&cfg.gateway_mac)?;
    let Some(GwLine::Hello { node, .. }) = serial.hello.clone() else {
        return Err("the gateway sent no HELLO".into());
    };
    println!("gateway {} on {port}, node {node}", cfg.gateway_mac);
    let registry_path = cfg
        .registry_path
        .clone()
        .unwrap_or_else(|| PathBuf::from("registry/copies.jsonl"));
    let mut registry = Registry::load(&registry_path)?;
    let book = DeckBook::load_repo()?;
    // Spec §11: RESULT is unsigned in playtest one (sig_kind 0), a recorded known gap.
    let signer: Box<dyn Signer + Send> = Box::new(Unsigned);
    let ledger_path = ledger_path(cfg.ledger_path.clone())?;
    let sinks = resolve_sinks(&cfg)?;
    let mut link: Box<dyn Link> = if remotes.is_empty() {
        Box::new(serial)
    } else {
        // A strict registry resolves every claim and card (lobby.rs, play.rs): the slots stamp
        // their casts with a copy's UID, and the registry learns their virtual copies.
        Box::new(RemoteLink::at_gateway(serial, 0, remotes, &mut registry)?)
    };
    let remote_figurines = figurines(link.as_mut());
    // Two connections to one WAL file: the core's StatsSource reads and equips; the loop journals
    // and applies results. busy_timeout=5000 covers their overlap. A remote slot's figurine is a
    // guest the ledger never writes (spec §6).
    let ledger_stats = Ledger::open(&ledger_path).map_err(|e| e.to_string())?;
    let stats: Box<dyn StatsSource + Send> = if remote_figurines.is_empty() {
        Box::new(ledger_stats)
    } else {
        Box::new(GuestStats {
            inner: ledger_stats,
            guest: remote_figurines.clone(),
        })
    };
    let ledger = Ledger::open(&ledger_path).map_err(|e| e.to_string())?;
    let hash = env!("ARENA_GIT_HASH");
    let core_cfg = CoreConfig {
        node,
        rules: Default::default(),
        ruleset: u32::from_str_radix(hash, 16).unwrap_or(0),
        registry_id: 0,
        flat: cfg.flat,
        epoch_unix: unix() as u32,
    };
    let mut pending = Vec::new();
    let core = match ledger.in_flight().map_err(|e| e.to_string())? {
        Some(rec) => {
            println!("resuming match {:08x} from the journal", rec.match_id);
            let (core, out) = ArenaCore::recover(core_cfg, stats, book, registry, signer, rec, 0);
            for o in out {
                if let Output::Send { dst, frame } = o {
                    pending.push((dst, frame));
                }
            }
            core
        }
        None => ArenaCore::new(core_cfg, stats, book, registry, signer),
    };
    Ok(Parts {
        link,
        core,
        ledger: Some((ledger, ledger_path)),
        bind: cfg.http_bind.clone(),
        sinks,
        pending,
        remote_figurines,
    })
}

/// The open join codes on stdout: `remote join code: X` for one slot (as the smoke and the docs
/// read it), `remote join code (slot K): X` per slot for two.
fn print_codes(h: &Hub) {
    for k in 0..h.slots() {
        if h.slots() == 1 {
            println!("remote join code: {}", h.code_of(k));
        } else {
            println!("remote join code (slot {k}): {}", h.code_of(k));
        }
    }
}

/// A dev-route tap, as a `T` frame from the seat's own node (one path for dev and real taps).
fn dev_tap_frame(core: &ArenaCore, cmd: &DevCmd, lseq: u16) -> Option<(u8, Vec<u8>)> {
    let DevCmd::Tap {
        seat,
        kind,
        card,
        lane,
        target,
        aux,
    } = cmd
    else {
        return None;
    };
    let node = core.seat_node(*seat)?;
    let kind = match kind.as_str() {
        "Mulligan" => Kind::Mulligan,
        "Charge" => Kind::Charge,
        "CastUnit" => Kind::CastUnit,
        "CastSpell" => Kind::CastSpell,
        "Advance" => Kind::Advance,
        "Pass" => Kind::Pass,
        _ => return None,
    };
    let record = Record {
        seq: 0,
        seat: *seat,
        kind,
        card: *card,
        lane: *lane,
        target: *target,
        aux: *aux,
        time_ms: 0,
        uid: [0; 7],
        auth: 0,
    };
    let mut buf = [0u8; FRAME_MAX];
    let n = Frame::Tap(Tap::Propose { lseq, record }).encode(
        &Header {
            match_id: 0,
            src: node,
        },
        &mut buf,
    );
    Some((node, buf[..n].to_vec()))
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let cli = Cli::parse();
    tapstone_arena::version::mark_started();
    if cli.remote.len() > MAX_SLOTS {
        return Err(format!(
            "--remote given {} times: a table has {MAX_SLOTS} seats",
            cli.remote.len()
        ));
    }
    let remote_decks = cli
        .remote
        .iter()
        .map(|stem| load_named(stem, &HouseRules::default()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<Deck>, String>>()?;
    let remote = !remote_decks.is_empty();
    let mut parts = if cli.desk {
        let mut p = desk_parts(cli.desk_seed, &remote_decks);
        if let Some(path) = &cli.ledger {
            p.ledger = Some(desk_ledger(path)?);
        }
        p
    } else if cli.ledger.is_some() {
        return Err(
            "--ledger is for desk mode: gateway mode's ledger is the config's ledger_path".into(),
        );
    } else {
        gateway_parts(cli.config.unwrap_or_else(default_path), &remote_decks)?
    };
    if let Some(bind) = &cli.bind {
        parts.bind = bind.clone();
    }
    for (dst, frame) in parts.pending.drain(..) {
        parts.link.send(dst, &frame);
    }

    let (view_tx, view_rx) =
        watch::channel(serde_json::to_string(&parts.core.view()).unwrap_or_default());
    let (dev_tx, mut dev_rx) = mpsc::channel::<DevCmd>(16);
    let app = router(AppState {
        views: view_rx,
        dev: dev_tx,
    });
    let listener = tokio::net::TcpListener::bind(&parts.bind)
        .await
        .map_err(|e| format!("{}: {e}", parts.bind))?;
    println!("board at http://{}/", parts.bind);
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await;
    });

    // The remote seat's listener (0038): its own port, /remote/* only, never the board's.
    let hub = Arc::new(Mutex::new(Hub::with_slots(
        StdRng::from_os_rng(),
        remote_decks.len().max(1),
    )));
    let notify = Arc::new(Notify::new());
    let (remote_tx, mut remote_rx) = mpsc::channel::<RemoteCmd>(16);
    if remote {
        if cli.remote_bind == parts.bind {
            return Err(format!(
                "--remote-bind {} is the board's own port (0038)",
                cli.remote_bind
            ));
        }
        let app = remote_router(RemoteState {
            hub: hub.clone(),
            views: notify.clone(),
            cmds: remote_tx,
            wait: Duration::from_secs(10),
        });
        let listener = tokio::net::TcpListener::bind(&cli.remote_bind)
            .await
            .map_err(|e| format!("{}: {e}", cli.remote_bind))?;
        println!(
            "remote seat at http://{}/remote/ (tunnel this port, never the board's)",
            cli.remote_bind
        );
        print_codes(&hub.lock().unwrap());
        tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await;
        });
    }

    let t0 = Instant::now();
    let mut tick = tokio::time::interval(Duration::from_millis(10));
    let mut last_drain = 0u64;
    let mut dev_lseq = 10_000u16; // dev taps use their own lseq range
    let mut unverified = 0u64;
    let mut desk_seed = cli.desk_seed;
    let mut record = match &cli.record {
        Some(p) => Some(std::fs::File::create(p).map_err(|e| format!("{}: {e}", p.display()))?),
        None => None,
    };
    let mut over_seen = false;
    loop {
        tick.tick().await;
        let now = t0.elapsed().as_millis() as u64;
        // The remote slots (0038): let each claim once joined, and send what its player chose.
        if let Some(r) = parts.link.remote() {
            let joined: Vec<bool> = {
                let h = hub.lock().unwrap();
                (0..r.slots()).map(|k| h.is_joined(k)).collect()
            };
            r.gate_slots(&joined, &parts.core.seated());
            while let Ok(cmd) = remote_rx.try_recv() {
                let (slot, tap) = cmd.slot_tap();
                if !r.propose_at(slot, now, tap) {
                    println!(
                        "[remote] slot {slot}'s proposal was not sent (not its move, or a tap pending)"
                    );
                }
            }
        }
        let mut inputs: Vec<Input> = parts
            .link
            .poll(now)
            .into_iter()
            .map(|r| Input::Frame {
                src: r.src,
                rssi: r.rssi,
                mac_ok: r.mac_ok,
                bytes: r.bytes,
            })
            .collect();
        while let Ok(cmd) = dev_rx.try_recv() {
            match &cmd {
                DevCmd::Desk if cli.desk => {
                    desk_seed += 1;
                    let ledger = parts.ledger.take();
                    parts = desk_parts(desk_seed, &remote_decks);
                    parts.ledger = ledger;
                    if remote {
                        let mut h = hub.lock().unwrap();
                        h.new_match();
                        print_codes(&h);
                    }
                    println!("[dev] new desk match, seed {desk_seed}");
                }
                DevCmd::Desk => println!("[dev] a desk match needs --desk"),
                DevCmd::Tap { .. } => {
                    dev_lseq = dev_lseq.wrapping_add(1);
                    match dev_tap_frame(&parts.core, &cmd, dev_lseq) {
                        Some((src, bytes)) => inputs.push(Input::Frame {
                            src,
                            rssi: 0,
                            mac_ok: true,
                            bytes,
                        }),
                        None => println!("[dev] {cmd:?}: no seated node or unknown kind"),
                    }
                }
            }
        }
        inputs.push(Input::Tick);
        for input in inputs {
            // Tap-to-board, arena side (plan-1's 300 ms; spec §13): from handing a T to the core to
            // publishing the view it caused. The radio leg is added at the table.
            let is_tap =
                matches!(&input, Input::Frame { bytes, .. } if bytes.get(14) == Some(&b'T'));
            if let Input::Frame { mac_ok: false, .. } = &input {
                unverified += 1;
                if unverified.is_power_of_two() {
                    println!(
                        "{unverified} frames without a verified group-MAC (observe mode, protocol §7)"
                    );
                }
            }
            let t_in = Instant::now();
            for o in parts.core.handle(input, now) {
                if is_tap && matches!(o, Output::View(_)) {
                    println!("tap→view {} µs", t_in.elapsed().as_micros());
                }
                match o {
                    // D10: outputs run in order, so a commit is journaled before it is sent.
                    Output::Journal(j) => {
                        if let Some((l, _)) = parts.ledger.as_mut() {
                            l.journal(&j).map_err(|e| format!("journal: {e}"))?;
                        }
                    }
                    Output::Send { dst, frame } => parts.link.send(dst, &frame),
                    Output::View(mut v) => {
                        if remote {
                            let codes = hub.lock().unwrap().open_codes();
                            v.remote_code = codes.first().cloned();
                            v.remote_codes = codes;
                        }
                        let json = serde_json::to_string(&v).unwrap_or_default();
                        if remote {
                            hub.lock().unwrap().publish_view(&json);
                            notify.notify_waiters();
                        }
                        if let Some(f) = record.as_mut() {
                            use std::io::Write;
                            writeln!(f, "{json}").map_err(|e| format!("record: {e}"))?;
                        }
                        let _ = view_tx.send(json);
                    }
                    Output::MatchOver(m) => {
                        println!("match {:08x} over, winner {:?}", m.match_id, m.winner);
                        over_seen = true;
                        if let Some((l, _)) = parts.ledger.as_mut() {
                            let ev = l
                                .apply_result_credit(
                                    m.match_id,
                                    &m.result,
                                    m.figurines,
                                    m.winner,
                                    m.round,
                                    // A desk table's commanders are FixedStats, never ledger
                                    // rows: its scratch ledger (`--ledger`) credits nobody.
                                    if cli.desk {
                                        [false; 2]
                                    } else {
                                        credit(m.figurines, &parts.remote_figurines)
                                    },
                                )
                                .map_err(|e| e.to_string())?;
                            println!("ledger: {ev:?}");
                            enqueue_match(l, m.match_id, &m.tsx1, &m.json, unix() as i64)
                                .map_err(|e| e.to_string())?;
                            // Spec §8: a backup after every result; this file is JP's commanders.
                            if let Err(e) = l.backup(m.match_id, 20) {
                                println!("ledger backup failed: {e}");
                            }
                            // The stations' result screens (0032) read the new XP, level and
                            // inventory from a fresh D, one per seat.
                            for seat in 0..2u8 {
                                if let Some(doll) =
                                    StatsSource::doll(l, m.figurines[seat as usize], seat)
                                {
                                    let mut buf = [0u8; FRAME_MAX];
                                    let n = Frame::Doll(doll).encode(
                                        &Header {
                                            match_id: m.match_id,
                                            src: parts.core.node(),
                                        },
                                        &mut buf,
                                    );
                                    parts.link.send(m.nodes[seat as usize], &buf[..n]);
                                }
                            }
                        }
                        if remote {
                            let mut h = hub.lock().unwrap();
                            h.new_match();
                            print_codes(&h);
                        }
                    }
                    Output::Log(s) => println!("{s}"),
                }
            }
        }
        if let Some(r) = parts.link.remote() {
            // Each slot's menu, and the seat its shrine holds (None before its claim lands).
            let mut h = hub.lock().unwrap();
            for k in 0..r.slots() {
                let (menu, taps) = r.menu_at(k);
                h.set_menu_at(k, menu, taps);
                h.set_seat_at(k, r.seat_at(k));
            }
        }
        if cli.once && over_seen && !parts.core.lingering() {
            println!("--once: the match is over and delivered");
            return Ok(());
        }
        // Drain the outbox on a blocking thread every 5 s, so a slow or asleep sink can never
        // stall the arbiter (spec D14).
        if let Some((_, path)) = parts.ledger.as_ref()
            && !parts.sinks.is_empty()
            && now - last_drain >= 5_000
        {
            last_drain = now;
            let (path, sinks) = (path.clone(), parts.sinks.clone());
            tokio::task::spawn_blocking(move || {
                if let Ok(mut l) = Ledger::open(&path) {
                    drain_once(&mut l, &sinks, unix() as i64);
                }
            });
        }
    }
}
