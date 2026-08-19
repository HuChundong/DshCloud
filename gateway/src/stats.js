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

import { streamMetrics, watchDir } from './envd.js'
import { ROOT } from './panel-path.js'

/**
 * How long a stream may say nothing before it is treated as dead.
 *
 * The sampler inside the sandbox reports every five seconds, so silence for
 * several times that is not a quiet machine — it is a machine that stopped
 * answering, which is a status a person needs to see.
 */
const SILENCE_MS = 20000

/** Sandboxes being watched: handle → { stream, watchers, last, id, timer }. */
const watched = new Map()

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
 * Watch one sandbox's own measurements.
 *
 * The first watcher starts the sandbox's sampler; the last one to leave stops
 * it. A watcher that arrives while a sandbox is already streaming is handed the
 * last reading at once rather than waiting out an interval for the first one.
 *
 * @param {string} handle - the runtime's address for the sandbox to watch.
 * @param {string} id - the gateway's id for it, which is what the bar shows.
 * @param {(reading: {ok: boolean, stats?: object}) => void} onReading - called with every sample.
 * @returns {Promise<() => void>} stop watching.
 */
async function watchSandbox(handle, id, onReading) {
  let entry = watched.get(handle)
  if (entry === undefined) {
    entry = { stream: undefined, watchers: new Set(), last: undefined, id, timer: undefined }
    watched.set(handle, entry)

    /** @param {{ok: boolean, stats?: object}} reading - what to hand out. */
    const publish = (reading) => {
      const current = watched.get(handle)
      if (current === undefined) return
      current.last = reading
      for (const watcher of current.watchers) watcher(reading)
    }

    // A stream that goes quiet is a sandbox that stopped answering, and to a
    // person that IS the status. Rearmed on every reading rather than checked
    // on a schedule, so a healthy sandbox costs one cleared timeout per sample.
    const heard = () => {
      const current = watched.get(handle)
      if (current === undefined) return
      if (current.timer !== undefined) clearTimeout(current.timer)
      current.timer = setTimeout(() => { publish({ ok: false }) }, SILENCE_MS)
    }

    try {
      entry.stream = await streamMetrics(handle, {
        onSample: (raw) => {
          heard()
          // The id rides along with the numbers because the page that shows
          // them also shows it: it is the one thing a tenant has to quote when
          // reporting that their machine misbehaved.
          publish({ ok: true, stats: { id, ...shape(raw) } })
        },
        onEnd: () => { publish({ ok: false }) },
        onError: () => { publish({ ok: false }) },
      })
      heard()
    } catch (error) {
      watched.delete(handle)
      throw error
    }
  }
  entry.watchers.add(onReading)
  if (entry.last !== undefined) onReading(entry.last)

  return () => {
    const current = watched.get(handle)
    if (current === undefined) return
    current.watchers.delete(onReading)
    if (current.watchers.size > 0) return
    if (current.timer !== undefined) clearTimeout(current.timer)
    current.stream?.close()
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
    return await watchSandbox(where.handle, where.sandboxId, (reading) => {
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
async function watchWorkspace(handle, onEvent) {
  let entry = watching.get(handle)
  if (entry === undefined) {
    entry = { handle: undefined, watchers: new Set() }
    watching.set(handle, entry)
    /**
     * Tell every watcher the workspace is no longer being watched.
     *
     * Said rather than swallowed, and this is the important half. envd refuses
     * to watch a network filesystem — `cannot watch path on network
     * filesystem` — and a tenant's workspace is exactly that wherever it is a
     * volume, which is to say in production. The refusal arrives AFTER the
     * stream is established, so the call succeeds and the watch is dead a
     * moment later.
     *
     * Left unsaid, that is the worst of both: the panel believes it will be
     * told about changes and is never told, so a directory the tenant just
     * made never appears; and the browser, seeing its stream close, reconnects
     * to open another watch that will fail the same way, for as long as the
     * tab is open.
     *
     * @param {string} reason - what ended it.
     */
    const stopped = (reason) => {
      const current = watching.get(handle)
      watching.delete(handle)
      for (const watcher of current?.watchers ?? []) watcher({ watching: false, reason })
    }
    try {
      entry.handle = await watchDir(handle, ROOT, {
        onEvent: (event) => {
          for (const watcher of watching.get(handle)?.watchers ?? []) watcher(event)
        },
        onEnd: () => { stopped('ended') },
        onError: (error) => { stopped(error.message) },
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
  //
  // A watch that cannot exist here at all is different from one that has not
  // started yet, and it travels down the stream as `{watching: false}` instead
  // of closing it. The stream stays open precisely so the browser does not
  // reconnect: there is nothing to come back to, and the panel's answer is to
  // go back to asking, which it can only do if it is told.
  serveStream(req, res, async (send) => await watchWorkspace((await resolve()).handle, send))
}
