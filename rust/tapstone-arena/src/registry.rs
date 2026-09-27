//! The copy registry (`registry/copies.jsonl`, card-data-format.md): tag UID → design index.
//! The arena resolves every tapped UID here (protocol §3: "resolved by the arbiter from the UID
//! registry"). `Trusting` believes the record's `card` field, for desk mode and tests only.
use std::collections::HashMap;

use serde::Deserialize;

#[derive(Deserialize)]
struct Row {
    uid: String,
    design: String,
}

pub enum Registry {
    Strict(HashMap<[u8; 7], u16>),
    Trusting,
}

fn parse_uid(s: &str) -> Option<[u8; 7]> {
    let hex: String = s.chars().filter(|c| *c != ':').collect();
    if hex.len() != 14 {
        return None;
    }
    let mut out = [0u8; 7];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

/// `st1-003` → 3. Anything else (a demo row, another game's slug) is not a Tapstone design.
fn parse_design(s: &str) -> Option<u16> {
    let (set, n) = s.split_once('-')?;
    if !set.starts_with("st") || n.len() != 3 {
        return None;
    }
    n.parse().ok()
}

impl Registry {
    pub fn from_jsonl(text: &str) -> Result<Registry, String> {
        let mut map = HashMap::new();
        for (i, line) in text
            .lines()
            .enumerate()
            .filter(|(_, l)| !l.trim().is_empty())
        {
            let row: Row =
                serde_json::from_str(line).map_err(|e| format!("line {}: {e}", i + 1))?;
            let uid = parse_uid(&row.uid)
                .ok_or_else(|| format!("line {}: bad uid {:?}", i + 1, row.uid))?;
            if let Some(d) = parse_design(&row.design) {
                map.insert(uid, d);
            }
        }
        Ok(Registry::Strict(map))
    }

    pub fn load(path: &std::path::Path) -> Result<Registry, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        Self::from_jsonl(&text)
    }

    pub fn resolve(&self, uid: [u8; 7]) -> Option<u16> {
        match self {
            Registry::Strict(m) => m.get(&uid).copied(),
            Registry::Trusting => None,
        }
    }

    /// The design for a tap: the registry's in strict mode, the proposal's `card` when trusting.
    pub fn resolve_or(&self, uid: [u8; 7], proposed: u16) -> Option<u16> {
        match self {
            Registry::Strict(_) => self.resolve(uid),
            Registry::Trusting => Some(proposed),
        }
    }

    /// Teach a strict registry a virtual copy (the remote seat's figurine and copies, 0038). It is
    /// refused if the UID already names a registered copy, so a virtual copy can never shadow a
    /// real one. A trusting registry believes every proposal already, so it has nothing to learn.
    /// In memory only: `copies.jsonl` is never written.
    pub fn add_virtual(&mut self, uid: [u8; 7], design: u16) -> Result<(), String> {
        match self {
            Registry::Strict(m) => {
                if m.contains_key(&uid) {
                    let hex: Vec<String> = uid.iter().map(|b| format!("{b:02X}")).collect();
                    return Err(format!(
                        "virtual uid {} is a registered copy",
                        hex.join(":")
                    ));
                }
                m.insert(uid, design);
                Ok(())
            }
            Registry::Trusting => Ok(()),
        }
    }

    pub fn len(&self) -> usize {
        match self {
            Registry::Strict(m) => m.len(),
            Registry::Trusting => 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
