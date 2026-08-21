/**
 * One stream per sandbox, however many people are watching it.
 *
 * The status bar used to poll from every open tab: each asked its own sandbox
 * for its own numbers every five seconds, and went on asking while the tab sat
 * in the background with nobody looking at it. That was moved to the gateway,
 * which fixed the growth with tabs but left a timer per sandbox on the one
 * machine that has every sandbox.
 *
 * Now the sandbox samples itself and this module holds a pipe. The gateway is
 * shared and a sandbox is not: work that runs whether or not anything changed
 * belongs on the end that is already per-tenant. What is left here is fan-out —
 * one stream per sandbox regardless of how many browsers are watching it, torn
 * down when the last one leaves.
 *
 * @module stats
 */



/**
 * How long a stream waits before trying to attach again.
 *
 * Used when a sandbox is not up yet, or when the one it was attached to went
 * away: the stream stays open and reconnects underneath, so a browser never
 * sees the gap as a closed subscription.
 */
const RETRY_MS = 5000

/**
 * envd's reading, reshaped into what the status bar draws.
 *
 * Reshaped rather than forwarded: envd answers with both bytes and mebibytes,
 * a cache figure and a timestamp, and the bar shows three rings. Sending the
 * rest would publish more of the sandbox's internals to a browser than the
 * interface has a use for.
 *
 * @param {object} raw - envd's `/metrics` body.
 * @returns {{cpu: number|null, cores: number, memory: {usedBytes: number, totalBytes: number}, disk: {usedBytes: number, totalBytes: number}}} the reading the bar draws.
 */
function shape(raw) {
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  return {
    // envd reports a percentage; the bar wants a fraction. Null is "not
    // measured yet", which is a state the ring draws differently from zero.
    cpu: raw.cpu_used_pct === undefined ? null : number(raw.cpu_used_pct) / 100,
    cores: number(raw.cpu_count),
    memory: { usedBytes: number(raw.mem_used), totalBytes: number(raw.mem_total) },
    disk: { usedBytes: number(raw.disk_used), totalBytes: number(raw.disk_total) },
  }
}

/**
 * Whether a sandbox is up, answered by whoever actually knows.
 *
 * Set once at start-up from the tunnel registry. Two separate questions live in
 * one payload and this is the difference between them: whether the machine is
 * THERE is a fact the gateway holds and can answer instantly, while what it is
 * DOING is a measurement that travels and may be a few seconds old. Deriving
 * the first from the second — treating a recent report as proof of life — is
 * how a reclaimed sandbox goes on looking healthy until a timer says otherwise.
 *
 * @type {(sandboxId: string) => boolean}
 */
let isLive = () => false

/**
 * Say who knows whether a sandbox is up, and hear about it when that changes.
 *
 * @param {(sandboxId: string) => boolean} predicate - answers whether a sandbox is connected.
 */
export function knowsLiveness(predicate) {
  isLive = predicate
}

/**
 * A sandbox has connected, or gone. Tell whoever is looking, at once.
 *
 * @param {string} sandboxId - the sandbox whose state changed.
 */
export function livenessChanged(sandboxId) {
  const entry = reported.get(sandboxId)
  if (entry === undefined) return
  publish(sandboxId, entry)
}

/**
 * Hand everyone the state as it is now, with whatever figures are to hand.
 *
 * @param {string} sandboxId - the sandbox.
 * @param {object} entry - its record.
 */
function publish(sandboxId, entry) {
  const reading = { ok: isLive(sandboxId), stats: entry.stats }
  entry.last = reading
  for (const reader of entry.readers) reader(reading)
}

/**
 * What each sandbox has reported, and who is listening for it.
 *
 * Keyed by the gateway's id for the sandbox rather than the runtime's handle,
 * because the sandbox reports under the only name it knows: its own
 * `SANDBOX_ID`.
 *
 * @type {Map<string, {last: object|undefined, readers: Set<Function>, changers: Set<Function>, timer: NodeJS.Timeout|undefined}>}
 */
const reported = new Map()

