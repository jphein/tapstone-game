use std::process::Command;

fn git(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn main() {
    let hash = git(&["rev-parse", "--short=7", "HEAD"]);
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"]);
    let dirty = !git(&["status", "--porcelain"]).is_empty();
    println!(
        "cargo:rustc-env=ARENA_GIT_HASH={}",
        if hash.is_empty() { "dev" } else { &hash }
    );
    println!("cargo:rustc-env=ARENA_GIT_BRANCH={branch}");
    println!("cargo:rustc-env=ARENA_GIT_DIRTY={dirty}");
    let built = Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=ARENA_BUILT={built}");
    let rustc = Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=ARENA_RUSTC={rustc}");
    // Watch git's own paths, which `--git-path` resolves correctly in a worktree too (there `.git`
    // is a file). HEAD moves on checkout; logs/HEAD grows on every commit, which HEAD alone (a
    // `ref:` line) does not show. `dirty` is refreshed only when one of these moves.
    for p in ["HEAD", "logs/HEAD"] {
        let path = git(&["rev-parse", "--git-path", p]);
        if !path.is_empty() {
            println!("cargo:rerun-if-changed={path}");
        }
    }
}
