//! The sandbox's resident reporter.
//!
//! One process per sandbox, started by the entrypoint and living as long as the
//! sandbox does. It watches the workspace, samples the machine, and tells the
//! gateway — the gateway starts nothing and holds nothing.
//!
//! Why it reports rather than being read. The gateway used to start a process
//! per subscription through envd and hold its stdout. Closing that stream tears
//! down the GATEWAY's end and leaves the process running, so every reconnect
//! left one behind: four were found in a sandbox two minutes old, ninety-five
//! in one that had been up a day. Nothing on the gateway's side could fix it —
//! a gateway that dies without cleaning up is the ordinary case, not the
//! exception. Reporting inverts the ownership: the only long-lived thing is
//! this, and it belongs to the sandbox.
//!
//! Why it is not polled. A poll is the reader deciding when work happens, which
//! puts the cost back on the shared end and makes an idle sandbox cost the same
//! as a busy one.
//!
//! How often it speaks is the gateway's answer, not this process's decision.
//! Every report is replied to with how many people are actually listening, and
//! with nobody listening this drops to a message a minute — so two thousand
//! unwatched sandboxes cost the gateway about thirty messages a second between
//! them rather than four hundred.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::ExitCode;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::read_metrics;
use crate::watch::watch_tree;

/// How often to report while somebody is watching.
const WATCHED: Duration = Duration::from_secs(5);

/// How often to report when nobody is.
///
/// Not never: the gateway learns the sandbox is alive, and this learns when
/// somebody starts watching — which is the figure it is really chosen by, since
/// it is the longest a tenant can wait between opening the panel and the rings
/// beginning to MOVE. What they see in the meantime is not nothing: the gateway
/// keeps the last reading across a reload, so the rings draw at once with a
/// figure at most this old.
///
/// Two thousand unwatched sandboxes at this pace cost the gateway two hundred
/// messages a second between them, which is under half of one percent of a
/// core — cheap enough that halving the wait is worth paying for twice.
const IDLE: Duration = Duration::from_secs(10);

/// How long changes are gathered before they are sent.
///
/// A change is reported as soon as it happens rather than at the next interval,
/// because a file appearing is what a tenant is watching FOR. This is only long
/// enough that a build writing a thousand files becomes one report.
const GATHER: Duration = Duration::from_millis(250);

/// The most changes carried in one report.
const MAX_CHANGES: usize = 64;

/// Run until the sandbox ends.
pub fn serve(root: &str) -> ExitCode {
    let Some((host, port)) = gateway() else {
        eprintln!("dsh-agent: GATEWAY_TUNNEL_URL is not a host this can reach");
        return ExitCode::FAILURE;
    };
    let (Ok(id), Ok(token)) = (std::env::var("SANDBOX_ID"), std::env::var("SANDBOX_TOKEN")) else {
        eprintln!("dsh-agent: SANDBOX_ID and SANDBOX_TOKEN are required");
        return ExitCode::FAILURE;
    };

    // Changes are gathered here and drained by the reporting loop, so a build
    // that writes a thousand files becomes one report rather than a thousand.
    let changes: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    {
        let changes = Arc::clone(&changes);
        let root = root.to_owned();
        std::thread::spawn(move || {
            // Never stops: the watch belongs to the sandbox, and the sandbox is
            // what ends it.
            let never = AtomicBool::new(false);
            watch_tree(&root, &never, &mut |event: &str| {
                let mut held = changes.lock().unwrap_or_else(|p| p.into_inner());
                if held.len() < MAX_CHANGES {
                    held.push(event.to_owned());
                }
                true
            });
        });
    }

    loop {
        let taken = {
            let mut held = changes.lock().unwrap_or_else(|p| p.into_inner());
            std::mem::take(&mut *held)
        };
        let metrics = read_metrics().unwrap_or_default();
        let body = format!(
            "{{\"metrics\":{},\"changes\":[{}]}}",
            if metrics.trim().is_empty() { "null" } else { metrics.trim() },
            taken.join(","),
        );

        let every = match post(&host, port, &id, &token, &body) {
            // Watched, so speak at the rate the panel draws at. Unwatched, so
            // speak rarely. The gateway is the one that knows.
            Some(watchers) if watchers > 0 => WATCHED,
            Some(_) => IDLE,
            // Unreachable: the gateway may be restarting. Keep the slow pace
            // rather than hammering something that is already having trouble.
            None => IDLE,
        };

        // Wait for the interval OR for something to happen, whichever comes
        // first. Sleeping the whole interval was the first shape, and it put a
        // tenant's own file changes behind a timer chosen for how often to
        // speak when nothing is happening — up to twenty seconds before a file
        // they had just made appeared in their tree.
        let until = Instant::now() + every;
        while Instant::now() < until {
            std::thread::sleep(GATHER);
            let pending = {
                let held = changes.lock().unwrap_or_else(|p| p.into_inner());
                !held.is_empty()
            };
            if pending {
                break;
            }
        }
    }
}

/// Where the gateway is, taken from the URL the tunnel already dials.
///
/// One address for both, because there is one gateway: deriving it here means
/// nothing new has to be passed into the sandbox for this to work.
fn gateway() -> Option<(String, u16)> {
    let url = std::env::var("GATEWAY_TUNNEL_URL").ok()?;
    let after = url.split("://").nth(1)?;
    let authority = after.split('/').next()?;
    let (host, port) = authority.rsplit_once(':')?;
    Some((host.to_owned(), port.parse().ok()?))
}

/// Send one report, and read back how many people are listening.
///
/// A new connection each time. The idle pace is a message a minute, where a
/// held socket would be two thousand of them sitting on the gateway for
/// nothing; at the watched pace the cost of a connection is still far below the
/// five seconds between reports.
fn post(host: &str, port: u16, id: &str, token: &str, body: &str) -> Option<u32> {
    let mut stream = TcpStream::connect((host, port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok()?;
    let request = format!(
        "POST /_report HTTP/1.1\r\nHost: {host}\r\nx-sandbox-id: {id}\r\nx-sandbox-token: {token}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut raw = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut chunk = [0_u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
        if raw.len() > 16 * 1024 || Instant::now() > deadline {
            break;
        }
    }
    let text = String::from_utf8_lossy(&raw);
    let (_, answer) = text.split_once("\r\n\r\n")?;
    // The one field this acts on. A refusal carries it too, so a sandbox that
    // is being rate limited still learns whether to be quiet.
    let at = answer.find("\"watchers\"")? + "\"watchers\"".len();
    let rest = answer.get(at..)?.trim_start().strip_prefix(':')?.trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}