/** The record for one sandbox, created on first use. */
function record(sandboxId) {
  let entry = reported.get(sandboxId)
  if (entry !== undefined) entry.expires = undefined
  if (entry === undefined) {
    entry = { stats: undefined, last: undefined, readers: new Set(), changers: new Set(), timer: undefined, coalescing: false }
    reported.set(sandboxId, entry)
  }
  return entry
}

/**
 * Take one report from a sandbox and hand it to whoever is listening.
 *
 * This is the whole of the gateway's side now. It starts nothing, holds no
 * process and keeps no timer per sandbox beyond the silence one below — the
 * work of watching a tree and sampling a machine happens on the end that is
 * already per-tenant, and arrives here as news.
 *
 * @param {string} sandboxId - the gateway's id for the sandbox, from its own environment.
 * @param {{metrics?: object, changes?: Array<{name: string}>}} report - what it has to say.
 */
export function receiveReport(sandboxId, report) {
  const entry = reported.get(sandboxId)

  // Nobody is listening, so there is nothing to do and nothing to parse. This
  // is the first of three guards, and the one that matters most: a tenant is
  // root in their own sandbox, so the credentials it reports with are not a
  // secret from them, and a forged change event would otherwise make a browser
  // re-read a directory — one line of theirs turned into a call from this
  // gateway into their sandbox. No listener, no amplification.
  //
  // The answer tells the reporter to slow down rather than to stop, so a
  // sandbox nobody is watching costs a message a minute instead of one every
  // five seconds.
  if (entry === undefined || (entry.readers.size === 0 && entry.changers.size === 0)) {
    return { watchers: 0 }
  }

  // Second guard: a bucket per sandbox. Answered rather than dropped, and the
  // connection is left open — measured, closing it costs three times what
  // serving the request does, because the next one then pays for a new one.
  // Refusing loudly is how a flood becomes expensive for the wrong side.
  if (!spend(sandboxId)) return { watchers: 1, slow: true }

  // Figures, and nothing about whether the machine is up: that is the tunnel's
  // to say, and it says it the moment it changes rather than a report later.
  if (report.metrics !== undefined && report.metrics !== null) {
    entry.stats = { id: sandboxId, ...shape(report.metrics) }
    publish(sandboxId, entry)
  }

  // Third guard: changes are coalesced. The panel's answer to any change is to
  // re-read what it is showing, so ten thousand events and one event ask it to
  // do the same thing — and only the first of them should be able to.
  if ((report.changes ?? []).length > 0 && entry.changers.size > 0 && entry.coalescing !== true) {
    entry.coalescing = true
    setTimeout(() => {
      const current = reported.get(sandboxId)
      if (current === undefined) return
      current.coalescing = false
      for (const changer of current.changers) changer({ stale: true })
    }, COALESCE_MS)
  }

  return { watchers: entry.readers.size + entry.changers.size }
}

/** How long changes are gathered before the panel is told to look again. */
const COALESCE_MS = 250

/** How many reports a sandbox may send per second, and how many it may bank. */
const REPORT_RATE = 4
const REPORT_BURST = 20

/** Token buckets, one per sandbox. */
const buckets = new Map()

/**
 * Whether this sandbox may be heard from right now.
 *
 * @param {string} sandboxId - who is reporting.
 * @returns {boolean} whether to take it.
 */
