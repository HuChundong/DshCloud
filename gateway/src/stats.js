/**
 * One sample per sandbox, however many people are watching it.
 *
 * The status bar used to poll: every open tab asked its own sandbox for its
 * own numbers every five seconds, down the tunnel, and went on asking while
 * the tab sat in the background with nobody looking at it. The cost of that
 * grows with tabs, which is the wrong thing for it to grow with — a machine
 * has one temperature no matter how many thermometers are pointed at it.
 *
 * So the sampling moved here. A sandbox is sampled while at least one browser
 * is watching it and not otherwise, at one interval regardless of how many
 * are, and every watcher gets the same reading. A tenant with three tabs open
 * costs exactly what a tenant with one does; a tenant with none costs nothing.
 *
 * What this is NOT is a push from the sandbox. Nothing about CPU usage is an
 * event — envd offers a `GET /metrics` and something has to ask it. Pushing
 * would not remove the sampling, only move it; what removes work is asking
 * once for everyone, and not asking when nobody is listening.
 *
 * @module stats
 */

import { metrics, watchDir } from './envd.js'
import { ROOT } from './panel-path.js'

/**
 * How often a watched sandbox is measured.
 *
 * The same cadence the browser used to poll at, so nothing about how the
 * numbers move on screen changes — only how many times they are fetched.
 */
const SAMPLE_MS = 5000

/** Sandboxes being watched: id → { timer, watchers, last }. */
const watched = new Map()

/**
 * Sample one sandbox and hand the reading to everyone watching it.
 *
 * A failed sample is reported as a failure rather than skipped: to a person a
 * sandbox that stops answering is the status, not the absence of one.
 *
 * @param {string} handle - the runtime's address for the sandbox to measure.
 */
async function sample(handle) {
  const entry = watched.get(handle)
  if (entry === undefined) return
  let reading
  try {
    // The id rides along with the numbers because the page that shows them
    // also shows it: it is the one thing a tenant has to quote when reporting
    // that their machine misbehaved. Harmless to tell its owner — reaching the
    // sandbox needs the token, which never leaves the sandbox and the gateway.
    reading = { ok: true, stats: { id: entry.id, ...shape(await metrics(handle)) } }
  } catch {
    reading = { ok: false }
  }
  // Watchers can leave while a sample is in flight.
  const current = watched.get(handle)
  if (current === undefined) return
  current.last = reading
  for (const watcher of current.watchers) watcher(reading)
}

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
 * Watch one sandbox.
 *
 * The first watcher starts the timer and gets a reading immediately; the last
 * one to leave stops it. A watcher that arrives while a sandbox is already
 * being sampled is handed the last reading at once rather than waiting out an
 * interval for the first one.
 *
 * @param {string} handle - the runtime's address for the sandbox to watch.
 * @param {string} id - the gateway's id for it, which is what the bar shows.
 * @param {(reading: {ok: boolean, stats?: object}) => void} onReading - called with every sample.
 * @returns {() => void} stop watching.
 */
export function watchSandbox(handle, id, onReading) {
  let entry = watched.get(handle)
  if (entry === undefined) {
    entry = { timer: undefined, watchers: new Set(), last: undefined, id }
    watched.set(handle, entry)
    entry.timer = setInterval(() => { void sample(handle) }, SAMPLE_MS)
    void sample(handle)
  }
  entry.watchers.add(onReading)
  if (entry.last !== undefined) onReading(entry.last)

  return () => {
    const current = watched.get(handle)
    if (current === undefined) return
    current.watchers.delete(onReading)
    if (current.watchers.size > 0) return
    clearInterval(current.timer)
    watched.delete(handle)
  }
}

/** The path a browser subscribes on. */
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
    }, SAMPLE_MS)
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
    return watchSandbox(where.handle, where.sandboxId, (reading) => {
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

/** Sandboxes being watched: id → { handle, watchers }. */
const watching = new Map()

/**
 * Hear about changes under a sandbox's workspace.
 *
 * @param {string} handle - the runtime's address for the sandbox to watch.
 * @param {(event: {name: string, type: string}) => void} onEvent - called with each change.
 * @returns {Promise<() => void>} stop watching.
 */
export async function watchWorkspace(handle, onEvent) {
  let entry = watching.get(handle)
  if (entry === undefined) {
    entry = { handle: undefined, watchers: new Set() }
    watching.set(handle, entry)
    try {
      entry.handle = await watchDir(handle, ROOT, {
        onEvent: (event) => {
          for (const watcher of watching.get(handle)?.watchers ?? []) watcher(event)
        },
        // A watch that ends — the sandbox went away, envd restarted — is
        // forgotten rather than retried here. The browsers reconnect their own
        // streams, and the next one to arrive opens a fresh watch.
        onEnd: () => { watching.delete(handle) },
        onError: () => { watching.delete(handle) },
      })
    } catch (error) {
      watching.delete(handle)
      throw error
    }
  }
  entry.watchers.add(onEvent)

  return () => {
    const current = watching.get(handle)
    if (current === undefined) return
    current.watchers.delete(onEvent)
    if (current.watchers.size > 0) return
    current.handle?.close()
    watching.delete(handle)
  }
}

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
  serveStream(req, res, async (send) => await watchWorkspace((await resolve()).handle, send))
}
