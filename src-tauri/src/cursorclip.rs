//! Keeps the mouse inside the game window on Windows, and keeps a short log of the window,
//! the mouse clip and the cursor around Alt+Tab for bug reports.
//!
//! The page only says what it wants (always, in fullscreen, or never). Whether that applies
//! right now is decided here, from the window itself: Windows drops a cursor clip on Alt+Tab
//! and on other system popups, and neither the window nor the page reliably hears about it
//! (the page's own focus events go to whichever frame had focus, and the webview covers the
//! window so the window sees no mouse enter or leave). A small thread looks a few times a
//! second: while the game window is in front and wants the mouse, the clip is put back on
//! its client area; once another window is in front, a clip of ours is let go.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CURSORINFO, ClipCursor, GetClassNameW, GetClientRect, GetClipCursor, GetCursorInfo,
    GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic, WindowFromPoint,
};

pub const OFF: u8 = 0;
pub const FULLSCREEN: u8 = 1;
pub const ALWAYS: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(OFF);
static FULL: AtomicBool = AtomicBool::new(false);
static WINDOW: AtomicIsize = AtomicIsize::new(0);

pub fn set_mode(mode: u8) {
    if MODE.swap(mode, Ordering::Relaxed) != mode {
        log(format!("mode {}", mode_name(mode)));
    }
}

pub fn set_fullscreen(on: bool) {
    if FULL.swap(on, Ordering::Relaxed) != on {
        log(format!("fullscreen {on}"));
    }
}

fn mode_name(mode: u8) -> &'static str {
    match mode {
        ALWAYS => "always",
        FULLSCREEN => "fullscreen",
        _ => "off",
    }
}

/// Whether the mouse should be kept in, leaving aside which window is in front.
pub fn wanted() -> bool {
    match MODE.load(Ordering::Relaxed) {
        ALWAYS => true,
        FULLSCREEN => FULL.load(Ordering::Relaxed),
        _ => false,
    }
}

/// Whether the game window is the one in front.
pub fn in_front() -> bool {
    let hwnd = HWND(WINDOW.load(Ordering::Relaxed) as _);
    !hwnd.is_invalid()
        && unsafe { GetForegroundWindow() } == hwnd
        && !unsafe { IsIconic(hwnd) }.as_bool()
}

const LOG_LINES: usize = 400;
static LOG: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
static STARTED: OnceLock<Instant> = OnceLock::new();

/// One line for the bug report's window log, stamped with milliseconds since the app started.
pub fn log(line: impl AsRef<str>) {
    let ms = STARTED.get_or_init(Instant::now).elapsed().as_millis();
    let mut lines = LOG.lock().unwrap();
    if lines.len() >= LOG_LINES {
        lines.pop_front();
    }
    lines.push_back(format!("{ms:>9} {}", line.as_ref()));
}

pub fn log_lines() -> Vec<String> {
    LOG.lock().unwrap().iter().cloned().collect()
}

/// A clip this thread set: the rectangle asked for, and what Windows made of it (a clip is
/// trimmed to the screen, so a window reaching past the monitor edge reads back smaller).
#[derive(Clone, Copy)]
struct Held {
    asked: RECT,
    got: RECT,
}

/// Starts the watch on the game window; `came_to_front` runs each time it comes back in front.
pub fn start(window: isize, came_to_front: impl Fn() + Send + 'static) {
    if WINDOW.swap(window, Ordering::Relaxed) != 0 {
        return;
    }
    STARTED.get_or_init(Instant::now);
    std::thread::spawn(move || {
        let hwnd = HWND(WINDOW.load(Ordering::Relaxed) as _);
        let mut held: Option<Held> = None;
        let mut was_front = false;
        let mut front_since = Instant::now();
        let mut looks = [false; 3];
        loop {
            std::thread::sleep(Duration::from_millis(50));
            let front = in_front();
            if front != was_front {
                was_front = front;
                if front {
                    front_since = Instant::now();
                    looks = [false; 3];
                    log(format!("in front, {}", unsafe { window_state(hwnd) }));
                    came_to_front();
                } else {
                    log(format!("behind {}", unsafe { front_process() }));
                }
            }
            // how the cursor looks right after coming back, and a little later
            if front {
                let since = front_since.elapsed();
                for (i, at) in [0u64, 500, 2000].iter().enumerate() {
                    if !looks[i] && since >= Duration::from_millis(*at) {
                        looks[i] = true;
                        log(format!("cursor +{at}ms {}", unsafe { cursor_state() }));
                    }
                }
            }
            held = unsafe { step(hwnd, front, held) };
        }
    });
}

