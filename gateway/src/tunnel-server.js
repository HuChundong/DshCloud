/**
 * Gateway side of the sandbox tunnel: accepts sandbox dial-ins and multiplexes
 * browser `/api` traffic into the right one.
 *
 * The gateway allocates every stream id, so a sandbox can only answer streams
 * the gateway opened and can never address another tenant's stream.
 */

import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { chunkBody, decodeFrame, encodeFrame } from 'dsh-tunnel-protocol'

/** How long to wait for a sandbox to answer an opening frame before failing the stream. */
const STREAM_OPEN_TIMEOUT_MS = 30_000

/**
 * Downlink frames held for a stream whose browser socket has not attached yet.
 * Reached only if the upgrade never completes, where the stream is failing
 * anyway; the cap exists so that case cannot consume memory indefinitely.
 */
const MAX_PENDING_DOWNLINK_FRAMES = 1024

/**
 * One connected sandbox and the streams currently flowing through it.
 */
class SandboxTunnel {
  /**
   * @param {string} sandboxId - the sandbox this tunnel serves.
   * @param {import('ws').WebSocket} socket - the sandbox's dialed-in socket.
   */
  constructor(sandboxId, socket) {
    this.sandboxId = sandboxId
    this.socket = socket
    /**
     * Whether anything is working inside this sandbox, as it last told us.
     *
     * The half of "idle" that traffic cannot see: an agent turn with no browser
     * attached sends nothing through here, so on traffic alone the sandbox
     * looks abandoned while it is doing the work it exists for. Starts false
     * because a sandbox that has said nothing has started nothing.
     */
    this.agentBusy = false

    /**
     * When a frame last crossed this tunnel in either direction.
     *
     * What "idle" is judged on. The tunnel carries no heartbeat — every frame
     * is a request, a response, or a session event — so silence here is real
     * silence, and a running agent turn keeps stamping this as it streams.
     */
    this.lastActiveAt = Date.now()
    /** @type {Map<string, {res: import('node:http').ServerResponse, timer: NodeJS.Timeout}>} */
    this.httpStreams = new Map()
    /** @type {Map<string, {socket: import('ws').WebSocket | undefined, settle: ((ok: boolean) => void) | undefined, pending: string[]}>} */
    this.wsStreams = new Map()
  }

  /**
   * @param {object} frame - the frame to send.
   */
  send(frame) {
    if (this.socket.readyState !== this.socket.OPEN) return
    this.lastActiveAt = Date.now()
    this.socket.send(encodeFrame(frame))
  }

  /**
   * Proxy one browser HTTP request into the sandbox.
   * @param {import('node:http').IncomingMessage} req - the browser request.
   * @param {import('node:http').ServerResponse} res - the response to fill.
   */
  proxyHttp(req, res) {
    const id = randomUUID()
    const timer = setTimeout(() => {
      if (!this.httpStreams.has(id)) return
      this.httpStreams.delete(id)
      if (!res.headersSent) res.writeHead(504)
      res.end('sandbox did not answer')
    }, STREAM_OPEN_TIMEOUT_MS)
    this.httpStreams.set(id, { res, timer })

    this.send({ t: 'http', id, method: req.method, path: req.url, headers: req.headers })
    if (req.readableEnded) {
      // The asset fallback path already read this request to completion against
      // the web container, so no further 'end' will fire and the sandbox would
      // wait forever for a body that is already finished.
      this.send({ t: 'end', id })
    } else {
      req.on('data', (chunk) => {
        for (const part of chunkBody(chunk)) this.send({ t: 'body', id, chunk: part })
      })
      req.on('end', () => { this.send({ t: 'end', id }) })
    }
    // A browser that hangs up mid-request leaves the sandbox holding one whose
    // body never ends. `close` also fires on normal completion, where the
    // stream is already gone and this is a no-op; when it is still present the
    // browser left early, and aborting beats letting dsh finish work whose
    // response has nowhere to go.
    res.on('close', () => {
      const stream = this.httpStreams.get(id)
      if (stream === undefined) return
      clearTimeout(stream.timer)
      this.httpStreams.delete(id)
      this.send({ t: 'abort', id })
    })
  }

