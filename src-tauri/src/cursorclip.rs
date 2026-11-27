//! Keeps the mouse inside the game window on Windows.
//!
//! The page only says what it wants (always, in fullscreen, or never). Whether that applies
//! right now is decided here, from the window itself: Windows drops a cursor clip on Alt+Tab
//! and on other system popups, and neither the window nor the page reliably hears about it
//! (the page's own focus events go to whichever frame had focus, and the webview covers the
//! window so the window sees no mouse enter or leave). A small thread looks a few times a
//! second: while the game window is in front and wants the mouse, the clip is put back on
//! its client area; once another window is in front, a clip of ours is let go.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::time::Duration;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::WindowsAndMessaging::{
    ClipCursor, GetClientRect, GetClipCursor, GetForegroundWindow, IsIconic,
};

pub const OFF: u8 = 0;
pub const FULLSCREEN: u8 = 1;
pub const ALWAYS: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(OFF);
static FULL: AtomicBool = AtomicBool::new(false);
static WINDOW: AtomicIsize = AtomicIsize::new(0);

pub fn set_mode(mode: u8) {
    MODE.store(mode, Ordering::Relaxed);
}

pub fn set_fullscreen(on: bool) {
    FULL.store(on, Ordering::Relaxed);
}

/// Whether the mouse should be kept in, leaving aside which window is in front.
pub fn wanted() -> bool {
    match MODE.load(Ordering::Relaxed) {
        ALWAYS => true,
        FULLSCREEN => FULL.load(Ordering::Relaxed),
        _ => false,
    }
}

/// A clip this thread set: the rectangle asked for, and what Windows made of it (a clip is
/// trimmed to the screen, so a window reaching past the monitor edge reads back smaller).
#[derive(Clone, Copy)]
struct Held {
    asked: RECT,
    got: RECT,
}

pub fn start(window: isize) {
    if WINDOW.swap(window, Ordering::Relaxed) != 0 {
        return;
    }
    std::thread::spawn(|| {
        let mut held: Option<Held> = None;
        loop {
            std::thread::sleep(Duration::from_millis(50));
            held = unsafe { step(HWND(WINDOW.load(Ordering::Relaxed) as _), held) };
        }
    });
}

fn same(a: &RECT, b: &RECT) -> bool {
    (a.left, a.top, a.right, a.bottom) == (b.left, b.top, b.right, b.bottom)
}

unsafe fn client_on_screen(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    unsafe { GetClientRect(hwnd, &mut r) }.ok()?;
    let mut tl = POINT {
        x: r.left,
        y: r.top,
    };
    let mut br = POINT {
        x: r.right,
        y: r.bottom,
    };
    if !unsafe { ClientToScreen(hwnd, &mut tl) }.as_bool()
        || !unsafe { ClientToScreen(hwnd, &mut br) }.as_bool()
    {
        return None;
    }
    (br.x > tl.x && br.y > tl.y).then_some(RECT {
        left: tl.x,
        top: tl.y,
        right: br.x,
        bottom: br.y,
    })
}

unsafe fn step(hwnd: HWND, held: Option<Held>) -> Option<Held> {
    let mut now = RECT::default();
    let _ = unsafe { GetClipCursor(&mut now) };
    let front = unsafe { GetForegroundWindow() } == hwnd && !unsafe { IsIconic(hwnd) }.as_bool();
    if front && wanted() {
        let Some(want) = (unsafe { client_on_screen(hwnd) }) else {
            return held;
        };
        // set again when Windows (or anything else) has changed the clip, or the window moved
        if let Some(h) = held {
            if same(&h.got, &now) && same(&h.asked, &want) {
                return held;
            }
        }
        if unsafe { ClipCursor(Some(&want)) }.is_err() {
            return held;
        }
        let mut got = RECT::default();
        let _ = unsafe { GetClipCursor(&mut got) };
        return Some(Held { asked: want, got });
    }
    // let go only of a clip that is still ours, never one another program has set since
    if let Some(h) = held {
        if same(&h.got, &now) {
            let _ = unsafe { ClipCursor(None) };
        }
    }
    None
}
