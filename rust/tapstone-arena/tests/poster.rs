use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use axum::Router;
use axum::http::StatusCode;
use axum::routing::post;
use tapstone_arena::ledger::Ledger;
use tapstone_arena::poster::{Sink, drain_once};

async fn flaky_server(fail_first: u32) -> (SocketAddr, Arc<AtomicU32>) {
    let hits = Arc::new(AtomicU32::new(0));
    let h = hits.clone();
    let app = Router::new().route(
        "/tapstone/match/{id}",
        post(move || {
            let h = h.clone();
            async move {
                let n = h.fetch_add(1, Ordering::SeqCst);
                if n < fail_first {
                    StatusCode::SERVICE_UNAVAILABLE
                } else {
                    StatusCode::OK
                }
            }
        }),
    );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (addr, hits)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_post_backs_off_and_a_later_one_completes() {
    let (addr, hits) = flaky_server(1).await;
    let dir = tempfile::tempdir().unwrap();
    let mut l = Ledger::open(&dir.path().join("l.sqlite")).unwrap();
    l.enqueue("scry", 0xA1, b"TSX1", "application/vnd.tapstone.tsx1", 100)
        .unwrap();
    let sinks = vec![Sink {
        name: "scry".into(),
        url: format!("http://{addr}/tapstone/match/{{id}}?k=tok"),
        enabled: true,
    }];
    let l = tokio::task::spawn_blocking(move || {
        assert_eq!(
            drain_once(&mut l, &sinks, 100),
            (0, 1),
            "first attempt fails"
        );
        assert_eq!(
            drain_once(&mut l, &sinks, 100),
            (0, 0),
            "backing off: not due yet"
        );
        assert_eq!(
            drain_once(&mut l, &sinks, 101),
            (1, 0),
            "second attempt lands"
        );
        l
    })
    .await
    .unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert!(l.due(1_000_000).unwrap().is_empty());
}

#[test]
fn an_unreachable_or_disabled_sink_leaves_its_rows_queued() {
    let dir = tempfile::tempdir().unwrap();
    let mut l = Ledger::open(&dir.path().join("l.sqlite")).unwrap();
    l.enqueue("realm", 1, b"{}", "application/json", 0).unwrap();
    let sinks = vec![Sink {
        name: "realm".into(),
        url: "http://127.0.0.1:9/x".into(),
        enabled: false,
    }];
    assert_eq!(
        drain_once(&mut l, &sinks, 0),
        (0, 0),
        "disabled: not even tried"
    );
    let sinks = vec![Sink {
        name: "realm".into(),
        url: "http://127.0.0.1:9/x".into(),
        enabled: true,
    }];
    assert_eq!(
        drain_once(&mut l, &sinks, 0),
        (0, 1),
        "port 9 refuses: failure, row kept"
    );
    assert_eq!(l.due(10_000).unwrap().len(), 1);
}

/// A finished match queues one row per sink kind: the TSX1 bytes for scry, the JSON for realm.
#[test]
fn a_finished_match_queues_one_row_per_sink() {
    let dir = tempfile::tempdir().unwrap();
    let mut l = Ledger::open(&dir.path().join("l.sqlite")).unwrap();
    let json: tapstone_sim::Transcript =
        serde_json::from_str(include_str!("../../tapstone-sim/golden/seed-1.json")).unwrap();
    tapstone_arena::poster::enqueue_match(&mut l, 0xB2, b"TSX1....", &json, 5).unwrap();
    let rows = l.due(5).unwrap();
    let kinds: Vec<(&str, &str)> = rows
        .iter()
        .map(|r| (r.sink.as_str(), r.content_type.as_str()))
        .collect();
    assert_eq!(
        kinds,
        [
            ("scry", "application/vnd.tapstone.tsx1"),
            ("realm", "application/json")
        ]
    );
    assert_eq!(rows[0].body, b"TSX1....");
    let back: tapstone_sim::Transcript = serde_json::from_slice(&rows[1].body).unwrap();
    assert_eq!(
        back.records.len(),
        json.records.len(),
        "the JSON row is the transcript"
    );
    assert!(rows.iter().all(|r| r.match_id == "000000b2"));
}
