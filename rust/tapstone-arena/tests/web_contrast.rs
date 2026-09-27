//! The battlefield page's contrast, read from its own CSS (web/style.css), in both themes.
//!
//! The page declares every text colour as a `--X-ink` token drawn on a ground token that prefixes
//! its name (`--band-idle-ink` on `--band-idle`, `--tile-rim-ink` on `--tile`), and draws with
//! exactly those tokens. So the pairs the page shows are the pairs checked here — one object — and
//! a re-theme that breaks legibility fails the build. Floors: 4.5:1 for text, 3:1 for a `-rim-`
//! (a non-text edge) and for the faction rims, which carry ownership (spec §9).

use std::collections::BTreeMap;

const CSS: &str = include_str!("../web/style.css");

/// Custom properties of the first `:root { … }` block (the dark default) and of the `:root` inside
/// `@media (prefers-color-scheme: light)`, as raw values.
fn blocks(css: &str) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
    let props = |body: &str| {
        body.split(';')
            .filter_map(|decl| {
                // Drop comments, then keep only custom properties.
                let decl = decl.split("*/").last().unwrap_or(decl);
                let (k, v) = decl.split_once(':')?;
                let k = k.trim();
                k.starts_with("--")
                    .then(|| (k.to_string(), v.trim().to_string()))
            })
            .collect::<BTreeMap<_, _>>()
    };
    let body = |from: usize| {
        let open = css[from..].find('{').unwrap() + from + 1;
        let close = css[open..].find('}').unwrap() + open;
        &css[open..close]
    };
    let dark = props(body(css.find(":root").unwrap()));
    let media = css
        .find("@media (prefers-color-scheme: light)")
        .expect("a light theme");
    let light_root = css[media..].find(":root").unwrap() + media;
    let mut light = dark.clone();
    light.extend(props(body(light_root)));
    (dark, light)
}

/// Resolve `var(--x)` chains to a `#rrggbb` colour.
fn resolve(theme: &BTreeMap<String, String>, v: &str) -> Option<[u8; 3]> {
    let v = v.trim();
    if let Some(inner) = v.strip_prefix("var(").and_then(|s| s.strip_suffix(')')) {
        return resolve(theme, theme.get(inner.trim())?);
    }
    let h = v.strip_prefix('#')?;
    let h = if h.len() == 3 {
        h.chars().flat_map(|c| [c, c]).collect::<String>()
    } else {
        h.to_string()
    };
    let n = u32::from_str_radix(&h, 16).ok()?;
    Some([(n >> 16) as u8, (n >> 8) as u8, n as u8])
}

fn luminance(c: [u8; 3]) -> f64 {
    let f = |v: u8| {
        let x = v as f64 / 255.0;
        if x <= 0.03928 {
            x / 12.92
        } else {
            ((x + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}

fn contrast(a: [u8; 3], b: [u8; 3]) -> f64 {
    let (x, y) = (luminance(a), luminance(b));
    let (hi, lo) = if x > y { (x, y) } else { (y, x) };
    (hi + 0.05) / (lo + 0.05)
}

/// Every ink token's failures in one theme: below its floor, unresolvable, or with no ground.
fn failures(theme_name: &str, theme: &BTreeMap<String, String>) -> Vec<String> {
    let mut out = Vec::new();
    for (ink, value) in theme.iter().filter(|(k, _)| k.ends_with("-ink")) {
        let stem = ink.trim_end_matches("-ink");
        // The ground is the longest token prefixing the stem at a '-' boundary.
        let ground = theme
            .keys()
            .filter(|g| {
                !g.ends_with("-ink") && (stem == g.as_str() || stem.starts_with(&format!("{g}-")))
            })
            .max_by_key(|g| g.len());
        let Some(ground) = ground else {
            out.push(format!("{theme_name}: {ink} names no ground token"));
            continue;
        };
        let (Some(fg), Some(bg)) = (resolve(theme, value), resolve(theme, &theme[ground])) else {
            out.push(format!(
                "{theme_name}: {ink} or {ground} does not resolve to a colour"
            ));
            continue;
        };
        let floor = if ink.contains("-rim-") { 3.0 } else { 4.5 };
        let c = contrast(fg, bg);
        if c < floor {
            out.push(format!(
                "{theme_name}: {ink} on {ground} is {c:.2}:1, under {floor}:1"
            ));
        }
    }
    // The faction rims carry ownership on every unit (spec §9): 3:1 against the tile.
    for rim in ["--ember", "--tide", "--neutral"] {
        let (Some(fg), Some(bg)) = (
            resolve(theme, &theme[rim]),
            resolve(theme, &theme["--tile"]),
        ) else {
            out.push(format!("{theme_name}: {rim} or --tile does not resolve"));
            continue;
        };
        let c = contrast(fg, bg);
        if c < 3.0 {
            out.push(format!(
                "{theme_name}: faction rim {rim} on --tile is {c:.2}:1, under 3:1"
            ));
        }
    }
    out
}

fn all_failures(css: &str) -> Vec<String> {
    let (dark, light) = blocks(css);
    let mut f = failures("dark", &dark);
    f.extend(failures("light", &light));
    f
}

#[test]
fn every_ink_on_the_page_clears_its_floor_in_both_themes() {
    let f = all_failures(CSS);
    assert!(f.is_empty(), "{}", f.join("\n"));
}

/// The check sees what it claims: it found the pairs the page draws with, in both themes.
#[test]
fn the_check_reads_the_pairs_the_page_draws() {
    let (dark, light) = blocks(CSS);
    for t in [&dark, &light] {
        for ink in [
            "--band-idle-ink",
            "--band-active-ink",
            "--tile-ink",
            "--tile-rim-ink",
            "--board-ink",
            "--banner-ink",
            "--bg-dim-ink",
        ] {
            assert!(
                t.contains_key(ink),
                "{ink} missing: the page and the check disagree"
            );
        }
    }
    assert_ne!(
        dark["--bg"], light["--bg"],
        "the light block did not override: the check is reading one theme twice"
    );
    let app = include_str!("../web/app.js");
    for ink in [
        "--band-idle-ink",
        "--band-active-ink",
        "--tile-ink",
        "--tile-rim-ink",
        "--board-ink",
    ] {
        assert!(
            app.contains(ink),
            "app.js does not draw with {ink}: the pair is checked but not used"
        );
    }
}

/// Control: plant the defect this test exists for — the inactive band's ink set back to the
/// band's own ground colour (dark `--grid`, the shape the page first shipped at 1.5:1) — and the
/// check must fail.
#[test]
fn control_a_planted_bad_token_fails() {
    let planted = CSS.replacen(
        "--band-idle-ink: var(--text);",
        "--band-idle-ink: #2c3642;",
        1,
    );
    assert!(
        planted != CSS,
        "the planted edit did not apply: the control would test nothing"
    );
    let f = all_failures(&planted);
    assert!(
        f.iter().any(|m| m.contains("--band-idle-ink")),
        "a 1.3:1 band went unnoticed: {f:?}"
    );
    // And an ink with no ground fails closed rather than being skipped.
    let orphan = CSS.replacen(
        "color-scheme: dark;",
        "--orphan-ink: #000000;\n  color-scheme: dark;",
        1,
    );
    assert!(orphan != CSS, "the orphan edit did not apply");
    assert!(
        all_failures(&orphan)
            .iter()
            .any(|m| m.contains("--orphan-ink names no ground"))
    );
}