  /**
   * Open one downlink WebSocket inside the sandbox and bridge it to the browser.
   *
   * Resolution waits for the sandbox to confirm its local upgrade, so a browser
   * upgrade is only completed once the dsh end is actually open. Reporting
   * readiness earlier would let the frontend believe a downlink exists while
   * the sandbox was still failing to open it.
   *
   * @param {string} path - the `/api` downlink path.
   * @param {Record<string, string | string[] | undefined>} headers - the browser's request headers.
   * @returns {Promise<{id: string, attach: (socket: import('ws').WebSocket) => void} | undefined>} the opened stream, or undefined when the sandbox refused.
   */
  async openWebSocket(path, headers) {
    const id = randomUUID()
    /** @type {(ok: boolean) => void} */
    let settle = () => {}
    const opened = new Promise((resolve) => {
      settle = resolve
      setTimeout(() => { resolve(false) }, STREAM_OPEN_TIMEOUT_MS)
    })
    this.wsStreams.set(id, { socket: undefined, settle, pending: [] })
    this.send({ t: 'wsopen', id, path, headers })

    if (!await opened) {
      this.wsStreams.delete(id)
      return undefined
    }
    return {
      id,
      attach: (socket) => {
        const stream = this.wsStreams.get(id)
        if (stream === undefined) {
          socket.close()
          return
        }
        stream.socket = socket
        // Flush in arrival order before any later frame can reach the socket,
        // so the browser sees one uninterrupted event sequence.
        for (const held of stream.pending) socket.send(held)
        stream.pending.length = 0
        socket.on('close', () => {
          this.send({ t: 'wsclose', id })
          this.wsStreams.delete(id)
        })
      },
    }
  }

  /**
   * Apply one sandbox frame.
   * @param {object} frame - the decoded frame.
   */
  handle(frame) {
    this.lastActiveAt = Date.now()
    switch (frame.t) {
      case 'activity': {
        this.agentBusy = frame.busy === true
        return
      }
      case 'httpres': {
        const stream = this.httpStreams.get(frame.id)
        if (stream === undefined) return
        clearTimeout(stream.timer)
        // Hop-by-hop headers describe the sandbox-local connection, not this one.
        const headers = { ...frame.headers }
        delete headers.connection
        delete headers['transfer-encoding']
        delete headers['keep-alive']
        stream.res.writeHead(frame.status, headers)
        return
      }
      case 'resbody': {
        this.httpStreams.get(frame.id)?.res.write(Buffer.from(frame.chunk, 'base64'))
        return
      }
      case 'resend': {
        this.httpStreams.get(frame.id)?.res.end()
        this.httpStreams.delete(frame.id)
        return
      }
      case 'reserr': {
        console.error(`gateway: sandbox ${this.sandboxId} request failed: ${frame.message}`)
        const stream = this.httpStreams.get(frame.id)
        if (stream === undefined) return
        clearTimeout(stream.timer)
        if (!stream.res.headersSent) stream.res.writeHead(502)
        stream.res.end('sandbox request failed')
        this.httpStreams.delete(frame.id)
        return
      }
      case 'wsopenok': {
        this.wsStreams.get(frame.id)?.settle?.(true)
        return
      }
      case 'wsfail': {
        this.wsStreams.get(frame.id)?.settle?.(false)
        this.wsStreams.delete(frame.id)
        return
      }
      case 'wsmsg': {
        const stream = this.wsStreams.get(frame.id)
        if (stream === undefined) return
        const socket = stream.socket
        // The sandbox begins pushing the moment its local downlink opens, which
        // can precede the browser upgrade completing here. These are session
        // events with no replay behind them, so they are held rather than
        // dropped; the bound keeps a stream that never attaches from growing
        // without limit.
        if (socket === undefined) {
          if (stream.pending.length < MAX_PENDING_DOWNLINK_FRAMES) stream.pending.push(frame.data)
          return
        }
        if (socket.readyState === socket.OPEN) socket.send(frame.data)
        return
      }
      case 'wsclosed': {
        this.wsStreams.get(frame.id)?.socket?.close()
        this.wsStreams.delete(frame.id)
        return
      }
      default:
        return
    }
  }

  /**
   * Fail every stream this tunnel was carrying.
   *
   * Closing all bridged browser sockets together is required, not tidiness:
   * the frontend treats either downlink ending as loss of the whole connection
   * generation and rebuilds both. Leaving one socket open while the other dies
   * would strand it against a generation the client has already abandoned.
   */
  destroy() {
    for (const { res, timer } of this.httpStreams.values()) {
      clearTimeout(timer)
      if (!res.headersSent) res.writeHead(502)
      res.end('sandbox tunnel closed')
    }
    this.httpStreams.clear()
    for (const stream of this.wsStreams.values()) {
      stream.settle?.(false)
      stream.socket?.close()
    }
    this.wsStreams.clear()
  }
}

/**
 * Registry of connected sandboxes.
 */
export class TunnelServer {
  /**
   * @param {(sandboxId: string, token: string) => boolean} authorize - decides whether a dial-in is a sandbox this gateway started.
   */
  constructor(authorize, onLiveness = () => {}) {
    this.authorize = authorize
    /**
     * Told whenever a sandbox connects or goes.
     *
     * Whether a sandbox is up is something this knows the moment it changes,
     * and it is the only truthful answer to that question — anything derived
     * from how recently the sandbox last said something is a guess with a
     * delay in it. The status bar asks for the truth, so it is handed it from
     * here rather than inferred somewhere else.
     */
    this.onLiveness = onLiveness
    /** @type {Map<string, SandboxTunnel>} */
    this.tunnels = new Map()
    /** @type {Map<string, Array<() => void>>} */
    this.waiters = new Map()
    this.server = new WebSocketServer({ noServer: true })
  }

