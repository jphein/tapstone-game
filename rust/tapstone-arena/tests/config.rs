use tapstone_arena::config::Config;

#[test]
fn defaults_bind_loopback_on_7790_and_no_key_can_be_configured() {
    let c: Config = toml::from_str(r#"gateway_mac = "ac:a7:04:b9:77:14""#).unwrap();
    assert_eq!(c.http_bind, "127.0.0.1:7790");
    assert!(c.sinks.is_empty());
    // Spec §17 default 3: no fleet group key on the arena in playtest one. Neither a key value nor a
    // key file parses, so a key cannot be configured by accident.
    assert!(toml::from_str::<Config>("gateway_mac = \"x\"\ngroup_key = \"secret\"").is_err());
    assert!(toml::from_str::<Config>("gateway_mac = \"x\"\ngroup_key_file = \"/k\"").is_err());
}

#[test]
fn the_default_ledger_follows_xdg_and_never_tmp() {
    let p = tapstone_arena::config::ledger_path(None)
        .expect("this environment's default is not under /tmp");
    assert!(p.ends_with("tapstone/ledger.sqlite"), "{}", p.display());
    assert!(
        !p.starts_with("/tmp") && !p.starts_with("/var/tmp"),
        "{}",
        p.display()
    );
}

/// (F, the lead after #78) The ledger path resolves from $XDG_DATA_HOME, falls back to
/// ~/.local/share, and is REFUSED anywhere under /tmp or /var/tmp (JP's rule: valuables never
/// live there), whether it came from XDG or from an explicit `ledger_path`.
#[test]
fn the_ledger_path_resolves_from_xdg_and_refuses_tmp() {
    use std::path::{Path, PathBuf};
    use tapstone_arena::config::resolve_ledger;
    let home = Some(Path::new("/home/user"));
    let ok = |explicit: Option<&str>, xdg: Option<&str>| {
        resolve_ledger(explicit.map(PathBuf::from), xdg.map(Path::new), home)
    };
    assert_eq!(
        ok(None, Some("/data")),
        Ok(PathBuf::from("/data/tapstone/ledger.sqlite"))
    );
    assert_eq!(
        ok(None, None),
        Ok(PathBuf::from(
            "/home/user/.local/share/tapstone/ledger.sqlite"
        ))
    );
    assert_eq!(
        ok(None, Some("relative/dir")),
        Ok(PathBuf::from(
            "/home/user/.local/share/tapstone/ledger.sqlite"
        )),
        "a relative XDG_DATA_HOME is ignored, as the XDG spec says"
    );
    assert_eq!(
        ok(Some("/srv/l.sqlite"), Some("/tmp")),
        Ok(PathBuf::from("/srv/l.sqlite")),
        "explicit wins"
    );
    for bad in ["/tmp", "/tmp/x", "/var/tmp", "/var/tmp/claude/y"] {
        assert!(
            ok(None, Some(bad)).is_err(),
            "XDG_DATA_HOME={bad} must be refused"
        );
        assert!(
            ok(Some(&format!("{bad}/l.sqlite")), None).is_err(),
            "ledger_path under {bad} must be refused"
        );
    }
    assert!(
        ok(Some("/tmpfoo/l.sqlite"), None).is_ok(),
        "a prefix match is not a parent: /tmpfoo is fine"
    );
    // Oracle's bypasses of a lexical check (on #84): `..` through an existing directory, and a
    // relative path, which resolves against whatever the cwd is (it may be /tmp).
    for bad in ["/home/user/../../tmp/l.sqlite", "/var/../tmp/l.sqlite"] {
        assert!(
            ok(Some(bad), None).is_err(),
            "{bad} resolves under /tmp and must be refused"
        );
    }
    assert!(
        ok(None, Some("/home/user/../../tmp")).is_err(),
        "an XDG_DATA_HOME that resolves to /tmp is refused"
    );
    // Refused BECAUSE it is relative, whatever the cwd happens to be (the reason is asserted: a cwd
    // under /var/tmp, as on familiar, would refuse it for another reason and hide a missing check).
    for rel in ["l.sqlite", "./x/l.sqlite"] {
        let e = ok(Some(rel), None).expect_err("a relative ledger_path is refused");
        assert!(
            e.contains("must be absolute"),
            "{rel}: refused, but not for being relative: {e}"
        );
    }
}

/// A symlink into /tmp is refused, because the check runs on the canonical path. The link itself
/// lives under $HOME, not under /tmp, so only resolving it can find /tmp. The control: a symlink to a
/// directory outside /tmp is accepted.
#[test]
fn a_symlink_into_tmp_is_refused_and_one_elsewhere_is_not() {
    use std::path::PathBuf;
    use tapstone_arena::config::resolve_ledger;
    let home = PathBuf::from(std::env::var_os("HOME").expect("HOME"));
    let dir = tempfile::Builder::new()
        .prefix(".tapstone-ledger-test-")
        .tempdir_in(&home)
        .unwrap();
    assert!(
        !dir.path().starts_with("/tmp") && !dir.path().starts_with("/var/tmp"),
        "the test dir is outside /tmp"
    );
    let into_tmp = dir.path().join("to-tmp");
    std::os::unix::fs::symlink("/tmp", &into_tmp).unwrap();
    let elsewhere = dir.path().join("to-home");
    std::os::unix::fs::symlink(&home, &elsewhere).unwrap();
    assert!(
        resolve_ledger(Some(into_tmp.join("l.sqlite")), None, None).is_err(),
        "a symlink into /tmp is refused"
    );
    assert!(
        resolve_ledger(Some(elsewhere.join("sub/l.sqlite")), None, None).is_ok(),
        "control: a symlink to a directory outside /tmp is accepted"
    );
}

/// (T, Oracle on #84) An enabled sink whose URL still holds `{token}` after substitution (its token
/// file missing or unreadable) refuses to start, rather than retrying a request that can never
/// authenticate, silently and forever. The message names the sink and never the URL, which may
/// hold a real token for another sink's substitution. A disabled sink is left as written.
#[test]
fn a_sink_without_its_token_refuses_to_start() {
    use tapstone_arena::config::{Config, resolve_sinks};
    let dir = tempfile::Builder::new()
        .prefix(".tapstone-sink-test-")
        .tempdir_in(std::env::var_os("HOME").unwrap())
        .unwrap();
    let tok = dir.path().join("scry.token");
    std::fs::write(&tok, "s3cr3t-token\n").unwrap();
    let cfg = |token_file: &str, enabled: bool| -> Config {
        toml::from_str(&format!(
            "gateway_mac = \"x\"\n[[sinks]]\nname = \"scry\"\nurl = \"http://h/m/{{id}}?k={{token}}\"\nenabled = {enabled}\n[token_files]\nscry = \"{token_file}\"\n"
        ))
        .unwrap()
    };
    let good = resolve_sinks(&cfg(tok.to_str().unwrap(), true)).expect("the token is read");
    assert_eq!(
        good[0].url, "http://h/m/{id}?k=s3cr3t-token",
        "the token is substituted and trimmed"
    );
    let missing = dir.path().join("absent.token");
    let e = resolve_sinks(&cfg(missing.to_str().unwrap(), true))
        .expect_err("no token: refuse to start");
    assert!(e.contains("scry"), "the message names the sink: {e}");
    assert!(
        !e.contains("http://") && !e.contains("k="),
        "the message never shows the URL: {e}"
    );
    assert!(
        resolve_sinks(&cfg(missing.to_str().unwrap(), false)).is_ok(),
        "a disabled sink is not checked"
    );
}

/// An EMPTY token (a 0-byte file, or one holding only whitespace) is refused like a missing one.
/// Otherwise it would substitute to `k=`, fail auth on every post, and retry silently forever.
/// The control: a real one-character token is accepted.
#[test]
fn an_empty_token_file_refuses_to_start() {
    use tapstone_arena::config::{Config, resolve_sinks};
    let dir = tempfile::Builder::new()
        .prefix(".tapstone-sink-test-")
        .tempdir_in(std::env::var_os("HOME").unwrap())
        .unwrap();
    let cfg = |token_file: &std::path::Path| -> Config {
        toml::from_str(&format!(
            "gateway_mac = \"x\"\n[[sinks]]\nname = \"scry\"\nurl = \"http://h/m/{{id}}?k={{token}}\"\nenabled = true\n[token_files]\nscry = \"{}\"\n",
            token_file.display()
        ))
        .unwrap()
    };
    for (name, body) in [
        ("zero.token", ""),
        ("newline.token", "\n"),
        ("spaces.token", "  \t\n"),
    ] {
        let f = dir.path().join(name);
        std::fs::write(&f, body).unwrap();
        let e = resolve_sinks(&cfg(&f)).expect_err("an empty token refuses to start");
        assert!(
            e.contains("scry") && e.contains("empty"),
            "{name}: names the sink and says why: {e}"
        );
        assert!(!e.contains("http://"), "{name}: never the URL: {e}");
    }
    // A disabled sink is left as written, empty token or not.
    let zero = dir.path().join("zero.token");
    let mut off = cfg(&zero);
    off.sinks[0].enabled = false;
    assert!(
        resolve_sinks(&off).is_ok(),
        "a disabled sink with an empty token is not checked"
    );
    let one = dir.path().join("one.token");
    std::fs::write(&one, "x\n").unwrap();
    assert_eq!(
        resolve_sinks(&cfg(&one)).unwrap()[0].url,
        "http://h/m/{id}?k=x",
        "control: a real token is used"
    );
}

// The gateway's port (tapstone#132 table, 2026-09-29): a configured by-id path is read as given,
// and a config without one still parses (the arena then scans, as before).
#[test]
fn gateway_port_is_optional_and_read_as_given() {
    let c: Config = toml::from_str("gateway_mac = \"14:c1:9f:d1:c6:38\"").unwrap();
    assert_eq!(c.gateway_port, None);
    let c: Config = toml::from_str(
        "gateway_mac = \"14:c1:9f:d1:c6:38\"\ngateway_port = \"/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_14:C1:9F:D1:C6:38-if00\"\n",
    )
    .unwrap();
    assert_eq!(
        c.gateway_port.as_deref(),
        Some(std::path::Path::new(
            "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_14:C1:9F:D1:C6:38-if00"
        ))
    );
}
