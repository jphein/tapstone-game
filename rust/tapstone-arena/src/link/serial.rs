//! The USB-serial gateway (spec §4). A reader thread splits lines; `poll` drains them. Port
//! discovery follows smol's BUILDING.md: Espressif vendor `303a:`, then the MAC in `HELLO`,
//! never the ttyACM number.
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::lines::{GwLine, parse, ping_line, tx_line};
use super::trace::{Dir, trace_line};
use super::{Link, Rx};

/// Set, `discover` traces the chosen gateway's lines to this file (`link::trace`).
pub const TRACE_ENV: &str = "TAPSTONE_SERIAL_TRACE";

type Trace = Arc<Mutex<Option<std::fs::File>>>;

fn trace(t: &Trace, dir: Dir, line: &str) {
    if let Ok(mut g) = t.lock()
        && let Some(f) = g.as_mut()
    {
        let us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_micros() as u64);
        let _ = f.write_all(trace_line(us, dir, line).as_bytes());
    }
}

pub const ESPRESSIF_VID: u16 = 0x303a;

pub struct SerialLink {
    tx: Box<dyn Write + Send>,
    rx: mpsc::Receiver<GwLine>,
    next_id: u32,
    pub logs: Vec<String>,
    pub hello: Option<GwLine>,
    trace: Trace,
}

impl SerialLink {
    /// Open a known path (a PTY in tests, or a port `discover` chose).
    pub fn open_path(path: &str) -> std::io::Result<SerialLink> {
        let port = serialport::new(path, 115_200)
            .timeout(Duration::from_millis(50))
            .open()
            .map_err(std::io::Error::other)?;
        let reader = port.try_clone().map_err(std::io::Error::other)?;
        let (send, rx) = mpsc::channel();
        let trace_slot: Trace = Arc::new(Mutex::new(None));
        let t = trace_slot.clone();
        std::thread::spawn(move || {
            let mut r = BufReader::new(reader);
            let mut line = String::new();
            loop {
                line.clear();
                match r.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        trace(&t, Dir::In, &line);
                        if send.send(parse(&line)).is_err() {
                            break;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                    Err(_) => break,
                }
            }
        });
        Ok(SerialLink {
            tx: Box::new(port),
            rx,
            next_id: 0,
            logs: Vec::new(),
            hello: None,
            trace: trace_slot,
        })
    }

    /// PING until a `HELLO` parses, re-sending every 500 ms, for at most `total`; the `HELLO` is
    /// also kept in `hello`. More than once because the first line after the port opens can carry
    /// a stale prefix: on katana's S3 the answer arrived as `@TS1 @TS1 HELLO …` (a line cut off in
    /// the USB-Serial-JTAG FIFO while no host read it) and parsed as a log.
    pub fn await_hello(&mut self, total: Duration) -> Option<GwLine> {
        let deadline = std::time::Instant::now() + total;
        let mut next_ping = std::time::Instant::now();
        while std::time::Instant::now() < deadline {
            if std::time::Instant::now() >= next_ping {
                self.ping();
                next_ping += Duration::from_millis(500);
            }
            match self.rx.recv_timeout(Duration::from_millis(20)) {
                Ok(h @ GwLine::Hello { .. }) => {
                    self.hello = Some(h.clone());
                    return Some(h);
                }
                Ok(GwLine::Log(s)) => self.logs.push(s),
                _ => {}
            }
        }
        None
    }

    /// Ask the gateway for a `HELLO` (it answers every `PING`).
    pub fn ping(&mut self) {
        let line = ping_line();
        trace(&self.trace, Dir::Out, &line);
        let _ = self.tx.write_all(line.as_bytes());
    }

    /// Append every line written to or read from this gateway, from now on, to `path`, each
    /// stamped with the wall clock in µs (`link::trace`).
    pub fn trace_to(&mut self, path: &std::path::Path) -> std::io::Result<()> {
        let f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        *self
            .trace
            .lock()
            .map_err(|_| std::io::Error::other("trace lock"))? = Some(f);
        Ok(())
    }

    /// Open the gateway at `path` and nothing else, and require its `HELLO` to carry `mac`
    /// (config `gateway_port`). The port is traced as `discover` traces the one it chooses.
    pub fn open_checked(path: &str, mac: &str) -> Result<(String, SerialLink), String> {
        let mut link = SerialLink::open_path(path).map_err(|e| format!("{path}: {e}"))?;
        match link.await_hello(Duration::from_secs(5)) {
            Some(GwLine::Hello { mac: m, .. }) if m.eq_ignore_ascii_case(mac) => {}
            Some(GwLine::Hello { mac: m, .. }) => {
                return Err(format!("{path} answered HELLO with MAC {m}, not {mac}"));
            }
            _ => return Err(format!("{path} sent no HELLO in 5 s")),
        }
        if let Some(trace) = std::env::var_os(TRACE_ENV) {
            link.trace_to(std::path::Path::new(&trace))
                .map_err(|e| format!("{TRACE_ENV}: {e}"))?;
        }
        Ok((path.to_string(), link))
    }

    /// Find the gateway whose `HELLO` carries `mac` among Espressif USB ports. This PINGs every
    /// Espressif port it tries: prefer `open_checked` (config `gateway_port`) wherever another
    /// Espressif board shares the host.
    pub fn discover(mac: &str) -> Result<(String, SerialLink), String> {
        let ports = serialport::available_ports().map_err(|e| e.to_string())?;
        for p in ports {
            let serialport::SerialPortType::UsbPort(info) = &p.port_type else {
                continue;
            };
            if info.vid != ESPRESSIF_VID {
                continue; // e.g. katana's ttyACM1 is a keyboard (1209:2201)
            }
            let Ok(mut link) = SerialLink::open_path(&p.port_name) else {
                continue;
            };
            if let Some(GwLine::Hello { mac: m, .. }) = link.await_hello(Duration::from_secs(2))
                && m.eq_ignore_ascii_case(mac)
            {
                // Only the chosen port is traced: a port merely probed is another gateway.
                if let Some(path) = std::env::var_os(TRACE_ENV) {
                    link.trace_to(std::path::Path::new(&path))
                        .map_err(|e| format!("{TRACE_ENV}: {e}"))?;
                }
                return Ok((p.port_name.clone(), link));
            }
        }
        Err(format!("no Espressif USB port answered with MAC {mac}"))
    }
}

impl Link for SerialLink {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        self.next_id = self.next_id.wrapping_add(1);
        let line = tx_line(self.next_id, dst, frame);
        trace(&self.trace, Dir::Out, &line);
        let _ = self.tx.write_all(line.as_bytes());
    }

    fn poll(&mut self, _now: u64) -> Vec<Rx> {
        let mut out = Vec::new();
        while let Ok(l) = self.rx.try_recv() {
            match l {
                GwLine::Rx {
                    src,
                    rssi,
                    mac_ok,
                    bytes,
                } => out.push(Rx {
                    src,
                    rssi,
                    mac_ok,
                    bytes,
                }),
                GwLine::Log(s) => self.logs.push(s),
                h @ GwLine::Hello { .. } => self.hello = Some(h),
                GwLine::TxErr(id, why) => self.logs.push(format!("tx {id} failed: {why}")),
                GwLine::TxOk(_) | GwLine::Roster(_) => {}
            }
        }
        out
    }
}