  /**
   * Whether a sandbox is currently connected.
   * @param {string} sandboxId - the sandbox to check.
   * @returns {boolean} true when a tunnel is live.
   */
  has(sandboxId) {
    return this.tunnels.has(sandboxId)
  }

  /**
   * Look up a live tunnel.
   * @param {string} sandboxId - the sandbox to reach.
   * @returns {SandboxTunnel | undefined} the tunnel, when connected.
   */
  get(sandboxId) {
    return this.tunnels.get(sandboxId)
  }

  /**
   * Whether a browser is attached to a sandbox, and whether anything is
   * working inside it.
   *
   * The two are separate questions and the idle sweep needs both. A browser
   * holds the `/api` event socket open for as long as its page is loaded, so
   * its absence means the person closed the tab — which is when a sandbox
   * doing nothing may go quickly. What it must never mean is reclaiming one
   * mid-turn, which is what `busy` is for.
   *
   * @param {string} sandboxId - the sandbox to ask about.
   * @returns {{attached: boolean, busy: boolean} | undefined} the two, or undefined when no tunnel is connected.
   */
  presenceOf(sandboxId) {
    const tunnel = this.tunnels.get(sandboxId)
    if (tunnel === undefined) return undefined
    return { attached: tunnel.wsStreams.size > 0, busy: tunnel.agentBusy }
  }

  /**
   * When traffic last crossed a sandbox's tunnel.
   *
   * The idle sweep's second opinion. Requests are stamped when they start, so
   * that signal alone calls a sandbox idle while it is streaming the answer to
   * one long agent turn — the reply arrives as session events on a socket
   * opened long before, and nothing new starts for as long as the turn runs.
   *
   * @param {string} sandboxId - the sandbox to ask about.
   * @returns {number | undefined} the epoch milliseconds of the last frame, or undefined when no tunnel is connected.
   */
  lastActiveAt(sandboxId) {
    return this.tunnels.get(sandboxId)?.lastActiveAt
  }

  /**
   * Resolve once the named sandbox has dialed in.
   * @param {string} sandboxId - the sandbox to await.
   * @param {number} timeoutMs - how long to wait before giving up.
   * @returns {Promise<SandboxTunnel | undefined>} the tunnel, or undefined on timeout.
   */
  async waitFor(sandboxId, timeoutMs) {
    const existing = this.tunnels.get(sandboxId)
    if (existing !== undefined) return existing
    return await new Promise((resolve) => {
      const timer = setTimeout(() => { resolve(undefined) }, timeoutMs)
      const waiters = this.waiters.get(sandboxId) ?? []
      waiters.push(() => {
        clearTimeout(timer)
        resolve(this.tunnels.get(sandboxId))
      })
      this.waiters.set(sandboxId, waiters)
    })
  }

  /**
   * Accept one sandbox dial-in.
   * @param {import('node:http').IncomingMessage} req - the upgrade request.
   * @param {import('node:stream').Duplex} socket - the raw socket.
   * @param {Buffer} head - the upgrade head.
   */
  handleUpgrade(req, socket, head) {
    const sandboxId = req.headers['x-sandbox-id']
    const token = req.headers['x-sandbox-token']
    if (typeof sandboxId !== 'string' || typeof token !== 'string' || !this.authorize(sandboxId, token)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    this.server.handleUpgrade(req, socket, head, (ws) => {
      const tunnel = new SandboxTunnel(sandboxId, ws)
      // A redial replaces the previous generation; the old one's streams are
      // unreachable either way, so failing them now beats leaking them.
      this.tunnels.get(sandboxId)?.destroy()
      this.tunnels.set(sandboxId, tunnel)
      this.onLiveness(sandboxId, true)
      console.log(`gateway: sandbox ${sandboxId} connected`)
      for (const wake of this.waiters.get(sandboxId) ?? []) wake()
      this.waiters.delete(sandboxId)

      ws.on('message', (raw) => {
        let frame
        try {
          frame = decodeFrame(raw)
        } catch (error) {
          console.error(`gateway: dropping sandbox ${sandboxId} — ${error.message}`)
          ws.close()
          return
        }
        // Contain a handler fault to the tunnel that produced it. The gateway
        // serves every tenant from one process, so an exception escaping here
        // would take all of them down together.
        try {
          tunnel.handle(frame)
        } catch (error) {
          console.error(`gateway: sandbox ${sandboxId} frame ${frame.t} failed: ${error.stack ?? error.message}`)
          ws.close()
        }
      })
      ws.on('close', () => {
        tunnel.destroy()
        if (this.tunnels.get(sandboxId) === tunnel) {
          this.tunnels.delete(sandboxId)
          this.onLiveness(sandboxId, false)
        }
        console.log(`gateway: sandbox ${sandboxId} disconnected`)
      })
      ws.on('error', (error) => { console.error(`gateway: sandbox ${sandboxId}: ${error.message}`) })
    })
  }
}
