/**
 * The tunnel, as a plugin inside the dsh process it serves.
 *
 * It replaces a second Node process that sat beside dsh and reached it over
 * loopback. Two things came from that separation and go away with it: about
 * 40 MB of a second V8 heap per tenant, and — the one that actually cost
 * something — the guesswork about when dsh was ready. An outside process can
 * only probe, and it dialled the gateway too early twice: once before the
 * socket accepted connections, once before the API plane was mounted. The
 * gateway releases held browser requests the moment a tunnel appears, so both
 * reached a person. Injecting `connection` states most of that condition
 * instead of sampling it: the service exists only after
 * `dsh-client-connection` has mounted the `/api` route this forwards to.
 *
 * Not all of it, though. The two `/api/events.*` upgrade routes come from a
 * nested inject inside that same plugin, which nothing orders this after, so
 * the last step before dialling is still a probe — see `waitForDownlinks`.
 *
 * Requests still cross the loopback interface rather than being handed to the
 * route's handler in memory. dsh pins its configuration methods
 * (`settings.*`, `credentials.*`, `agentPreset.*`, `host.*`) to callers whose
 * `Host` is loopback, and the check lives inside the shared fetch handler, so
 * an in-memory call would have to construct the same request anyway — while
 * also reaching past the body limits and the route's own composition. One
 * loopback round trip buys behaviour identical to a browser's.
 *
 * @module dsh-gateway-tunnel
 */

import http from 'node:http'
import process from 'node:process'
import WebSocket from 'ws'
import { chunkBody, decodeFrame, encodeFrame, rewriteRequestHeaders } from 'dsh-tunnel-protocol'

export const name = 'gateway-tunnel'

/**
 * `connection` is what orders this against the `/api` route: the service is
 * created in the same apply that registers the route, so its presence means
 * the surface this forwards to exists. `apiProxy` gates the plane behind it,
 * which answers 404 until it is mounted.
 *
 * `timer` is not an ordering constraint but a correctness one, and it was
 * missing. cordis refuses a service the reading context did not inject, and it
 * refuses it *where it is read* rather than at mount — so the one line that
 * uses `ctx.setTimeout`, the redial after a dropped tunnel, threw where nothing
 * catches it and took the tenant's whole backend down with it. From outside
 * that looked like a sandbox that restarts when the gateway does, which is
 * roughly what one expects, so it survived. `timer` is the composition's second
 * entry, mounted long before this one.
 */
export const inject = ['connection', 'apiProxy', 'timer']

/** Delay before redialing after the tunnel drops. */
const RECONNECT_DELAY_MS = 1000

/**
 * Mount the tunnel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context, with `connection` and `apiProxy` injected.
 */
