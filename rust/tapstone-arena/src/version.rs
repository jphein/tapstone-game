//! realm-sigil's `/api/version` contract (`realm-sigil/go/sigil.go:31-46`). The Rust crate is
//! names-only, so the fields are filled here; the name comes from `realm_sigil::name_for_hex`.
use std::sync::OnceLock;
use std::time::{Instant, SystemTime};

static STARTED: OnceLock<(Instant, SystemTime)> = OnceLock::new();

pub const REPO: &str = "https://github.com/jphein/tapstone-game";

pub fn mark_started() {
    STARTED.get_or_init(|| (Instant::now(), SystemTime::now()));
}

pub fn version_json() -> serde_json::Value {
    mark_started();
    let (t0, wall) = STARTED.get().copied().unwrap();
    let hash = env!("ARENA_GIT_HASH");
    let started = humantime_rfc3339(wall);
    let host = std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    serde_json::json!({
        "name": "Tapstone Arena",
        "description": "Arbiter, battlefield and ledger for a Tapstone table (0028)",
        "version": version_label(hash),
        "hash": hash,
        "branch": env!("ARENA_GIT_BRANCH"),
        "dirty": env!("ARENA_GIT_DIRTY") == "true",
        "built": env!("ARENA_BUILT"),
        "started": started,
        "uptime": t0.elapsed().as_secs(),
        "realm": "fantasy",
        "runtime": env!("ARENA_RUSTC"),
        "os": format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
        "host": host,
        "pid": std::process::id(),
        "repo": REPO,
        "commit_url": if hash == "dev" { String::new() } else { format!("{REPO}/commit/{hash}") },
    })
}

/// RFC 3339 UTC without a date crate: seconds since the epoch, converted by civil-from-days.
fn humantime_rfc3339(t: SystemTime) -> String {
    let secs = t
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// `"<Adjective> <Noun> · <hash>"` for a stamped build. An unstamped build (`dev`, no git at build
/// time) publishes no sigil at all, per realm-sigil's own rule (`name_for_hex` docs, realm-sigil #9):
/// the tolerant parse would name `dev` differently from the Python binding.
pub fn version_label(hash: &str) -> String {
    if hash == "dev" || hash.is_empty() {
        return "Tapstone Arena · dev".into();
    }
    let (adj, noun) = realm_sigil::name_for_hex(hash, &realm_sigil::FANTASY);
    format!("{adj} {noun} · {hash}")
}

#[cfg(test)]
mod tests {
    use super::version_label;

    #[test]
    fn a_stamped_build_is_named_and_an_unstamped_one_is_not() {
        let (adj, noun) = realm_sigil::name_for_hex("a6c3e30", &realm_sigil::FANTASY);
        assert_eq!(version_label("a6c3e30"), format!("{adj} {noun} · a6c3e30"));
        assert_eq!(
            version_label("dev"),
            "Tapstone Arena · dev",
            "no sigil for an unstamped build"
        );
    }
}
