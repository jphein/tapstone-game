//! The arena's HTTP face (spec §9, §11): the page, `/events` (SSE of view-model JSON),
//! `/api/version`, and `/dev/*`, which answers loopback peers only.
use std::convert::Infallible;
use std::net::SocketAddr;

use axum::extract::{ConnectInfo, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio::sync::{mpsc, watch};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::WatchStream;

#[derive(Clone)]
pub struct AppState {
    pub views: watch::Receiver<String>,
    pub dev: mpsc::Sender<DevCmd>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "cmd")]
pub enum DevCmd {
    Tap {
        seat: u8,
        kind: String,
        card: u16,
        lane: i8,
        target: u8,
        aux: u8,
    },
    Desk,
}

#[derive(Deserialize)]
struct TapBody {
    seat: u8,
    kind: String,
    card: u16,
    lane: i8,
    target: u8,
    aux: u8,
}

const INDEX: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const STYLE: &str = include_str!("../web/style.css");
const FAVICON: &str = include_str!("../web/favicon.svg");

pub fn router(state: AppState) -> Router {
    Router::new()
        .route(
            "/",
            get(|| async { ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], INDEX) }),
        )
        .route(
            "/app.js",
            get(|| async { ([(header::CONTENT_TYPE, "text/javascript")], APP_JS) }),
        )
        .route(
            "/style.css",
            get(|| async { ([(header::CONTENT_TYPE, "text/css")], STYLE) }),
        )
        .route(
            "/favicon.svg",
            get(|| async { ([(header::CONTENT_TYPE, "image/svg+xml")], FAVICON) }),
        )
        .route(
            "/api/version",
            get(|| async { Json(crate::version::version_json()) }),
        )
        .route("/events", get(events))
        .route("/dev/tap", post(dev_tap))
        .route("/dev/desk", post(dev_desk))
        .with_state(state)
}

async fn events(
    State(s): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    // WatchStream yields the current value first, so a page that connects mid-match draws at once.
    let stream = WatchStream::new(s.views).map(|json| Ok(Event::default().data(json)));
    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn loopback(peer: &SocketAddr) -> bool {
    peer.ip().is_loopback()
}

async fn dev_tap(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(b): Json<TapBody>,
) -> impl IntoResponse {
    if !loopback(&peer) {
        return StatusCode::FORBIDDEN;
    }
    let cmd = DevCmd::Tap {
        seat: b.seat,
        kind: b.kind,
        card: b.card,
        lane: b.lane,
        target: b.target,
        aux: b.aux,
    };
    match s.dev.send(cmd).await {
        Ok(()) => StatusCode::ACCEPTED,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

async fn dev_desk(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    if !loopback(&peer) {
        return StatusCode::FORBIDDEN;
    }
    match s.dev.send(DevCmd::Desk).await {
        Ok(()) => StatusCode::ACCEPTED,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
