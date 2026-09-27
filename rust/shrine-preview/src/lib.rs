//! Host-side shell around [`shrine_render`].
//!
//! Everything that needs a host lives here and never crosses back into the renderer: the
//! simulator surface, PNG export, the CLI, and driving `tapstone-sim` for real game states.
//! `shrine-render` itself is `no_std` and allocation-free so it can be vendored into smol
//! byte-identical, the way `tapstone-rules` is.
//!
//! The renderer draws into a caller-owned `DrawTarget`; [`panel`] supplies one backed by
//! `embedded-graphics-simulator` and adapts each entry point to return it, which is convenient
//! for a preview and exactly what firmware must not do.

pub mod clips;
pub mod export;
pub mod game;
pub mod panel;
pub mod search;
pub mod station;

pub use shrine_render::{
    battlefield, commander, cost, flourish, geom, ink, motion, palette, screens, sprite, voice,
};
