//! The remote listener (spec §2): the four routes, their answers, the long-poll, and nothing
//! else. `/dev/*`, `/events` and the board must be unreachable here (0038).
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::link::remote::MenuItem;
use tapstone_arena::remote::{Hub, RemoteCmd, RemoteState, remote_router};
use tapstone_rules::Kind;
use tokio::sync::{Notify, mpsc};

struct Served {
    addr: SocketAddr,
    hub: Arc<Mutex<Hub>>,
    notify: Arc<Notify>,
    cmds: mpsc::Receiver<RemoteCmd>,
}

async fn serve(wait_ms: u64) -> Served {
    let hub = Arc::new(Mutex::new(Hub::new(StdRng::seed_from_u64(3))));
    let notify = Arc::new(Notify::new());
    let (tx, cmds) = mpsc::channel(8);
    let app = remote_router(RemoteState {
        hub: hub.clone(),
        views: notify.clone(),
        cmds: tx,
        wait: Duration::from_millis(wait_ms),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap()
    });
    Served {
        addr,
        hub,
        notify,
        cmds,
    }
}

/// One blocking request: (status, body).
fn call(
    addr: SocketAddr,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<&str>,
) -> (u16, String) {
    let mut req = ureq::request(method, &format!("http://{addr}{path}"));
    if let Some(t) = token {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    let r = match body {
        Some(b) => req.set("Content-Type", "application/json").send_string(b),
        None => req.call(),
    };
    match r {
        Ok(resp) => (resp.status(), resp.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
        Err(e) => panic!("{e}"),
    }
}

async fn blocking<F: FnOnce() -> (u16, String) + Send + 'static>(f: F) -> (u16, String) {
    tokio::task::spawn_blocking(f).await.unwrap()
}

async fn join(s: &Served) -> String {
    let (addr, code) = (s.addr, s.hub.lock().unwrap().code().to_string());
    let (st, body) = blocking(move || {
        call(
            addr,
            "POST",
            "/remote/join",
            None,
            Some(&format!(r#"{{"code":"{code}"}}"#)),
        )
    })
    .await;
    assert_eq!(st, 200, "{body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(
        v["seat"].is_null(),
        "a seat before the claim landed: {body}"
    );
    v["token"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn join_then_view_then_choices_then_propose() {
    let mut s = serve(300).await;
    let token = join(&s).await;
    s.hub.lock().unwrap().publish_view(r#"{"phase":"lobby"}"#);
    let (addr, t) = (s.addr, token.clone());
    let (st, body) =
        blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&t), None)).await;
    assert_eq!(
        (st, body.as_str()),
        (200, r#"{"n":1,"view":{"phase":"lobby"}}"#)
    );

    let pass = tapstone_sim::tap(1, Kind::Pass, 0, -1, 0, 0);
    let item = MenuItem {
        key: "p".into(),
        label: "Pass".into(),
        kind: "Pass".into(),
        useful: true,
    };
    s.hub.lock().unwrap().set_menu(vec![item], vec![pass]);
    let t = token.clone();
    let (_, before) = blocking(move || call(addr, "GET", "/remote/choices", Some(&t), None)).await;
    let before: serde_json::Value = serde_json::from_str(&before).unwrap();
    assert!(
        before["seat"].is_null(),
        "choices named a seat before the claim landed"
    );
    s.hub.lock().unwrap().set_seat(Some(1));
    let t = token.clone();
    let (st, body) = blocking(move || call(addr, "GET", "/remote/choices", Some(&t), None)).await;
    assert_eq!(st, 200);
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        v["seat"], 1,
        "choices must carry the seat once the claim has landed"
    );
    let n = v["n"].as_u64().unwrap();
    assert_eq!(v["menu"][0]["label"], "Pass");

    let t = token.clone();
    let (st, _) = blocking(move || {
        call(
            addr,
            "POST",
            "/remote/propose",
            Some(&t),
            Some(&format!(r#"{{"n":{n},"i":0}}"#)),
        )
    })
    .await;
    assert_eq!(st, 202);
    match s.cmds.try_recv() {
        Ok(RemoteCmd::Propose(r)) => assert_eq!(r, pass),
        other => panic!("the loop got {other:?}"),
    }
    let t = token.clone();
    let (st, _) = blocking(move || {
        call(
            addr,
            "POST",
            "/remote/propose",
            Some(&t),
            Some(&format!(r#"{{"n":{n},"i":0}}"#)),
        )
    })
    .await;
    assert_eq!(st, 409, "a spent menu was proposed twice");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_bad_index_is_400() {
    let s = serve(300).await;
    let token = join(&s).await;
    let pass = tapstone_sim::tap(1, Kind::Pass, 0, -1, 0, 0);
    let item = MenuItem {
        key: "p".into(),
        label: "Pass".into(),
        kind: "Pass".into(),
        useful: true,
    };
    s.hub.lock().unwrap().set_menu(vec![item], vec![pass]);
    let n = s.hub.lock().unwrap().menu().0;
    let addr = s.addr;
    let (st, _) = blocking(move || {
        call(
            addr,
            "POST",
            "/remote/propose",
            Some(&token),
            Some(&format!(r#"{{"n":{n},"i":5}}"#)),
        )
    })
    .await;
    assert_eq!(st, 400);
}

/// A join as the client Cloudflare names in `CF-Connecting-IP`: (status, Retry-After).
fn join_as(addr: SocketAddr, code: &str, client: &str) -> (u16, Option<String>) {
    let r = ureq::post(&format!("http://{addr}/remote/join"))
        .set("Content-Type", "application/json")
        .set("CF-Connecting-IP", client)
        .send_string(&format!(r#"{{"code":"{code}"}}"#));
    let resp = match r {
        Ok(resp) => resp,
        Err(ureq::Error::Status(_, resp)) => resp,
        Err(e) => panic!("{e}"),
    };
    (
        resp.status(),
        resp.header("Retry-After").map(str::to_string),
    )
}

/// 403 for a wrong code; 429 with Retry-After once that source is past its budget, for that
/// source only (0038, amended 2026-09-27: it used to be 423 for the whole table); 409 once joined.
#[tokio::test(flavor = "multi_thread")]
async fn join_answers_403_then_429_for_that_source_only_and_409() {
    let s = serve(300).await;
    let addr = s.addr;
    let code = s.hub.lock().unwrap().code().to_string();
    let wrong = if code == "AAAAAA" { "BBBBBB" } else { "AAAAAA" };
    let troll = "198.51.100.7";
    for _ in 0..10 {
        let (st, _) = tokio::task::spawn_blocking(move || join_as(addr, wrong, troll))
            .await
            .unwrap();
        assert_eq!(st, 403);
    }
    let c = code.clone();
    let (st, retry) = tokio::task::spawn_blocking(move || join_as(addr, &c, troll))
        .await
        .unwrap();
    assert_eq!(
        (st, retry.as_deref()),
        (429, Some("1")),
        "the troll, with the right code"
    );
    let c = code.clone();
    let (st, _) = tokio::task::spawn_blocking(move || join_as(addr, &c, "203.0.113.9"))
        .await
        .unwrap();
    assert_eq!(st, 200, "the real seat, from its own address");
    let (st, _) = tokio::task::spawn_blocking(move || join_as(addr, &code, "203.0.113.10"))
        .await
        .unwrap();
    assert_eq!(st, 409);
}

#[tokio::test(flavor = "multi_thread")]
async fn no_token_or_an_old_token_is_401() {
    let s = serve(300).await;
    let addr = s.addr;
    for (m, p) in [("GET", "/remote/view?after=0"), ("GET", "/remote/choices")] {
        let (st, _) = blocking(move || call(addr, m, p, None, None)).await;
        assert_eq!(st, 401, "{m} {p}");
    }
    let (st, _) = blocking(move || {
        call(
            addr,
            "POST",
            "/remote/propose",
            None,
            Some(r#"{"n":1,"i":0}"#),
        )
    })
    .await;
    assert_eq!(st, 401);
    let token = join(&s).await;
    s.hub.lock().unwrap().publish_view(r#"{"phase":"over"}"#);
    s.hub.lock().unwrap().new_match();
    let t = token.clone();
    let (st, _) = blocking(move || call(addr, "GET", "/remote/choices", Some(&t), None)).await;
    assert_eq!(st, 401, "a token from the previous match");
    let (st, body) =
        blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&token), None)).await;
    assert_eq!(
        (st, body.as_str()),
        (200, r#"{"n":1,"view":{"phase":"over"}}"#),
        "the final board"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_view_long_poll_waits_then_204_and_wakes_on_a_view() {
    let s = serve(400).await;
    let token = join(&s).await;
    let (addr, t) = (s.addr, token.clone());
    let started = std::time::Instant::now();
    let (st, _) = blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&t), None)).await;
    assert_eq!(st, 204);
    assert!(
        started.elapsed() >= Duration::from_millis(350),
        "it did not wait"
    );

    let (hub, notify) = (s.hub.clone(), s.notify.clone());
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        hub.lock().unwrap().publish_view(r#"{"phase":"playing"}"#);
        notify.notify_waiters();
    });
    let (st, body) =
        blocking(move || call(addr, "GET", "/remote/view?after=0", Some(&token), None)).await;
    assert_eq!(
        (st, body.as_str()),
        (200, r#"{"n":1,"view":{"phase":"playing"}}"#)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn nothing_but_remote_routes_on_the_remote_listener() {
    let s = serve(300).await;
    let addr = s.addr;
    for (m, p) in [
        ("POST", "/dev/tap"),
        ("POST", "/dev/desk"),
        ("GET", "/events"),
        ("GET", "/"),
        ("GET", "/api/version"),
    ] {
        let body = (m == "POST").then_some("{}");
        let (st, _) = blocking(move || call(addr, m, p, None, body)).await;
        assert_eq!(st, 404, "{m} {p} is reachable through the tunnel");
    }
}
