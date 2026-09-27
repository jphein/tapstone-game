//! The remote seat's HTTP face (0038, spec §2): the `Hub` it serves from, and (Task A5) its own
//! listener's router, which carries `/remote/*` and nothing else.
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Instant;

use rand::rngs::StdRng;
use rand::{Rng, RngCore};
use tapstone_rules::Record;

use crate::link::remote::{MAX_SLOTS, MenuItem};
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use tokio::sync::{Notify, mpsc};

/// Join-code characters: no 0/O and no 1/I (spec §2).
pub const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
pub const CODE_LEN: usize = 6;
/// Wrong codes one source may send at full speed each match, before its backoff starts (0038,
/// amended 2026-09-27: the budget is each source's, never the table's, so a URL-holder guessing
/// can't lock the real seats out).
pub const FREE_WRONG: u32 = 10;
/// A source past its budget waits 1 s after its next wrong code, then 2, 4, … up to this: about
/// one guess a minute, against 32^6 codes.
pub const BACKOFF_CAP: Duration = Duration::from_secs(60);
/// Sources a match remembers. Past this, new wrong-guessers share one record and its wait, so
/// memory stays bounded; a source that has never sent a wrong code is still evaluated at once.
pub const SOURCES_KEPT: usize = 1024;
/// The shared record's key: never a real source's (those are addresses, or "local").
const OVERFLOW: &str = "(overflow)";
/// Views kept for pollers; one further behind gets the oldest kept, and its `n` shows the gap.
pub const VIEWS_KEPT: usize = 512;

#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    /// 403
    Wrong,
    /// 429, with Retry-After: this source sent too many wrong codes and must wait this long. Its
    /// code was not looked at.
    Throttled(Duration),
    /// 409
    Taken,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProposeError {
    /// 409: not the current menu number (stale, or already spent)
    Stale,
    /// 400
    BadIndex,
}

/// A redeemed join code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Joined {
    pub slot: usize,
    pub token: String,
    /// The arena seat this slot plays, once known (`Hub::set_seat`).
    pub seat: Option<u8>,
}

/// One source's wrong codes this match.
struct Strikes {
    wrong: u32,
    /// Before this, the source's codes aren't evaluated.
    until: Option<Instant>,
}

/// Who a join came from, for its wrong-code budget. A tunnel's requests arrive from cloudflared
/// on loopback, carrying the client's address in `CF-Connecting-IP` (Cloudflare sets it), so
/// behind a loopback peer that header is the source. Any other peer is its own source and its
/// header is ignored: it could say anything. IPv6 is keyed by its /64, which one host holds whole.
pub fn source_key(peer: Option<IpAddr>, cf_connecting_ip: Option<&str>) -> String {
    let from_tunnel = peer.is_none_or(|p| p.is_loopback());
    let client = cf_connecting_ip
        .filter(|_| from_tunnel)
        .and_then(|h| h.trim().parse::<IpAddr>().ok());
    match client.or(peer) {
        Some(IpAddr::V6(a)) if !a.is_loopback() => {
            let s = a.segments();
            format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
        }
        Some(a) => a.to_string(),
        None => "local".to_string(),
    }
}

/// One remote slot's share of the hub.
#[derive(Default)]
struct Slot {
    code: String,
    token: Option<String>,
    /// The previous match's token: it may still read views (the final board) until this slot's
    /// next join.
    last_token: Option<String>,
    /// The arena seat this slot's shrine holds, once its claim has landed (join and choices carry
    /// it).
    seat: Option<u8>,
    menu_n: u64,
    menu: Vec<MenuItem>,
    taps: Vec<Record>,
}

/// Everything the remote API reads and changes. The arena loop publishes views and menus into
/// it; the handlers read it and take from it. Behind one `Mutex`, so a join's check-and-count and
/// a propose's check-and-spend are each atomic (plan decision 3).
///
/// Keyed by remote slot (the 0-based position in the list of remote shrines), never by seat:
/// with two slots, which seat a slot plays is claim order, which only the loop sees. The unslotted
/// methods are slot 0's, the only slot of a one-slot table.
pub struct Hub {
    rng: StdRng,
    slots: Vec<Slot>,
    /// Wrong codes this match, by source (`source_key`): a second slot is not a second budget,
    /// and one source's guesses never cost another source anything.
    strikes: HashMap<String, Strikes>,
    views: VecDeque<(u64, Arc<str>)>,
    next_view: u64,
}

impl Hub {
    /// One slot. `rng` is `StdRng::from_os_rng()` in the arena and a seeded one in tests.
    pub fn new(rng: StdRng) -> Hub {
        Hub::with_slots(rng, 1)
    }

