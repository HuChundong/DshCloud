//! Watch a tree, and say what changed.
//!
//! inotify by hand rather than through a crate: the whole of what is needed is
//! four calls, and a dependency for four calls is a build that has to reach the
//! network for something this file already says in forty lines.
//!
//! Two things about the lifetime, and the second is the one that was got wrong.
//!
//! The gateway cannot stop this. Closing the stream tears down ITS end of the
//! connection and leaves the process here running, so the process has to notice
//! by itself — and the only thing it can notice is a write that fails.
//!
//! But a watcher writes only when something changes, and a workspace can be
//! quiet for hours, so noticing by writing is a poor lifecycle even when it
//! works. `serve.rs` is where that is answered properly: the loop below hands
//! its events to a sink and stops when the sink says to, and the service
//! decides that by whether anyone has asked for the events lately.

use std::collections::HashMap;
use std::ffi::CString;
use std::io::Write;
use std::os::raw::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// As many directories as it will hold watches on.
///
/// A watch costs a kernel object, and a runaway tree — a `node_modules` inside
/// a `node_modules` — should degrade to missing events rather than to an
/// unbounded allocation in someone else's kernel.
const MAX_WATCHES: usize = 20_000;

const IN_CLOEXEC: c_int = 0o2_000_000;
const IN_NONBLOCK: c_int = 0o4_000;
const IN_CREATE: u32 = 0x0000_0100;
const IN_DELETE: u32 = 0x0000_0200;
const IN_MOVED_FROM: u32 = 0x0000_0040;
const IN_MOVED_TO: u32 = 0x0000_0080;
const IN_CLOSE_WRITE: u32 = 0x0000_0008;
const IN_ISDIR: u32 = 0x4000_0000;
const POLLIN: i16 = 0x001;

const WATCH_MASK: u32 = IN_CREATE | IN_DELETE | IN_MOVED_FROM | IN_MOVED_TO | IN_CLOSE_WRITE;

#[repr(C)]
struct PollFd {
    fd: c_int,
    events: i16,
    revents: i16,
}

extern "C" {
    fn inotify_init1(flags: c_int) -> c_int;
    fn inotify_add_watch(fd: c_int, pathname: *const c_char, mask: u32) -> c_int;
    fn read(fd: c_int, buf: *mut c_void, count: usize) -> isize;
    fn poll(fds: *mut PollFd, nfds: u64, timeout: c_int) -> c_int;
}

/// Say one thing, and end if nobody is listening.
///
/// Every write is checked, because a failed write is the only notice this gets
/// that the gateway has gone.
fn say(line: &str) -> bool {
    let mut out = std::io::stdout();
    writeln!(out, "{line}").is_ok() && out.flush().is_ok()
}

/// Add a watch for a directory and everything under it.
fn add_all(fd: c_int, root: &Path, watches: &mut HashMap<c_int, PathBuf>) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if watches.len() >= MAX_WATCHES {
            return;
        }
        let Ok(c) = CString::new(dir.as_os_str().as_encoded_bytes()) else { continue };
        // SAFETY: `c` is a NUL-terminated path that outlives the call.
        let wd = unsafe { inotify_add_watch(fd, c.as_ptr(), WATCH_MASK) };
        if wd < 0 {
            continue;
        }
        watches.insert(wd, dir.clone());
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                stack.push(entry.path());
            }
        }
    }
}

/// Watch a tree, handing each change to `sink` as one JSON object.
///
/// `sink` returns whether to keep going, which is the only way this loop can be
/// told to stop: it is otherwise blocked in `poll`. The service uses that to
/// drop a watcher nobody is asking about; the standalone command uses it to end
/// when a write to stdout fails.
///
/// @param root - the directory to watch, and everything under it.
/// @param stop - set from another thread to end the loop.
/// @param sink - given each event; returning false ends the loop.
pub fn watch_tree(root: &str, stop: &AtomicBool, sink: &mut dyn FnMut(&str) -> bool) {
    // SAFETY: no arguments to get wrong.
    let fd = unsafe { inotify_init1(IN_CLOEXEC | IN_NONBLOCK) };
    if fd < 0 {
        return;
    }
    let root = Path::new(root);
    let mut watches: HashMap<c_int, PathBuf> = HashMap::new();
    add_all(fd, root, &mut watches);
    if watches.is_empty() {
        return;
    }

    let mut buffer = vec![0_u8; 64 * 1024];
    while !stop.load(Ordering::Relaxed) {
        let mut fds = PollFd { fd, events: POLLIN, revents: 0 };
        // A second at a time rather than forever, so `stop` is noticed without
        // anything having to happen in the tree.
        // SAFETY: one descriptor, and the struct outlives the call.
        let ready = unsafe { poll(&raw mut fds, 1, 1000) };
        if ready <= 0 {
            continue;
        }
        // SAFETY: the buffer is owned here and its length is passed honestly.
        let n = unsafe { read(fd, buffer.as_mut_ptr().cast::<c_void>(), buffer.len()) };
        if n <= 0 {
            continue;
        }
        let n = n as usize;
        let mut at = 0_usize;
        while at + 16 <= n {
            let wd = i32::from_ne_bytes(buffer[at..at + 4].try_into().unwrap_or_default());
            let mask = u32::from_ne_bytes(buffer[at + 4..at + 8].try_into().unwrap_or_default());
            let len = u32::from_ne_bytes(buffer[at + 12..at + 16].try_into().unwrap_or_default()) as usize;
            let name_bytes = &buffer[at + 16..(at + 16 + len).min(n)];
            let name = String::from_utf8_lossy(name_bytes.split(|b| *b == 0).next().unwrap_or(&[])).into_owned();
            at += 16 + len;
            if name.is_empty() {
                continue;
            }
            let Some(dir) = watches.get(&wd).cloned() else { continue };
            let full = dir.join(&name);
            // A directory that appears has to be watched too, or everything
            // made inside it afterwards is invisible.
            if mask & IN_ISDIR != 0 && mask & (IN_CREATE | IN_MOVED_TO) != 0 {
                add_all(fd, &full, &mut watches);
            }
            let relative = full.strip_prefix(root).unwrap_or(&full).to_string_lossy().into_owned();
            // The gateway re-reads the directory rather than trusting a kind,
            // so the kind is not sent: what it needs is which path moved.
            if !sink(&format!("{{\"type\":\"change\",\"name\":{}}}", quote(&relative))) {
                return;
            }
        }
    }
}

/// Watch `root` and report every change under it, one JSON object per line.
///
/// The standalone form, kept for a sandbox reached without the service — it
/// prints to stdout and ends when a write fails.
pub fn watch(root: &str) -> ExitCode {
    let stop = AtomicBool::new(false);
    let mut alive = true;
    watch_tree(root, &stop, &mut |event: &str| {
        alive = say(event);
        alive
    });
    if alive { ExitCode::SUCCESS } else { ExitCode::SUCCESS }
}

/// One JSON string, escaped enough for a filename.
fn quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