export function apply(ctx) {
  /**
   * Agents currently working, by the identity dsh gives them.
   *
   * A set rather than a flag because a tenant can have several agents at once —
   * a subagent runs beside the one that spawned it — and the sandbox is busy
   * while any of them is.
   * @type {Set<unknown>}
   */
  const busyAgents = new Set()

  /**
   * Tell the gateway whether anything is working in here.
   *
   * This is the half of "idle" that traffic cannot see. A turn that runs for an
   * hour with nobody watching sends nothing through the tunnel — the browser
   * that would have been receiving its output is closed — so on traffic alone
   * the sandbox looks abandoned and is reclaimed with the work inside it.
   *
   * Sent on transitions rather than on a timer, because a timer is traffic and
   * would make every sandbox look busy to the very check this informs.
   */
  const reportActivity = () => { send({ t: 'activity', busy: busyAgents.size > 0 }) }

  // `agent` identifies which one changed; a subagent transitions independently
  // of the agent that spawned it.
  ctx.on('agent/status', ({ agent, status }) => {
    const before = busyAgents.size > 0
    if (status === 'running') busyAgents.add(agent)
    else busyAgents.delete(agent)
    if ((busyAgents.size > 0) !== before) reportActivity()
  })

  // An agent disposed mid-turn never reports going idle, and would otherwise
  // hold the sandbox open for as long as the process lives.
  ctx.on('agent/disposed', ({ agent }) => {
    if (!busyAgents.delete(agent)) return
    if (busyAgents.size === 0) reportActivity()
  })

  const gatewayUrl = process.env.GATEWAY_TUNNEL_URL
  const sandboxId = process.env.SANDBOX_ID
  const token = process.env.SANDBOX_TOKEN
  if (gatewayUrl === undefined || sandboxId === undefined || token === undefined) {
    throw new Error('gateway-tunnel: GATEWAY_TUNNEL_URL, SANDBOX_ID and SANDBOX_TOKEN are required')
  }
  const localAuthority = `127.0.0.1:${ctx.get('webServer').port}`

  /** @type {WebSocket | undefined} */
  let socket
  /** @type {Map<string, import('node:http').ClientRequest>} */
  const requests = new Map()
  /** @type {Map<string, WebSocket>} */
  const sockets = new Map()
  let disposed = false

  /**
   * Send one frame, ignoring sends that race teardown.
   * @param {object} frame - the frame to encode and send.
   */
  const send = (frame) => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(encodeFrame(frame))
  }

  /**
   * Begin one proxied HTTP request against the local `/api` surface.
   * @param {{id: string, method: string, path: string, headers: Record<string, string>}} frame - the opening frame.
   */
  const startHttp = (frame) => {
    const [host, port] = localAuthority.split(':')
    const request = http.request({
      host,
      port: Number(port),
      method: frame.method,
      path: frame.path,
      headers: rewriteRequestHeaders(frame.headers, localAuthority),
    }, (response) => {
      send({ t: 'httpres', id: frame.id, status: response.statusCode ?? 502, headers: response.headers })
      response.on('data', (chunk) => {
        for (const part of chunkBody(chunk)) send({ t: 'resbody', id: frame.id, chunk: part })
      })
      response.on('end', () => {
        send({ t: 'resend', id: frame.id })
        requests.delete(frame.id)
      })
    })
    request.on('error', (error) => {
      ctx.logger?.warn?.(`gateway-tunnel: ${frame.method} ${frame.path} failed: ${error.message}`)
      send({ t: 'reserr', id: frame.id, message: error.message })
      requests.delete(frame.id)
    })
    requests.set(frame.id, request)
  }

  /**
   * Open one downlink against the local `/api` surface.
   *
   * `ws` derives Host from the URL and attaches no Origin, which is what the
   * fence wants; carrying the browser's `sec-websocket-*` headers over would
   * override the handshake key `ws` minted and can verify.
   *
   * @param {{id: string, path: string, headers: Record<string, string>}} frame - the opening frame.
   */
  const startWebSocket = (frame) => {
    const headers = rewriteRequestHeaders(frame.headers, localAuthority)
    delete headers.host
    for (const key of Object.keys(headers)) {
      if (key.startsWith('sec-websocket-')) delete headers[key]
    }
    const downlink = new WebSocket(`ws://${localAuthority}${frame.path}`, { headers })
    downlink.on('open', () => { send({ t: 'wsopenok', id: frame.id }) })
    downlink.on('message', (data, isBinary) => {
      if (isBinary) return
      send({ t: 'wsmsg', id: frame.id, data: data.toString('utf8') })
    })
    downlink.on('close', (code, reason) => {
      send({ t: 'wsclosed', id: frame.id, code, reason: reason.toString('utf8') })
      sockets.delete(frame.id)
    })
    downlink.on('error', (error) => {
      send({ t: 'wsfail', id: frame.id, message: error.message })
      sockets.delete(frame.id)
    })
    sockets.set(frame.id, downlink)
  }

  /**
   * Apply one gateway frame.
   * @param {object} frame - the decoded frame.
   */
  const handle = (frame) => {
    switch (frame.t) {
      case 'http':
        startHttp(frame)
        return
      case 'body':
        requests.get(frame.id)?.write(Buffer.from(frame.chunk, 'base64'))
        return
      case 'end': {
        const request = requests.get(frame.id)
        // A redelivered frame must not end a request that already finished.
        if (request !== undefined && !request.writableEnded) request.end()
        return
      }
      case 'abort':
        requests.get(frame.id)?.destroy()
        requests.delete(frame.id)
        return
      case 'wsopen':
        startWebSocket(frame)
        return
      case 'wsclose':
        sockets.get(frame.id)?.close()
        sockets.delete(frame.id)
        return
      default:
        // Unknown tags are ignored so the gateway can add frame kinds without
        // a lockstep sandbox-image rebuild.
        return
    }
  }

  /** Abandon every local stream this tunnel generation was carrying. */
  const abandon = () => {
    for (const request of requests.values()) request.destroy()
    for (const downlink of sockets.values()) downlink.close()
    requests.clear()
    sockets.clear()
  }

  /** Dial the gateway and serve one tunnel generation, redialing when it ends. */
  const connect = () => {
    if (disposed) return
    const dialed = new WebSocket(gatewayUrl, {
      headers: { 'x-sandbox-token': token, 'x-sandbox-id': sandboxId },
    })
    socket = dialed

    dialed.on('open', () => {
      ctx.logger?.info?.(`gateway-tunnel: connected to ${gatewayUrl} as ${sandboxId}`)
      send({ t: 'hello', sandboxId })
      // Stated on every connection, because the gateway forgets what it knew
      // about a sandbox whose tunnel dropped, and an agent mid-turn when the
      // socket reconnects would otherwise look idle until its next transition.
      send({ t: 'activity', busy: busyAgents.size > 0 })
    })
    dialed.on('message', (raw) => {
      let frame
      try {
        frame = decodeFrame(raw)
      } catch (error) {
        ctx.logger?.error?.(`gateway-tunnel: dropping tunnel — ${error.message}`)
        dialed.close()
        return
      }
      // Contained per frame: this now shares a process with the agent serving
      // this tenant, so an escaping fault would take that down too.
      try {
        handle(frame)
      } catch (error) {
        ctx.logger?.error?.(`gateway-tunnel: frame ${frame.t} failed: ${error.stack ?? error.message}`)
        dialed.close()
      }
    })
    dialed.on('close', () => {
      abandon()
      if (!disposed) ctx.setTimeout(connect, RECONNECT_DELAY_MS)
    })
    // 'error' always precedes 'close', which owns the redial.
    dialed.on('error', (error) => { ctx.logger?.warn?.(`gateway-tunnel: ${error.message}`) })
  }

  /**
   * Resolve once the downlink upgrade routes exist.
   *
   * `inject` gets this plugin as far as `apiProxy`, but the two `/api/events.*`
   * upgrade routes are registered by a *nested* inject inside
   * `dsh-client-connection` that waits on the same service — so nothing orders
   * this plugin after it. Dialling first makes the gateway release held
   * upgrades against a host that has no route for them yet, which reaches the
   * browser as a failed handshake on a freshly built sandbox.
   *
   * A plain GET to those paths answers 426 once they are mounted, which is a
   * statement about the route rather than a guess about timing.
   *
   * @returns {Promise<void>} resolves when both downlinks are routable.
   */
  const waitForDownlinks = async () => {
    for (;;) {
      const codes = await Promise.all(['/api/events.mux', '/api/events.host'].map(
        (path) => fetch(`http://${localAuthority}${path}`, { headers: { Host: localAuthority } })
          .then((response) => response.status)
          .catch(() => 0),
      ))
      if (codes.every((code) => code === 426)) return
      await new Promise((resolve) => { setTimeout(resolve, 100) })
    }
  }

  ctx.effect(() => {
    void waitForDownlinks().then(connect)
    return () => {
      disposed = true
      abandon()
      socket?.close()
    }
  }, 'gateway-tunnel: dial-out connection')
}