    /// `slots` remote slots (1 or 2), a code each.
    pub fn with_slots(rng: StdRng, slots: usize) -> Hub {
        assert!(
            (1..=MAX_SLOTS).contains(&slots),
            "a table has 1 or 2 remote slots, got {slots}"
        );
        let mut h = Hub {
            rng,
            slots: (0..slots).map(|_| Slot::default()).collect(),
            strikes: HashMap::new(),
            views: VecDeque::new(),
            next_view: 1,
        };
        h.new_match();
        h
    }

    pub fn slots(&self) -> usize {
        self.slots.len()
    }

    pub fn code(&self) -> &str {
        self.code_of(0)
    }

    pub fn code_of(&self, slot: usize) -> &str {
        &self.slots[slot].code
    }

    /// The codes of the slots nobody has joined this match, in slot order: what the board shows.
    pub fn open_codes(&self) -> Vec<String> {
        self.slots
            .iter()
            .filter(|s| s.token.is_none())
            .map(|s| s.code.clone())
            .collect()
    }

    pub fn joined(&self) -> bool {
        self.is_joined(0)
    }

    pub fn is_joined(&self, slot: usize) -> bool {
        self.slots[slot].token.is_some()
    }

    /// The loop's word on which arena seat slot 0's shrine holds (`None` before its claim lands).
    pub fn set_seat(&mut self, seat: Option<u8>) {
        self.set_seat_at(0, seat)
    }

    /// The loop's word on which arena seat `slot`'s shrine holds (`None` before its claim lands).
    /// With two slots it is claim order: the first to claim is seat 0.
    pub fn set_seat_at(&mut self, slot: usize, seat: Option<u8>) {
        self.slots[slot].seat = seat;
    }

    pub fn seat(&self) -> Option<u8> {
        self.seat_at(0)
    }

    pub fn seat_at(&self, slot: usize) -> Option<u8> {
        self.slots[slot].seat
    }

    /// A match ended, or the table was reset: a fresh, distinct code per slot and every source's
    /// strikes forgotten.
    /// The old tokens can no longer choose or propose; each may still read views until its slot's
    /// next join. Every menu is spent, and every seat is unknown until the next claims land.
    pub fn new_match(&mut self) {
        let n = self.slots.len();
        let mut codes: Vec<String> = Vec::with_capacity(n);
        while codes.len() < n {
            let a = CODE_ALPHABET;
            let c: String = (0..CODE_LEN)
                .map(|_| a[self.rng.random_range(0..a.len())] as char)
                .collect();
            if !codes.contains(&c) {
                codes.push(c);
            }
        }
        for (s, code) in self.slots.iter_mut().zip(codes) {
            s.code = code;
            if let Some(t) = s.token.take() {
                s.last_token = Some(t);
            }
            s.seat = None;
            if !s.menu.is_empty() || !s.taps.is_empty() {
                s.menu_n += 1;
                s.menu.clear();
                s.taps.clear();
            }
        }
        self.strikes.clear();
    }

    /// Redeem the join code for this match's token (slot 0's shorthand; any slot's code works).
    pub fn join(&mut self, code: &str) -> Result<String, JoinError> {
        self.redeem(code).map(|j| j.token)
    }

    /// Redeem a join code for its slot's token for this match, from one local source, now.
    pub fn redeem(&mut self, code: &str) -> Result<Joined, JoinError> {
        self.redeem_from("local", code, Instant::now())
    }

    /// Sources with a record this match (the shared overflow record counts as one).
    pub fn sources_kept(&self) -> usize {
        self.strikes.len()
    }

    /// Redeem a join code for its slot's token for this match, as `source` at `now`. A source
    /// past its budget of wrong codes gets `Throttled` without its code being looked at, and those
    /// tries cost it nothing more; only another wrong code, once evaluated, lengthens its wait.
    pub fn redeem_from(
        &mut self,
        source: &str,
        code: &str,
        now: Instant,
    ) -> Result<Joined, JoinError> {
        let key = if self.strikes.contains_key(source) || self.strikes.len() < SOURCES_KEPT {
            source
        } else {
            OVERFLOW
        };
        if let Some(until) = self.strikes.get(key).and_then(|s| s.until)
            && now < until
        {
            return Err(JoinError::Throttled(until - now));
        }
        // Compare against every slot, so the time taken doesn't say which one matched.
        let mut hit = None;
        for (i, s) in self.slots.iter().enumerate() {
            if eq_ct(code.as_bytes(), s.code.as_bytes()) {
                hit = Some(i);
            }
        }
        let Some(slot) = hit else {
            let s = self.strikes.entry(key.to_string()).or_insert(Strikes {
                wrong: 0,
                until: None,
            });
            s.wrong += 1;
            if s.wrong >= FREE_WRONG {
                let doublings = (s.wrong - FREE_WRONG).min(16);
                s.until = Some(now + BACKOFF_CAP.min(Duration::from_secs(1 << doublings)));
            }
            return Err(JoinError::Wrong);
        };
        if self.slots[slot].token.is_some() {
            return Err(JoinError::Taken);
        }
        let mut b = [0u8; 16];
        self.rng.fill_bytes(&mut b);
        let token: String = b.iter().map(|x| format!("{x:02x}")).collect();
        let s = &mut self.slots[slot];
        s.token = Some(token.clone());
        s.last_token = None;
        Ok(Joined {
            slot,
            token,
            seat: s.seat,
        })
    }

