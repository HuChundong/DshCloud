/**
 * Frame codec for the sandbox-initiated tunnel.
 *
 * One WebSocket carries every `/api` interaction for one sandbox. The sandbox
 * dials the gateway, so the gateway never needs inbound reachability into the
 * sandbox network — the property that lets a real sandbox runtime replace the
 * Docker simulation without touching either side of this protocol.
 *
 * Frames are JSON text messages. HTTP bodies stream as separate `body`/`end`
 * frames rather than one inlined payload: dsh accepts request bodies up to
 * `maxRequestBodyBytes` (160 MiB by default, sized for its 100 MiB aggregate
 * image limit after base64 expansion), and a single frame that large would
 * force both peers to hold the whole request in memory at once.
 *
 * Stream ids are allocated by the gateway and are unique per tunnel, never
 * across tunnels; a sandbox may not invent one.
 */

/** Text encoding for every frame on the wire. */
const FRAME_ENCODING = 'utf8'

/**
 * Largest body chunk placed in one frame, before base64 expansion. Keeps a
 * single frame well under common WebSocket buffer limits while staying large
 * enough that a 160 MiB upload does not fan out into an unreasonable number of
 * frames.
 */
const MAX_CHUNK_BYTES = 512 * 1024

/**
 * Frame kinds sent by the gateway toward the sandbox.
 * @typedef {'http' | 'body' | 'end' | 'abort' | 'wsopen' | 'wsclose'} DownFrameKind
 */

/**
 * Frame kinds sent by the sandbox toward the gateway.
 * @typedef {'hello' | 'httpres' | 'resbody' | 'resend' | 'reserr'
 *   | 'wsopenok' | 'wsfail' | 'wsmsg' | 'wsclosed'} UpFrameKind
 */

/**
 * Encode one frame for transmission.
 * @param {object} frame - a frame object carrying a `t` discriminant.
 * @returns {string} the wire representation.
 */
export function encodeFrame(frame) {
  return JSON.stringify(frame)
}

/**
 * Decode one received frame, rejecting anything that is not a tagged object.
 * A peer that sends a malformed frame is a protocol error, not a recoverable
 * condition: the caller is expected to drop the tunnel.
 * @param {string | Buffer | ArrayBuffer} raw - the received message.
 * @returns {object} the decoded frame.
 * @throws {Error} when the payload is not JSON or carries no string `t`.
 */
export function decodeFrame(raw) {
  const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString(FRAME_ENCODING)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('tunnel: frame is not JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.t !== 'string') {
    throw new Error('tunnel: frame carries no string tag')
  }
  return parsed
}

/**
 * Split a body buffer into base64 chunk payloads.
 * @param {Buffer} body - the complete body.
 * @returns {string[]} base64 chunks in order, empty when the body is empty.
 */
export function chunkBody(body) {
  const chunks = []
  for (let offset = 0; offset < body.length; offset += MAX_CHUNK_BYTES) {
    chunks.push(body.subarray(offset, offset + MAX_CHUNK_BYTES).toString('base64'))
  }
  return chunks
}

/**
 * Headers that must never survive the hop into the sandbox.
 *
 * `host` is replaced (not merely dropped) with the sandbox's own loopback
 * authority, and the browser markers are removed outright. dsh guards `/api`
 * with a fence that refuses any request whose `Host` is neither loopback nor a
 * declared `trustedHosts` entry, refuses an explicit `sec-fetch-site:
 * cross-site` marker outright, and requires an attached `Origin` to equal the
 * Host authority. A browser talking to an independently deployed frontend
 * sends exactly the markers that fence rejects, so forwarding them verbatim
 * turns every call into a 403.
 *
 * Rewriting them is also what keeps the loopback-pinned methods reachable —
 * `settings.*`, `credentials.*`, `agentPreset.*`, `host.pickDirectory`,
 * `host.openPath`, and `llm.discoverModels` pass the fence with an empty trust
 * list, so a declared `trustedHosts` authority cannot reach them and only a
 * loopback `Host` can.
 *
 * Hop-by-hop headers are dropped because the tunnel, not the origin request,
 * owns framing and connection lifetime on this leg.
 */
const STRIPPED_REQUEST_HEADERS = Object.freeze([
  'origin',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'cookie',
])

/**
 * Rewrite request headers for delivery to the sandbox-local dsh server.
 *
 * The gateway's own session cookie is stripped along with the browser markers:
 * authentication is settled at the gateway, and dsh has no notion of the
 * gateway's users, so forwarding the cookie would leak one tenant's session
 * token into a container that tenant's agent can read.
 *
 * @param {Record<string, string | string[] | undefined>} headers - inbound request headers.
 * @param {string} localAuthority - the sandbox-local dsh authority (`host:port`), which must be a loopback name.
 * @returns {Record<string, string>} headers safe to replay against local dsh.
 */
export function rewriteRequestHeaders(headers, localAuthority) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (STRIPPED_REQUEST_HEADERS.includes(lower) || lower === 'host') continue
    if (value === undefined) continue
    out[lower] = Array.isArray(value) ? value.join(', ') : value
  }
  out.host = localAuthority
  return out
}
