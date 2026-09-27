//! The arena ⇄ gateway line protocol (spec D6): `@TS1 `-prefixed text lines, frames in hex. A
//! line without the prefix, or that fails to parse, is a log line. Nothing is fatal: the gateway's
//! own `println!` logs share the wire (c6-watch debug_console.rs explains why the two coexist).
pub const PREFIX: &str = "@TS1 ";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GwLine {
    Hello {
        mac: String,
        node: u8,
        fw: String,
        epoch: u8,
    },
    Rx {
        src: u8,
        rssi: i8,
        mac_ok: bool,
        bytes: Vec<u8>,
    },
    TxOk(u32),
    TxErr(u32, String),
    Roster(Vec<(u8, String, i8)>),
    Log(String),
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn parse_known(body: &str) -> Option<GwLine> {
    let mut w = body.split(' ');
    Some(match w.next()? {
        "HELLO" => GwLine::Hello {
            mac: w.next()?.into(),
            node: w.next()?.parse().ok()?,
            fw: w.next()?.into(),
            epoch: w.next()?.parse().ok()?,
        },
        "RX" => GwLine::Rx {
            src: w.next()?.parse().ok()?,
            rssi: w.next()?.parse().ok()?,
            mac_ok: w.next()? == "1",
            bytes: unhex(w.next()?)?,
        },
        "TXOK" => GwLine::TxOk(w.next()?.parse().ok()?),
        "TXERR" => GwLine::TxErr(w.next()?.parse().ok()?, w.collect::<Vec<_>>().join(" ")),
        "ROSTER" => GwLine::Roster(
            w.next()?
                .split(',')
                .map(|e| {
                    // id:aa:bb:cc:dd:ee:ff:rssi — the MAC itself contains colons.
                    let (id, rest) = e.split_once(':')?;
                    let (mac, rssi) = rest.rsplit_once(':')?;
                    Some((id.parse().ok()?, mac.to_string(), rssi.parse().ok()?))
                })
                .collect::<Option<Vec<_>>>()?,
        ),
        _ => return None,
    })
}

pub fn parse(line: &str) -> GwLine {
    let line = line.trim_end_matches(['\r', '\n']);
    line.strip_prefix(PREFIX)
        .and_then(parse_known)
        .unwrap_or_else(|| GwLine::Log(line.to_string()))
}

pub fn tx_line(tx_id: u32, dst: u8, frame: &[u8]) -> String {
    format!("{PREFIX}TX {tx_id} {dst} {}\n", hex(frame))
}

pub fn ping_line() -> String {
    format!("{PREFIX}PING\n")
}