    /// `bearer` is a token of this match (compared in constant time).
    pub fn authorized(&self, bearer: &str) -> bool {
        self.slot_of(bearer).is_some()
    }

    /// The slot whose token for this match `bearer` is (compared in constant time, against all).
    pub fn slot_of(&self, bearer: &str) -> Option<usize> {
        let mut hit = None;
        for (i, s) in self.slots.iter().enumerate() {
            if s.token
                .as_deref()
                .is_some_and(|t| eq_ct(t.as_bytes(), bearer.as_bytes()))
            {
                hit = Some(i);
            }
        }
        hit
    }

    /// `bearer` may read views: a token of this match, or a previous match's until its slot's
    /// next join.
    pub fn may_view(&self, bearer: &str) -> bool {
        let mut ok = false;
        for s in &self.slots {
            for t in [&s.token, &s.last_token].into_iter().flatten() {
                ok |= eq_ct(t.as_bytes(), bearer.as_bytes());
            }
        }
        ok
    }

    /// Number and keep one view the core published. Returns its number.
    pub fn publish_view(&mut self, json: &str) -> u64 {
        let n = self.next_view;
        self.next_view += 1;
        self.views.push_back((n, json.into()));
        while self.views.len() > VIEWS_KEPT {
            self.views.pop_front();
        }
        n
    }

    /// The first kept view numbered above `after`.
    pub fn view_after(&self, after: u64) -> Option<(u64, Arc<str>)> {
        self.views.iter().find(|(n, _)| *n > after).cloned()
    }

    pub fn set_menu(&mut self, menu: Vec<MenuItem>, taps: Vec<Record>) {
        self.set_menu_at(0, menu, taps)
    }

    /// The loop's menu for slot `slot`. A new number only when it changed.
    pub fn set_menu_at(&mut self, slot: usize, menu: Vec<MenuItem>, taps: Vec<Record>) {
        let s = &mut self.slots[slot];
        if menu != s.menu {
            s.menu_n += 1;
            s.menu = menu;
            s.taps = taps;
        }
    }

    pub fn menu(&self) -> (u64, &[MenuItem]) {
        self.menu_at(0)
    }

    pub fn menu_at(&self, slot: usize) -> (u64, &[MenuItem]) {
        let s = &self.slots[slot];
        (s.menu_n, &s.menu)
    }

    pub fn take(&mut self, n: u64, i: usize) -> Result<Record, ProposeError> {
        self.take_at(0, n, i)
    }

    /// Take item `i` of slot `slot`'s menu number `n` to propose. It spends that menu, so it can't
    /// be taken twice.
    pub fn take_at(&mut self, slot: usize, n: u64, i: usize) -> Result<Record, ProposeError> {
        let s = &mut self.slots[slot];
        if n != s.menu_n {
            return Err(ProposeError::Stale);
        }
        let Some(tap) = s.taps.get(i).copied() else {
            return Err(ProposeError::BadIndex);
        };
        s.menu_n += 1;
        s.menu.clear();
        s.taps.clear();
        Ok(tap)
    }
}

