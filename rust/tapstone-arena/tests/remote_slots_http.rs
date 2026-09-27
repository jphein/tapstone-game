//! The remote listener with two slots: each join answers its slot and a null seat, and a token's
//! choices and proposals reach its own slot's menu only.
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rand::SeedableRng;
use rand::rngs::StdRng;
use tapstone_arena::link::remote::MenuItem;
use tapstone_arena::remote::{Hub, RemoteCmd, RemoteState, remote_router};
use tapstone_rules::{Kind, Record};
use tokio::sync::{Notify, mpsc};

struct Served {
    addr: SocketAddr,
    hub: Arc<Mutex<Hub>>,
    cmds: mpsc::Receiver<RemoteCmd>,
}

async fn serve() -> Served {
    let hub = Arc::new(Mutex::new(Hub::with_slots(StdRng::seed_from_u64(3), 2)));
    let (tx, cmds) = mpsc::channel(8);
    let app = remote_router(RemoteState {
        hub: hub.clone(),
        views: Arc::new(Notify::new()),
        cmds: tx,
        wait: Duration::from_millis(200),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Served { addr, hub, cmds }
}

/// One request off the runtime: (status, body).
async fn call(
    addr: SocketAddr,
    method: &'static str,
    path: &'static str,
    token: Option<String>,
    body: Option<String>,
) -> (u16, String) {
    tokio::task::spawn_blocking(move || {
        let mut req = ureq::request(method, &format!("http://{addr}{path}"));
        if let Some(t) = token {
            req = req.set("Authorization", &format!("Bearer {t}"));
        }
        let r = match body {
            Some(b) => req.set("Content-Type", "application/json").send_string(&b),
            None => req.call(),
        };
        match r {
            Ok(resp) => (resp.status(), resp.into_string().unwrap_or_default()),
            Err(ureq::Error::Status(code, resp)) => (code, resp.into_string().unwrap_or_default()),
            Err(e) => panic!("{e}"),
        }
    })
    .await
    .unwrap()
}

fn item(key: &str) -> MenuItem {
    MenuItem {
        key: key.into(),
        label: key.into(),
        kind: "Pass".into(),
        useful: true,
    }
}

fn tap(seat: u8) -> Record {
    tapstone_sim::tap(seat, Kind::Pass, 0, -1, 0, 0)
}

/// Joins `slot`: (token, the answer).
async fn join(s: &Served, slot: usize) -> (String, serde_json::Value) {
    let code = s.hub.lock().unwrap().code_of(slot).to_string();
    let (st, body) = call(
        s.addr,
        "POST",
        "/remote/join",
        None,
        Some(format!(r#"{{"code":"{code}"}}"#)),
    )
    .await;
    assert_eq!(st, 200, "{body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    (v["token"].as_str().unwrap().to_string(), v)
}

#[tokio::test(flavor = "multi_thread")]
async fn each_token_reaches_its_own_slot_only() {
    let mut s = serve().await;
    let (tb, vb) = join(&s, 1).await;
    let (ta, va) = join(&s, 0).await;
    assert_eq!(
        (va["slot"].as_u64(), vb["slot"].as_u64()),
        (Some(0), Some(1))
    );
    assert!(
        va["seat"].is_null() && vb["seat"].is_null(),
        "a seat before the loop set it"
    );
    {
        let mut h = s.hub.lock().unwrap();
        h.set_menu_at(0, vec![item("a")], vec![tap(0)]);
        h.set_menu_at(1, vec![item("b")], vec![tap(1)]);
    }
    for (t, want) in [(&ta, "a"), (&tb, "b")] {
        let (st, body) = call(s.addr, "GET", "/remote/choices", Some(t.clone()), None).await;
        assert_eq!(st, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            v["menu"][0]["key"], want,
            "a token read another slot's menu"
        );
    }
    let n = s.hub.lock().unwrap().menu_at(1).0;
    let (st, _) = call(
        s.addr,
        "POST",
        "/remote/propose",
        Some(tb.clone()),
        Some(format!(r#"{{"n":{n},"i":0}}"#)),
    )
    .await;
    assert_eq!(st, 202);
    let cmd = s.cmds.try_recv().unwrap();
    assert_eq!(cmd.slot_tap(), (1, tap(1)));
    assert_eq!(
        s.hub.lock().unwrap().menu_at(0).1,
        &[item("a")][..],
        "slot 1's proposal spent slot 0's menu"
    );
    let n = s.hub.lock().unwrap().menu_at(0).0;
    let (st, _) = call(
        s.addr,
        "POST",
        "/remote/propose",
        Some(ta),
        Some(format!(r#"{{"n":{n},"i":0}}"#)),
    )
    .await;
    assert_eq!(st, 202);
    assert_eq!(s.cmds.try_recv().unwrap().slot_tap(), (0, tap(0)));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_seat_set_by_the_loop_rides_in_the_join_answer() {
    let s = serve().await;
    s.hub.lock().unwrap().set_seat_at(1, Some(0));
    let (_, v) = join(&s, 1).await;
    assert_eq!(v["seat"], 0);
}

/// Two slots join before either claims, so the join answer's seat is null; each slot learns its
/// seat from its choices once the loop has set it.
#[tokio::test(flavor = "multi_thread")]
async fn choices_carry_the_slots_seat_once_set() {
    let s = serve().await;
    let (ta, _) = join(&s, 0).await;
    let (tb, _) = join(&s, 1).await;
    s.hub.lock().unwrap().set_seat_at(1, Some(0));
    let seat =
        |body: String| serde_json::from_str::<serde_json::Value>(&body).unwrap()["seat"].clone();
    let (_, a) = call(s.addr, "GET", "/remote/choices", Some(ta), None).await;
    let (_, b) = call(s.addr, "GET", "/remote/choices", Some(tb), None).await;
    assert!(seat(a).is_null(), "slot 0's seat before the loop set it");
    assert_eq!(seat(b), 0);
}