fn same(a: &RECT, b: &RECT) -> bool {
    (a.left, a.top, a.right, a.bottom) == (b.left, b.top, b.right, b.bottom)
}

fn show(r: &RECT) -> String {
    format!("{},{}..{},{}", r.left, r.top, r.right, r.bottom)
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

unsafe fn step(hwnd: HWND, front: bool, held: Option<Held>) -> Option<Held> {
    let mut now = RECT::default();
    let _ = unsafe { GetClipCursor(&mut now) };
    if front && wanted() {
        let Some(want) = (unsafe { client_on_screen(hwnd) }) else {
            return held;
        };
        // set again when Windows (or anything else) has changed the clip, or the window moved
        if let Some(h) = held {
            if same(&h.got, &now) && same(&h.asked, &want) {
                return held;
            }
            if !same(&h.got, &now) {
                log(format!("clip changed elsewhere to {}", show(&now)));
            }
        }
        if unsafe { ClipCursor(Some(&want)) }.is_err() {
            log("clip refused");
            return held;
        }
        let mut got = RECT::default();
        let _ = unsafe { GetClipCursor(&mut got) };
        log(format!("clip {} (asked {})", show(&got), show(&want)));
        return Some(Held { asked: want, got });
    }
    // let go only of a clip that is still ours, never one another program has set since
    if let Some(h) = held {
        if same(&h.got, &now) {
            let _ = unsafe { ClipCursor(None) };
            log("clip let go");
        } else {
            log(format!("clip already changed to {}", show(&now)));
        }
    }
    None
}

unsafe fn window_state(hwnd: HWND) -> String {
    let mut w = RECT::default();
    let _ = unsafe { GetWindowRect(hwnd, &mut w) };
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let _ = unsafe { GetMonitorInfoW(monitor, &mut info) };
    format!(
        "window {} monitor {} want {} fullscreen {}",
        show(&w),
        show(&info.rcMonitor),
        mode_name(MODE.load(Ordering::Relaxed)),
        FULL.load(Ordering::Relaxed)
    )
}

unsafe fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// The program in front: its file name only, never a window title.
unsafe fn front_process() -> String {
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_invalid() {
        return "(nothing)".into();
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(fg, Some(&mut pid)) };
    let name = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .ok()
        .and_then(|h| {
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = unsafe {
                QueryFullProcessImageNameW(
                    h,
                    PROCESS_NAME_WIN32,
                    windows::core::PWSTR(buf.as_mut_ptr()),
                    &mut len,
                )
            }
            .is_ok();
            let _ = unsafe { CloseHandle(h) };
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
        })
        .and_then(|path| path.rsplit(['\\', '/']).next().map(str::to_string))
        .unwrap_or_else(|| "?".into());
    format!("{name} ({})", unsafe { class_of(fg) })
}

/// Whether Windows shows the cursor, its handle, and which window it is over.
unsafe fn cursor_state() -> String {
    let mut ci = CURSORINFO {
        cbSize: std::mem::size_of::<CURSORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetCursorInfo(&mut ci) }.is_err() {
        return "unknown".into();
    }
    let shown = match ci.flags.0 {
        0 => "hidden",
        1 => "shown",
        2 => "suppressed",
        _ => "other",
    };
    let over = unsafe { WindowFromPoint(ci.ptScreenPos) };
    format!(
        "{shown} handle {:?} at {},{} over {}",
        ci.hCursor.0,
        ci.ptScreenPos.x,
        ci.ptScreenPos.y,
        unsafe { class_of(over) }
    )
}