/// Constant-time equality, for codes and tokens that arrive from anywhere through the tunnel.
fn eq_ct(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A proposal on its way to the arena loop, which alone owns the link (plan decision 3).
#[derive(Debug, PartialEq)]
pub enum RemoteCmd {
    /// Slot 0's proposal: the only slot of a one-slot table.
    Propose(Record),
    /// Slot `.0`'s proposal, for slots 1 and up.
    ProposeAt(usize, Record),
}

impl RemoteCmd {
    /// Slot `slot` proposes `tap`.
    pub fn propose(slot: usize, tap: Record) -> RemoteCmd {
        match slot {
            0 => RemoteCmd::Propose(tap),
            _ => RemoteCmd::ProposeAt(slot, tap),
        }
    }

    /// (slot, tap), whichever variant.
    pub fn slot_tap(&self) -> (usize, Record) {
        match *self {
            RemoteCmd::Propose(tap) => (0, tap),
            RemoteCmd::ProposeAt(slot, tap) => (slot, tap),
        }
    }
}

#[derive(Clone)]
pub struct RemoteState {
    pub hub: Arc<Mutex<Hub>>,
    /// Woken by the loop after each view it publishes (`notify_waiters`).
    pub views: Arc<Notify>,
    pub cmds: mpsc::Sender<RemoteCmd>,
    /// How long `/remote/view` waits for a view before `204` (10 s; tests shorten it).
    pub wait: Duration,
}

/// The remote listener's router: these four routes and no others (0038). It never shares a port
/// with `http::router`, whose `/dev/*` trusts loopback peers, and a tunnel's peers are loopback.
pub fn remote_router(s: RemoteState) -> Router {
    Router::new()
        .route("/remote/join", post(join))
        .route("/remote/view", get(view))
        .route("/remote/choices", get(choices))
        .route("/remote/propose", post(propose))
        .with_state(s)
}

#[derive(Deserialize)]
struct JoinBody {
    code: String,
}

async fn join(
    State(s): State<RemoteState>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(b): Json<JoinBody>,
) -> Response {
    let cf = headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok());
    let source = source_key(peer.map(|Extension(ConnectInfo(a))| a.ip()), cf);
    let r = s
        .hub
        .lock()
        .unwrap()
        .redeem_from(&source, &b.code, Instant::now());
    match r {
        // `seat` is null until the slot's claim lands; /remote/choices carries it after.
        Ok(j) => Json(serde_json::json!({ "token": j.token, "seat": j.seat, "slot": j.slot }))
            .into_response(),
        Err(JoinError::Wrong) => StatusCode::FORBIDDEN.into_response(),
        Err(JoinError::Throttled(wait)) => {
            let secs = wait.as_secs() + u64::from(wait.subsec_nanos() > 0);
            (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, secs.to_string())],
            )
                .into_response()
        }
        Err(JoinError::Taken) => StatusCode::CONFLICT.into_response(),
    }
}

fn bearer(h: &HeaderMap) -> Option<&str> {
    h.get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

/// The slot of this match's token: choices and propose reach that slot's menu only.
fn authed(s: &RemoteState, h: &HeaderMap) -> Option<usize> {
    bearer(h).and_then(|t| s.hub.lock().unwrap().slot_of(t))
}

#[derive(Deserialize)]
struct After {
    #[serde(default)]
    after: u64,
}

async fn view(
    State(s): State<RemoteState>,
    headers: HeaderMap,
    Query(q): Query<After>,
) -> Response {
    // Views also accept the previous match's token until the next join, so the final board shows.
    if !bearer(&headers).is_some_and(|t| s.hub.lock().unwrap().may_view(t)) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let deadline = tokio::time::Instant::now() + s.wait;
    loop {
        // Register for the wake-up BEFORE looking, so a view published in between is not missed.
        let notified = s.views.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let hit = s.hub.lock().unwrap().view_after(q.after);
        if let Some((n, v)) = hit {
            let body = format!(r#"{{"n":{n},"view":{v}}}"#);
            return ([(header::CONTENT_TYPE, "application/json")], body).into_response();
        }
        if tokio::time::timeout_at(deadline, notified).await.is_err() {
            return StatusCode::NO_CONTENT.into_response();
        }
    }
}

async fn choices(State(s): State<RemoteState>, headers: HeaderMap) -> Response {
    let Some(slot) = authed(&s, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let body = {
        let hub = s.hub.lock().unwrap();
        let (n, menu) = hub.menu_at(slot);
        serde_json::json!({ "n": n, "seat": hub.seat_at(slot), "menu": menu })
    };
    Json(body).into_response()
}

#[derive(Deserialize)]
struct ProposeBody {
    n: u64,
    i: usize,
}

async fn propose(
    State(s): State<RemoteState>,
    headers: HeaderMap,
    Json(b): Json<ProposeBody>,
) -> Response {
    let Some(slot) = authed(&s, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let taken = s.hub.lock().unwrap().take_at(slot, b.n, b.i);
    match taken {
        Ok(tap) => match s.cmds.send(RemoteCmd::propose(slot, tap)).await {
            Ok(()) => StatusCode::ACCEPTED.into_response(),
            Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        },
        Err(ProposeError::Stale) => StatusCode::CONFLICT.into_response(),
        Err(ProposeError::BadIndex) => StatusCode::BAD_REQUEST.into_response(),
    }
}
