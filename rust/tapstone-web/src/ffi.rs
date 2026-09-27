//! The C ABI the page calls. One table per page and one output buffer: a call that returns text
//! returns its byte length, and `out_ptr()` points at the bytes until the next such call. u64
//! arguments are BigInt on the JS side.
use std::cell::RefCell;

use crate::Web;

thread_local! {
    static WEB: RefCell<Option<Web>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn put(s: String) -> u32 {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        *o = s.into_bytes();
        o.len() as u32
    })
}

fn with<T>(f: impl FnOnce(&mut Web) -> T, none: T) -> T {
    WEB.with(|w| w.borrow_mut().as_mut().map(f).unwrap_or(none))
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn table_new(seed: u64, human: u32) {
    WEB.with(|w| *w.borrow_mut() = Some(Web::new(seed, human)));
}

#[unsafe(no_mangle)]
pub extern "C" fn table_step(now: u64) -> u32 {
    put(with(|t| t.step(now), String::new()))
}

#[unsafe(no_mangle)]
pub extern "C" fn table_done() -> u32 {
    with(|t| t.done() as u32, 0)
}

#[unsafe(no_mangle)]
pub extern "C" fn table_choices() -> u32 {
    put(with(|t| t.choices(), "[]".into()))
}

#[unsafe(no_mangle)]
pub extern "C" fn table_propose(i: u32, now: u64) -> u32 {
    with(|t| t.propose(i, now) as u32, 0)
}

/// The person's hand as JSON (`Web::hand`), for the card faces in the headset.
#[unsafe(no_mangle)]
pub extern "C" fn table_hand() -> u32 {
    put(with(|t| t.hand(), "[]".into()))
}

/// The seat the person's shrine holds (0 or 1), or 255 until its claim lands or with nobody seated.
#[unsafe(no_mangle)]
pub extern "C" fn table_seat() -> u32 {
    with(|t| t.seat().map_or(255, |s| s as u32), 255)
}
