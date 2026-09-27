use std::net::SocketAddr;

use tapstone_arena::http::{AppState, DevCmd, router};
use tokio::sync::{mpsc, watch};

async fn serve() -> (SocketAddr, watch::Sender<String>, mpsc::Receiver<DevCmd>) {
    let (view_tx, view_rx) = watch::channel(r#"{"phase":"lobby"}"#.to_string());
    let (dev_tx, dev_rx) = mpsc::channel(8);
    let app = router(AppState {
        views: view_rx,
        dev: dev_tx,
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    (addr, view_tx, dev_rx)
}

fn get(addr: SocketAddr, path: &str) -> (u16, String) {
    let r = ureq::get(&format!("http://{addr}{path}")).call();
    match r {
        Ok(resp) => (resp.status(), resp.into_string().unwrap()),
        Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
        Err(e) => panic!("{e}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_page_has_a_favicon_and_both_themes() {
    let (addr, _v, _d) = serve().await;
    let (code, html) = tokio::task::spawn_blocking(move || get(addr, "/"))
        .await
        .unwrap();
    assert_eq!(code, 200);
    assert!(
        html.contains(r#"rel="icon""#) && html.contains("favicon.svg"),
        "JP's web rule: an SVG favicon"
    );
    let (_, css) = tokio::task::spawn_blocking(move || get(addr, "/style.css"))
        .await
        .unwrap();
    assert!(
        css.contains("prefers-color-scheme: light"),
        "JP's web rule: dark and light"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn api_version_carries_realm_sigils_sixteen_fields() {
    let (addr, _v, _d) = serve().await;
    let (code, body) = tokio::task::spawn_blocking(move || get(addr, "/api/version"))
        .await
        .unwrap();
    assert_eq!(code, 200);
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    for k in [
        "name",
        "description",
        "version",
        "hash",
        "branch",
        "dirty",
        "built",
        "started",
        "uptime",
        "realm",
        "runtime",
        "os",
        "host",
        "pid",
        "repo",
        "commit_url",
    ] {
        assert!(
            v.get(k).is_some(),
            "missing {k} (realm-sigil go/sigil.go:31-46)"
        );
    }
    assert!(
        v["version"].as_str().unwrap().contains(" · "),
        "\"<Name> · <hash>\""
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_event_stream_starts_with_the_current_view() {
    let (addr, views, _d) = serve().await;
    views.send(r#"{"phase":"playing"}"#.into()).unwrap();
    let first = tokio::task::spawn_blocking(move || {
        let resp = ureq::get(&format!("http://{addr}/events")).call().unwrap();
        let mut line = String::new();
        let mut reader = std::io::BufReader::new(resp.into_reader());
        loop {
            line.clear();
            std::io::BufRead::read_line(&mut reader, &mut line).unwrap();
            if line.starts_with("data:") {
                return line;
            }
        }
    })
    .await
    .unwrap();
    assert!(first.contains(r#""phase":"playing""#), "{first}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dev_tap_from_loopback_reaches_the_core() {
    let (addr, _v, mut dev) = serve().await;
    let code = tokio::task::spawn_blocking(move || {
        ureq::post(&format!("http://{addr}/dev/tap"))
            .send_json(serde_json::json!({"seat": 0, "kind": "Pass", "card": 0, "lane": -1, "target": 0, "aux": 0}))
            .unwrap()
            .status()
    })
    .await
    .unwrap();
    assert_eq!(code, 202);
    assert!(matches!(
        dev.recv().await,
        Some(DevCmd::Tap { seat: 0, .. })
    ));
}

/// The other direction of the loopback gate: a peer on the LAN is refused, and nothing reaches
/// the core. (The perturbation above only proves loopback is allowed.)
#[tokio::test(flavor = "multi_thread")]
async fn a_dev_tap_from_the_lan_is_refused() {
    use axum::extract::connect_info::MockConnectInfo;
    let (_view_tx, view_rx) = watch::channel(String::new());
    let (dev_tx, mut dev_rx) = mpsc::channel(8);
    let lan: SocketAddr = ([192, 168, 1, 9], 40_000).into();
    let app = router(AppState {
        views: view_rx,
        dev: dev_tx,
    })
    .layer(MockConnectInfo(lan));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let code = tokio::task::spawn_blocking(move || {
        match ureq::post(&format!("http://{addr}/dev/tap"))
            .send_json(serde_json::json!({"seat": 0, "kind": "Pass", "card": 0, "lane": -1, "target": 0, "aux": 0}))
        {
            Ok(r) => r.status(),
            Err(ureq::Error::Status(c, _)) => c,
            Err(e) => panic!("{e}"),
        }
    })
    .await
    .unwrap();
    assert_eq!(code, 403, "a LAN peer must not reach /dev");
    assert!(dev_rx.try_recv().is_err(), "nothing reached the core");
}
