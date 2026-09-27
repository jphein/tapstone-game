//! The Tapstone arena (0028): arbiter, board, ledger, record. See
//! docs/superpowers/specs/2026-09-23-arena-service-design.md.
//!
//! Without the default `server` feature this is the sans-IO core alone, which builds for wasm32
//! (tapstone-web, the headset build).
#[cfg(feature = "server")]
pub mod config;
pub mod core;
pub mod decks;
#[cfg(feature = "server")]
pub mod http;
#[cfg(feature = "server")]
pub mod ledger;
pub mod link;
#[cfg(feature = "server")]
pub mod poster;
pub mod registry;
#[cfg(feature = "server")]
pub mod remote;
pub mod transcript;
#[cfg(feature = "server")]
pub mod version;
pub mod view;