function spend(sandboxId) {
  const now = Date.now()
  const bucket = buckets.get(sandboxId) ?? { tokens: REPORT_BURST, at: now }
  bucket.tokens = Math.min(REPORT_BURST, bucket.tokens + ((now - bucket.at) / 1000) * REPORT_RATE)
  bucket.at = now
  buckets.set(sandboxId, bucket)
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

/**
 * Listen to one sandbox's numbers.
 *
 * @param {string} sandboxId - the gateway's id for the sandbox.
 * @param {(reading: {ok: boolean, stats?: object}) => void} onReading - called with every reading.
 * @returns {() => void} stop listening.
 */
function watchSandbox(sandboxId, onReading) {
  const entry = record(sandboxId)
  entry.readers.add(onReading)
  // Answered now, from what the gateway already knows. A reload used to come
  // back to nothing and wait out the reporting interval before it learned
  // whether the machine was even there — for a fact this process was holding
  // the whole time.
  //
  // The figures beside it may be a few seconds old, and that is the honest
  // shape of the thing: the state is current, the measurements are as recent
  // as the last one that arrived.
  onReading({ ok: isLive(sandboxId), stats: entry.stats })
  return () => {
    const current = reported.get(sandboxId)
    if (current === undefined) return
    current.readers.delete(onReading)
    forget(sandboxId, current)
  }
}

/**
 * Listen to one sandbox's workspace.
 *
 * @param {string} sandboxId - the gateway's id for the sandbox.
 * @param {(event: object) => void} onEvent - called with each change.
 * @returns {() => void} stop listening.
 */
function watchWorkspace(sandboxId, onEvent) {
  const entry = record(sandboxId)
  entry.changers.add(onEvent)
  return () => {
    const current = reported.get(sandboxId)
    if (current === undefined) return
    current.changers.delete(onEvent)
    forget(sandboxId, current)
  }
}

/** Drop a sandbox's record once nobody is listening to either half of it. */
function forget(sandboxId, entry) {
  if (entry.readers.size > 0 || entry.changers.size > 0) return
  // The silence timer goes, because nobody is left to tell. The last reading
  // STAYS.
  //
  // Dropping it was what made a refresh feel slow: the record went with the
  // last listener, so the page came back to nothing and then waited out the
  // sandbox's idle pace — up to twenty seconds of empty rings — before the
  // first reading arrived. Kept, a refresh draws immediately with a figure at
  // most that old, and the live rate resumes when the sandbox next reports and
  // is told somebody is watching again.
  if (entry.timer !== undefined) clearTimeout(entry.timer)
  entry.timer = undefined
  entry.expires = Date.now() + KEEP_MS
}

/**
 * How long a reading outlives the last person who was looking at it.
 *
 * Long enough to cover a reload and a change of mind, short enough that a
 * sandbox which has been reclaimed does not leave a plausible-looking figure
 * behind for the next person to open the panel.
 */
const KEEP_MS = 5 * 60 * 1000

// Nothing here is on a timer per sandbox; this is one sweep for all of them,
// and it only runs while there is something to sweep.
setInterval(() => {
  const now = Date.now()
  for (const [sandboxId, entry] of reported) {
    if (entry.readers.size > 0 || entry.changers.size > 0) continue
    if (entry.expires !== undefined && entry.expires < now) reported.delete(sandboxId)
  }
}, 60 * 1000).unref()

/** The path a browser subscribes on. */
/**
 * Where a sandbox reports to.
 *
 * Under `/_` like the tunnel's own path, because it belongs to the same
 * conversation: this is the deployment talking to itself, not part of the
 * surface a browser sees.
 */
export const REPORT_PATH = '/_report'

export const STATS_PATH = '/sandbox/stats'

/**
 * The headers every stream here answers with.
 *
 * Server-sent events rather than a WebSocket: everything here goes one way,
 * and a stream that only flows downhill needs neither a handshake nor a
 * protocol of its own. It also reconnects by itself, which is the behaviour a
 * status bar wants after a gateway restart.
 *
 * nginx buffers proxied responses by default, which for a stream means the
 * browser sees nothing until the buffer fills. The location says so too; the
 * header is the belt to that pair of braces.
 */
const STREAM_HEAD = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

/**
 * Hold one subscription open across a sandbox that may not be there yet.
 *
 * The head goes out FIRST, before anything is resolved, and that ordering is
 * the whole point of this function. These routes used to resolve the sandbox
 * in the prologue they share with every other panel route and answer 502 when
 * it was not up — and a non-2xx is FATAL to `EventSource`. The browser closed
 * the stream, never retried, and the status bar sat at "connecting" until
 * somebody reloaded the page. A sandbox that is still starting is the most
 * ordinary thing that can happen to a status bar, so it must not be the one
 * failure the bar cannot come back from.
 *
 * So the stream is established unconditionally and every failure underneath it
 * is reported INSIDE it and retried. The attach is re-run from the top each
 * time, which re-resolves the sandbox rather than reusing the id it opened
 * with: a sandbox that was replaced while a tab sat open has a new id, and a
 * subscription pinned to the old one would report the new machine as dead
 * forever.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {(send: (payload: object) => void, retry: () => void) => Promise<(() => void)|undefined>} attach - subscribe; return how to unsubscribe, or undefined to be tried again.
 */
function serveStream(req, res, attach) {
  res.writeHead(200, STREAM_HEAD)

  /** @param {object} payload - one event. */
  const send = (payload) => { res.write(`data: ${JSON.stringify(payload)}\n\n`) }

  let stop
  let timer
  let closed = false

  const detach = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    stop?.()
    stop = undefined
  }

  /**
   * Try again shortly.
   *
   * Only ever SCHEDULES. Tearing down here would race the assignment below —
   * a watcher that is handed a stale reading the moment it joins calls this
   * before `attach` has even returned what stops it.
   */
  const again = () => {
    if (closed || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      detach()
      void open()
    }, RETRY_MS)
  }

  const open = async () => {
    if (closed) return
    let attached
    try {
      attached = await attach(send, again)
    } catch {
      attached = undefined
    }
    // The browser can leave while an attach is in flight.
    if (closed) {
      attached?.()
      return
    }
    if (attached === undefined) {
      again()
      return
    }
    stop = attached
  }

  req.on('close', () => {
    closed = true
    detach()
  })
  void open()
}

