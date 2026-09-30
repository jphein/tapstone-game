//! `~/.config/tapstone-arena/arena.toml` (spec §11). Secrets are FILES (0600, populated from
//! Vaultwarden with `bw`); a secret value written into the TOML is a parse error.
use std::path::PathBuf;

use serde::Deserialize;

use crate::poster::Sink;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub gateway_mac: String,
    /// The gateway's port, as a path (use `/dev/serial/by-id/…<MAC>…`, never a ttyACM number).
    /// Set, the arena opens THAT port alone and requires its `HELLO` to carry `gateway_mac`: it
    /// never scans. Unset, it scans every Espressif USB port for `gateway_mac`, which writes a
    /// `@TS1 PING` to each one it tries, and at a table with a scry (another Espressif board
    /// that must not be written to) that is not acceptable. The radio runners always set it.
    #[serde(default)]
    pub gateway_port: Option<PathBuf>,
    #[serde(default = "default_bind")]
    pub http_bind: String,
    #[serde(default)]
    pub ledger_path: Option<PathBuf>,
    #[serde(default)]
    pub registry_path: Option<PathBuf>,
    #[serde(default)]
    pub decks_dir: Option<PathBuf>,
    #[serde(default)]
    pub flat: bool,
    #[serde(default)]
    pub sinks: Vec<Sink>,
    /// Token files per sink name, e.g. `scry = "~/.config/tapstone-arena/scry.token"`.
    #[serde(default)]
    pub token_files: std::collections::BTreeMap<String, PathBuf>,
}

fn default_bind() -> String {
    "127.0.0.1:7790".into()
}

pub fn default_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".config/tapstone-arena/arena.toml")
}

/// The ledger file, from the environment: an explicit `ledger_path` if configured, else
/// `$XDG_DATA_HOME/tapstone/ledger.sqlite`, else `~/.local/share/tapstone/ledger.sqlite`. Never the
/// repo, and never under /tmp or /var/tmp (spec §8, §17 default 1; JP's rule): those are refused.
pub fn ledger_path(explicit: Option<PathBuf>) -> Result<PathBuf, String> {
    let xdg = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    resolve_ledger(explicit, xdg.as_deref(), home.as_deref())
}

/// `ledger_path` without the environment, so it can be tested. A relative XDG_DATA_HOME is ignored,
/// as the XDG spec says.
pub fn resolve_ledger(
    explicit: Option<PathBuf>,
    xdg: Option<&std::path::Path>,
    home: Option<&std::path::Path>,
) -> Result<PathBuf, String> {
    let p = match explicit {
        Some(p) => p,
        None => {
            let base = match xdg.filter(|p| p.is_absolute()) {
                Some(x) => x.to_path_buf(),
                None => home
                    .map(|h| h.join(".local/share"))
                    .ok_or("no HOME and no XDG_DATA_HOME")?,
            };
            base.join("tapstone/ledger.sqlite")
        }
    };
    if p.is_relative() {
        // A relative path resolves against whatever the cwd is, and that may be /tmp.
        return Err(format!("{}: the ledger path must be absolute", p.display()));
    }
    let real = canonical_as_far_as_exists(&p)?;
    // By path component, on the canonical path, so `..`, symlinks and /tmpfoo are all judged by
    // where the file would really live. /tmp and /var/tmp may be symlinks themselves.
    for tmp in ["/tmp", "/var/tmp"] {
        let tmp_real = std::fs::canonicalize(tmp).unwrap_or_else(|_| PathBuf::from(tmp));
        if real.starts_with(tmp) || real.starts_with(&tmp_real) {
            return Err(format!(
                "{}: the ledger holds JP's commanders and may not live under {tmp}",
                p.display()
            ));
        }
    }
    Ok(p)
}

/// `path` with its deepest existing ancestor canonicalised (resolving `..` and symlinks), and the
/// part that does not exist yet appended as written. A `..` in that part cannot be resolved, so
/// it is refused.
fn canonical_as_far_as_exists(path: &std::path::Path) -> Result<PathBuf, String> {
    for base in path.ancestors() {
        if let Ok(real) = std::fs::canonicalize(base) {
            let rest = path.strip_prefix(base).unwrap_or(std::path::Path::new(""));
            if rest
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err(format!(
                    "{}: `..` below a directory that does not exist",
                    path.display()
                ));
            }
            return Ok(real.join(rest));
        }
    }
    Err(format!("{}: no part of this path exists", path.display()))
}

/// The sinks with their tokens filled in from `token_files` (`{token}` in a URL). An enabled sink
/// whose URL still holds `{token}` afterwards (its token file missing or unreadable) is refused, so
/// the arena does not start and retry a request that can never authenticate, silently and forever.
/// The message names the sink and its `token_files` entry, never the URL.
pub fn resolve_sinks(cfg: &Config) -> Result<Vec<Sink>, String> {
    cfg.sinks
        .iter()
        .cloned()
        .map(|mut s| {
            let token = cfg.token_files.get(&s.name).and_then(|p| std::fs::read_to_string(p).ok());
            match token.as_deref().map(str::trim) {
                Some(t) if !t.is_empty() => s.url = s.url.replace("{token}", t),
                // An empty token would substitute to `k=` and fail auth on every post, forever.
                Some(_) if s.enabled && s.url.contains("{token}") => {
                    return Err(format!(
                        "sink {:?}: its token file (token_files.{}) is empty; refusing to start",
                        s.name, s.name
                    ));
                }
                _ => {}
            }
            if s.enabled && s.url.contains("{token}") {
                return Err(format!(
                    "sink {:?}: its token is missing (token_files.{} unset or unreadable); refusing to start",
                    s.name, s.name
                ));
            }
            Ok(s)
        })
        .collect()
}
