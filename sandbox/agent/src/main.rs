//! The small resident tools a sandbox runs on the gateway's behalf.
//!
//! Why anything runs here at all: a sandbox is one machine serving one tenant,
//! and the gateway is one machine serving all of them. Work that has to happen
//! whether or not anything changed — sampling a machine, watching a tree —
//! belongs on the end that is already per-tenant. The gateway then holds a
//! pipe rather than a timer, and its cost stops growing with the number of
//! sandboxes.
//!
//! Why Rust: because that argument only holds if what runs here is small. The
//! first version of this was `node -e '<script>'`, which is 21MB of resident
//! memory and a second of start-up to poll a local HTTP endpoint every five
//! seconds. This is a static binary with no dependencies that does the same in
//! about a megabyte, and starts in the time it takes to open a socket.
//!
//! Why it exits by itself: the gateway starts these through envd and cannot
//! reliably stop them. Closing the stream tears down the gateway's end of the
//! connection and leaves the process at the other end running — the Node
//! version held itself open deliberately, so every gateway restart left one
//! behind for the life of the sandbox. One tenant's machine was found carrying
//! 62 of them, 1.3GB of samplers polling for readers that no longer existed.
//!
//! So nothing here holds itself open. Every write to stdout is checked, and a
//! write that fails is the reader having gone: the process ends there. That is
//! the whole of the lifecycle, and it belongs on this side because this is the
//! side that can observe it.

mod serve;
mod watch;

use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::process::ExitCode;
use std::time::Duration;

/// Where envd answers on the sandbox's own loopback.
const ENVD: &str = "127.0.0.1:49983";

/// How often a reading is taken. The panel's arc is paced to this.
const SAMPLE: Duration = Duration::from_secs(5);

/// How long to wait on a request before giving up on that one reading.
const TIMEOUT: Duration = Duration::from_secs(4);

fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("serve") => match std::env::args().nth(2) {
            Some(root) => serve::serve(&root),
            None => {
                eprintln!("dsh-agent: serve needs the workspace directory");
                ExitCode::from(2)
            }
        },
        Some("metrics") => metrics(),
        Some("watch") => match std::env::args().nth(2) {
            Some(root) => watch::watch(&root),
            None => {
                eprintln!("dsh-agent: watch needs a directory");
                ExitCode::from(2)
            }
        },
        other => {
            eprintln!("dsh-agent: unknown command {:?}", other.unwrap_or("<none>"));
            ExitCode::from(2)
        }
    }
}

/// Poll envd's own `/metrics` and write each reading as one line.
///
/// One line per reading, JSON as envd already produced it: the gateway parses
/// it and nothing here needs to understand it. A reading that cannot be taken
/// is skipped rather than reported — a sandbox whose envd is not up yet is an
/// ordinary state during start-up, and the gateway has its own silence timer
/// for a sandbox that has genuinely stopped answering.
fn metrics() -> ExitCode {
    loop {
        if let Some(body) = read_metrics() {
            // The one thing that is NOT skipped on failure. A write that fails
            // is the gateway having hung up, which is the only signal this has
            // that it is no longer wanted.
            if writeln!(std::io::stdout(), "{}", body.trim()).is_err() {
                return ExitCode::SUCCESS;
            }
            if std::io::stdout().flush().is_err() {
                return ExitCode::SUCCESS;
            }
        }
        std::thread::sleep(SAMPLE);
    }
}

/// One GET to envd, or nothing.
///
/// Hand-written rather than through an HTTP client, because the whole of what
/// is needed is one request to loopback with no redirects, no TLS, no keep
/// alive and no chunked encoding — envd answers a small JSON body with a
/// `Content-Length`. A dependency for that would be larger than this file.
pub fn read_metrics() -> Option<String> {
    let mut stream = TcpStream::connect(ENVD).ok()?;
    stream.set_read_timeout(Some(TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(TIMEOUT)).ok()?;
    // envd wants Basic auth as `root` with an empty password: `cm9vdDo=`.
    let request = concat!(
        "GET /metrics HTTP/1.1\r\n",
        "Host: 127.0.0.1\r\n",
        "Authorization: Basic cm9vdDo=\r\n",
        "Connection: close\r\n",
        "\r\n",
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut raw = Vec::new();
    loop {
        let mut chunk = [0_u8; 4096];
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&chunk[..n]),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
        // A reply larger than this is not the reply that was asked for.
        if raw.len() > 64 * 1024 {
            return None;
        }
    }

    let text = String::from_utf8(raw).ok()?;
    let (head, body) = text.split_once("\r\n\r\n")?;
    // Only a 200 carries numbers. Anything else — envd still starting, envd
    // refusing — is a reading that was not taken.
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        return None;
    }
    Some(body.to_owned())
}