/**
 * Serve one browser's subscription to a sandbox's numbers.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {() => Promise<{handle: string, sandboxId: string}>} resolve - the caller's sandbox, resolved afresh on every attempt.
 */
export function serveStats(req, res, resolve) {
  serveStream(req, res, async (send, retry) => {
    let where
    try {
      where = await resolve()
    } catch {
      // Told, not swallowed: to a person a sandbox that is still coming up and
      // one that is not answering are the same state, and the bar draws it.
      send({ ok: false })
      return undefined
    }
    return watchSandbox(where.sandboxId, (reading) => {
      send(reading)
      // A sandbox that stops answering may simply have been replaced, so the
      // next attempt starts over at `resolve` rather than asking this id again.
      if (!reading.ok) retry()
    })
  })
}

/* ------------------------------------------------------------------ watch --

   The workspace's own changes, pushed rather than asked for.

   Same shape as the sampler above and for the same reason, but the saving is
   different in kind: a sample has to be taken, while a change ALREADY happened
   somewhere. The panel used to ask twice over — the canvas every two seconds
   for the newest page, the tree whenever a directory was drawn — for news the
   sandbox could have volunteered. envd's `WatchDir` volunteers it.

   One watch per sandbox, recursive over the workspace, shared by every browser
   the tenant has open, and torn down when the last one leaves.
                                                                             */


/** The path a browser subscribes on. */
export const WATCH_PATH = '/sandbox/watch'

/**
 * Serve one browser's workspace subscription as an event stream.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {() => Promise<{handle: string}>} resolve - the caller's sandbox, resolved afresh on every attempt.
 */
export function serveWatch(req, res, resolve) {
  // Both steps can fail while a sandbox is starting, and both are retried by
  // the stream rather than ending it. The panel asks for nothing on a timer any
  // more, so a watch that quietly gave up would leave the tree and the canvas
  // showing whatever they were showing when it did.
  //
  // A watch that cannot exist here at all is different from one that has not
  // started yet, and it travels down the stream as `{watching: false}` instead
  // of closing it. The stream stays open precisely so the browser does not
  // reconnect: there is nothing to come back to, and the panel's answer is to
  // go back to asking, which it can only do if it is told.
  serveStream(req, res, async (send) => watchWorkspace((await resolve()).sandboxId, send))
}
