/**
 * envd's process API — how the gateway starts a tenant's backend inside their
 * sandbox.
 *
 * This is CubeSandbox's data plane, and it is a separate address from the
 * management API in `cubesandbox.js`: management calls go to CubeAPI, while
 * everything addressed *into* a sandbox goes through CubeProxy, which routes on
 * a virtual hostname of the form `<port>-<sandboxID>.<domain>`. That name is not
 * in DNS for a local deployment, so the connection is dialled straight at the
 * CubeProxy node with the virtual name kept in the `Host` header — the same
 * thing `curl --resolve` does, and what the CubeSandbox SDKs do with a custom
 * dispatcher.
 *
 * Starting the backend from out here, rather than from the image's CMD, is
 * forced by what a template is: a snapshot of the image *running*. A CMD would
 * be captured in that snapshot — started before any tenant existed, and restored
 * identically into every sandbox — so it could never carry the identity that
 * makes a sandbox one tenant's. Starting it per sandbox is also what a later
 * restore-from-pause needs, since the backend can be started again against a
 * sandbox that already exists.
 *
 * Two services are used. `process.Process` starts a tenant's backend, and now
 * also resolves one path on their behalf; `filesystem.Filesystem` answers what
 * the right-hand panel asks about their workspace, alongside envd's own HTTP
 * reader for a file's bytes.
 *
 * Everything the panel calls is bounded by `gateway/src/panel-path.js` before
 * it arrives here. Nothing in this file judges a path — envd runs as root and
 * will read whatever it is given, so a caller that skipped the fence would get
 * exactly what it asked for.
 */

import { randomUUID } from 'node:crypto'
import http from 'node:http'
import process from 'node:process'

/** The port envd listens on inside every sandbox. */
const ENVD_PORT = 49983

/**
 * The CubeProxy node connections into a sandbox are dialled at, and the port its
 * HTTP data plane listens on. Required rather than defaulted: a gateway pointed
 * at the wrong proxy fails on every sandbox it starts, and the failure looks
 * like a sandbox that never dials in.
 */
const PROXY_NODE_IP = process.env.CUBE_PROXY_NODE_IP
const PROXY_PORT = Number(process.env.CUBE_PROXY_PORT_HTTP ?? 30080)

/** The suffix CubeProxy routes sandbox hostnames under. */
const SANDBOX_DOMAIN = process.env.CUBE_SANDBOX_DOMAIN ?? 'cube.app'

/**
 * Which runtime provides the sandboxes, read the same way `runtimes.js` reads
 * it. Read here rather than imported to keep the two files from depending on
 * each other — `runtimes.js` already imports this one.
 */
const RUNTIME = process.env.SANDBOX_RUNTIME === 'cube' ? 'cube' : 'docker'

/**
 * Where to dial to reach one sandbox's envd, and what to call it on arrival.
 *
 * The two runtimes differ only here. A CubeSandbox has no address of its own
 * that this host can route to, so the connection goes to the CubeProxy node
 * and carries the sandbox's virtual name in `Host` — the same thing
 * `curl --resolve` does. A container has a real address: Docker's own DNS
 * resolves its name on the network the gateway shares with it, so the name is
 * the address and no `Host` games are needed.
 *
 * The container's name is derived from the sandbox id rather than remembered,
 * because `runtimes.js` derives it the same way when it creates the container.
 * Two derivations of one rule, which is a thing to keep in step — but the
 * alternative is threading a runtime-specific handle through every caller of
 * every function in this file.
 *
 * @param {string} sandboxId - the sandbox to reach.
 * @returns {{host: string, port: number, hostHeader: string|undefined}} where to dial.
 */
function endpointOf(sandboxId) {
  if (RUNTIME === 'docker') {
    return { host: `dsh-sandbox-${sandboxId.slice(0, 12)}`, port: ENVD_PORT, hostHeader: undefined }
  }
  if (PROXY_NODE_IP === undefined) {
    throw new Error('envd: CUBE_PROXY_NODE_IP is required to reach a sandbox')
  }
  return { host: PROXY_NODE_IP, port: PROXY_PORT, hostHeader: `${ENVD_PORT}-${sandboxId}.${SANDBOX_DOMAIN}` }
}

/** The sandbox user commands run as. The backend owns the whole machine. */
const ENVD_USER = 'root'

/** Connect protocol framing: `[flags:1][length:4 big-endian][payload]`. */
const ENVELOPE_HEADER_BYTES = 5

/** Set on the trailer envelope that closes a Connect stream. */
const END_STREAM_FLAG = 0x02

/**
 * Wrap one Connect message in its envelope.
 * @param {object} message - the message to encode.
 * @returns {Buffer} the framed envelope.
 */
function encodeEnvelope(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.alloc(ENVELOPE_HEADER_BYTES)
  header.writeUInt8(0, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

/**
 * Split a Connect stream body into its envelopes.
 *
 * A truncated trailing envelope is dropped rather than reported: it can only
 * happen if the response body ended mid-frame, which the caller already sees as
 * a stream that carried no end event.
 *
 * @param {Buffer} body - the complete response body.
 * @returns {Array<{flags: number, message: object}>} the decoded envelopes in order.
 */
function decodeEnvelopes(body) {
  const envelopes = []
  let offset = 0
  while (offset + ENVELOPE_HEADER_BYTES <= body.length) {
    const flags = body.readUInt8(offset)
    const length = body.readUInt32BE(offset + 1)
    const start = offset + ENVELOPE_HEADER_BYTES
    if (start + length > body.length) break
    const payload = body.subarray(start, start + length)
    envelopes.push({ flags, message: payload.length === 0 ? {} : JSON.parse(payload.toString('utf8')) })
    offset = start + length
  }
  return envelopes
}

/**
 * Issue one request to a sandbox's envd through CubeProxy.
 *
 * `node:http` rather than `fetch`, because under CubeSandbox the whole
 * mechanism is a `Host` header that names somewhere other than the address
 * dialled, and `fetch` forbids setting `Host`.
 *
 * @param {string} sandboxId - the sandbox to address.
 * @param {string} path - the envd path to call.
 * @param {Buffer} body - the encoded request body.
 * @param {Record<string, string>} headers - request headers, less `Host`.
 * @param {string} [method] - the HTTP method; `POST` for every Connect call, `GET` for envd's file reader.
 * @returns {Promise<{status: number, body: Buffer}>} the response status and complete body.
 */
async function envdRequest(sandboxId, path, body, headers, method = 'POST') {
  const endpoint = endpointOf(sandboxId)
  return await new Promise((resolve, reject) => {
    const request = http.request({
      host: endpoint.host,
      port: endpoint.port,
      method,
      path,
      headers: {
        ...headers,
        ...(endpoint.hostHeader === undefined ? {} : { Host: endpoint.hostHeader }),
        // A GET carries no body and must not announce one: some servers read
        // `Content-Length: 0` on a GET as a framing error.
        ...(body === undefined ? {} : { 'Content-Length': String(body.length) }),
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks) })
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

/**
 * Run one command inside a sandbox and wait for it to exit.
 *
 * Intended for commands that return promptly. The gateway's one use starts the
 * backend detached and returns immediately, so the wait costs nothing and the
 * exit code turns a failed start into a failed sandbox creation rather than a
 * sandbox that silently never dials in.
 *
 * @param {string} sandboxId - the sandbox to run in.
 * @param {string} command - the shell command, run under `/bin/bash -l -c`.
 * @param {Record<string, string>} envs - environment for the command and anything it starts.
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} what the command did.
 * @throws {Error} when envd refuses the call or the stream ends with no exit code.
 */
async function runCommand(sandboxId, command, envs) {
  const payload = {
    process: { cmd: '/bin/bash', args: ['-l', '-c', command], envs },
    stdin: false,
  }
  const { status, body } = await envdRequest(sandboxId, '/process.Process/Start', encodeEnvelope(payload), {
    'Content-Type': 'application/connect+json',
    'Connect-Protocol-Version': '1',
    'Connect-Content-Encoding': 'identity',
    Authorization: `Basic ${Buffer.from(`${ENVD_USER}:`).toString('base64')}`,
  })
  if (status >= 400) {
    throw new Error(`envd: starting a process in ${sandboxId} failed (${status}): ${body.toString('utf8').trim()}`)
  }

  const stdout = []
  const stderr = []
  let exitCode
  for (const { flags, message } of decodeEnvelopes(body)) {
    if ((flags & END_STREAM_FLAG) !== 0) {
      // The trailer reports a stream-level failure — envd refusing the call
      // after headers were sent — which is distinct from the command failing.
      if (message.error !== undefined) {
        throw new Error(`envd: process stream in ${sandboxId} failed: ${JSON.stringify(message.error)}`)
      }
      break
    }
    const event = message.event ?? {}
    if (event.data?.stdout !== undefined) stdout.push(Buffer.from(event.data.stdout, 'base64').toString('utf8'))
    if (event.data?.stderr !== undefined) stderr.push(Buffer.from(event.data.stderr, 'base64').toString('utf8'))
    if (event.end !== undefined) exitCode = Number(event.end.exitCode ?? event.end.exit_code ?? 0)
  }
  if (exitCode === undefined) {
    throw new Error(`envd: process stream in ${sandboxId} ended without an exit code`)
  }
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
}

/** Where a sandbox's backend writes what it would otherwise print to a terminal. */
const BACKEND_LOG_PATH = '/var/log/dsh.log'

/**
 * Start one tenant's backend inside their sandbox.
 *
 * Detached with `setsid`, so it survives the shell envd started it from: envd
 * owns that shell's process group and reaps it when the command returns, and the
 * backend has to outlive the call by the entire life of the sandbox. Its output
 * goes to a file for the same reason — nothing is left holding the pipe.
 *
 * @param {string} sandboxId - the sandbox to start the backend in.
 * @param {Record<string, string>} env - the backend's environment, carrying this sandbox's identity.
 * @returns {Promise<void>} resolves once the backend has been started.
 * @throws {Error} when the start command itself fails.
 */
export async function startBackend(sandboxId, env) {
  const command = `setsid nohup /app/sandbox/entrypoint.sh >${BACKEND_LOG_PATH} 2>&1 </dev/null &`
  const { exitCode, stderr } = await runCommand(sandboxId, command, env)
  if (exitCode !== 0) {
    throw new Error(`envd: starting the backend in ${sandboxId} exited ${exitCode}: ${stderr.trim()}`)
  }
}

/** envd's Connect services, as they are addressed on the wire. */
const FILESYSTEM = '/filesystem.Filesystem'
const PROCESS = '/process.Process'

/** The headers every Connect unary call to envd carries. */
const CONNECT_HEADERS = {
  'Content-Type': 'application/connect+json',
  'Connect-Protocol-Version': '1',
  'Connect-Content-Encoding': 'identity',
  Authorization: `Basic ${Buffer.from(`${ENVD_USER}:`).toString('base64')}`,
}

/**
 * Call one of envd's unary methods and return its reply.
 *
 * Plain JSON, and NOT the enveloped `application/connect+json` that
 * `runCommand` uses. Connect frames the two kinds of call differently: a
 * streaming method carries enveloped messages under `connect+json`, while a
 * unary one is an ordinary JSON request and an ordinary JSON reply with no
 * framing at all. Sending a stream's envelope to a unary method is answered
 * `415 Unsupported Media Type` with an empty body, which reads like a
 * transport fault and is really a codec mismatch.
 *
 * A failure comes back as a non-2xx with a JSON `{code, message}` body, so
 * there is no trailer to inspect and no end-of-stream flag to wait for.
 *
 * @param {string} sandboxId - the sandbox to ask.
 * @param {string} method - the fully qualified method path.
 * @param {object} payload - the request message.
 * @returns {Promise<object>} the response message.
 * @throws {Error} when envd refuses the call.
 */
async function unary(sandboxId, method, payload) {
  const { status, body } = await envdRequest(sandboxId, method, Buffer.from(JSON.stringify(payload), 'utf8'), {
    'Content-Type': 'application/json',
    'Connect-Protocol-Version': '1',
    Authorization: CONNECT_HEADERS.Authorization,
  })
  const text = body.toString('utf8')
  if (status >= 400) {
    // Connect reports a failure as a JSON `{code, message}`. The code is
    // carried onto the error so a caller can tell "there is no such file" from
    // "the sandbox is not answering" without matching on prose.
    const failure = new Error(`envd: ${method} in ${sandboxId} failed (${String(status)}): ${text.trim()}`)
    try {
      failure.code = JSON.parse(text).code
    } catch {
      // No JSON body, so no code to carry. The status still says what happened.
    }
    throw failure
  }
  try {
    return JSON.parse(text === '' ? '{}' : text)
  } catch {
    throw new Error(`envd: ${method} in ${sandboxId} answered something that is not JSON`)
  }
}

/**
 * What one directory holds.
 *
 * Depth 1: the panel's tree loads a level at a time as it is opened, so asking
 * for more would read a tenant's whole workspace to draw one row of it.
 *
 * @param {string} sandboxId - the sandbox to read in.
 * @param {string} path - an absolute path, already through the fence.
 * @returns {Promise<Array<object>>} the entries, in envd's own order.
 */
export async function listDir(sandboxId, path) {
  const message = await unary(sandboxId, `${FILESYSTEM}/ListDir`, { path, depth: 1, username: ENVD_USER })
  return message.entries ?? []
}

/**
 * What one path is.
 *
 * @param {string} sandboxId - the sandbox to read in.
 * @param {string} path - an absolute path, already through the fence.
 * @returns {Promise<object>} the entry.
 */
export async function stat(sandboxId, path) {
  const message = await unary(sandboxId, `${FILESYSTEM}/Stat`, { path, username: ENVD_USER })
  return message.entry ?? message
}

/**
 * One file's bytes.
 *
 * envd's own HTTP reader rather than a Connect method, because there is no
 * Connect method for it — and because a file arrives as bytes rather than as
 * base64 inside an envelope.
 *
 * @param {string} sandboxId - the sandbox to read in.
 * @param {string} path - an absolute path, already through the fence.
 * @returns {Promise<{status: number, body: Buffer}>} the status envd answered with, and the bytes.
 */
export async function readFile(sandboxId, path) {
  const query = new URLSearchParams({ path, username: ENVD_USER })
  return await envdRequest(sandboxId, `/files?${query.toString()}`, undefined, {
    Authorization: CONNECT_HEADERS.Authorization,
  }, 'GET')
}

/**
 * Move or rename one path.
 *
 * envd calls both the same thing, which is what the filesystem calls them
 * both: a rename is a move within one directory.
 *
 * @param {string} sandboxId - the sandbox to act in.
 * @param {string} source - an absolute path, already through the scope check.
 * @param {string} destination - an absolute path, likewise.
 * @returns {Promise<object>} the entry as it now is.
 */
export async function move(sandboxId, source, destination) {
  const message = await unary(sandboxId, `${FILESYSTEM}/Move`, { source, destination, username: ENVD_USER })
  return message.entry ?? message
}

/**
 * Remove one path.
 *
 * envd removes a directory with its contents. That is the behaviour a file
 * manager needs and the behaviour a person expects from a delete, so the
 * warning belongs in the interface asking for it, not in a second call here.
 *
 * @param {string} sandboxId - the sandbox to act in.
 * @param {string} path - an absolute path, already through the scope check.
 * @returns {Promise<void>} resolves once it is gone.
 */
export async function remove(sandboxId, path) {
  await unary(sandboxId, `${FILESYSTEM}/Remove`, { path, username: ENVD_USER })
}

/**
 * Create one directory.
 *
 * @param {string} sandboxId - the sandbox to act in.
 * @param {string} path - an absolute path, already through the scope check.
 * @returns {Promise<object>} the entry.
 */
export async function makeDir(sandboxId, path) {
  const message = await unary(sandboxId, `${FILESYSTEM}/MakeDir`, { path, username: ENVD_USER })
  return message.entry ?? message
}

/**
 * The most recently written file of one kind under a directory.
 *
 * This is what the canvas follows. The alternative signal is the one the
 * conversation already computes — `ui-deliverables` accumulates the mutation
 * tools' `locations` into each turn — and it is more precise about intent. It
 * is also blind in exactly the place a canvas cannot afford: a page produced
 * by a shell redirect (`python gen.py > report.html`) carries no edit card, so
 * it never appears there. Modification time sees it, and for "show me the page
 * being worked on" that is the better question anyway.
 *
 * `find` with a fixed argv and no shell, so a name with a space, a quote or a
 * semicolon in it is a name. The root is bounded by the caller before it
 * arrives.
 *
 * @param {string} sandboxId - the sandbox to look in.
 * @param {string} root - an absolute directory, already through the scope check.
 * @param {string} pattern - a filename glob, e.g. `*.html`.
 * @returns {Promise<{path: string, modified: number}|undefined>} the newest match, or undefined when there is none.
 */
export async function newestFile(sandboxId, root, pattern) {
  const payload = {
    process: {
      cmd: '/usr/bin/find',
      args: [root, '-type', 'f', '-name', pattern, '-printf', '%T@\\t%p\\n'],
      envs: {},
    },
    stdin: false,
  }
  const { status, body } = await envdRequest(sandboxId, '/process.Process/Start', encodeEnvelope(payload), CONNECT_HEADERS)
  if (status >= 400) {
    throw new Error(`envd: scanning ${root} in ${sandboxId} failed (${String(status)})`)
  }
  const out = []
  for (const { flags, message } of decodeEnvelopes(body)) {
    if ((flags & END_STREAM_FLAG) !== 0) break
    const event = message.event ?? {}
    if (event.data?.stdout !== undefined) out.push(Buffer.from(event.data.stdout, 'base64').toString('utf8'))
  }
  let best
  for (const line of out.join('').split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const modified = Number.parseFloat(line.slice(0, tab))
    const path = line.slice(tab + 1)
    if (!Number.isFinite(modified) || path === '') continue
    if (best === undefined || modified > best.modified) best = { path, modified }
  }
  return best
}

/**
 * Write one file.
 *
 * envd's HTTP uploader rather than a Connect method, because the filesystem
 * service has no write: it can move, remove and make a directory, and that is
 * all. The uploader takes a multipart body, which is built by hand here for
 * the same reason the rest of this file is — the whole client is three
 * functions and a boundary string, against a dependency that would arrive with
 * its own.
 *
 * @param {string} sandboxId - the sandbox to write in.
 * @param {string} path - an absolute path, already through the scope check.
 * @param {Buffer} content - the bytes to write.
 * @returns {Promise<void>} resolves once envd has taken it.
 * @throws {Error} when envd refuses.
 */
export async function writeFile(sandboxId, path, content) {
  const boundary = `----dsh${randomUUID().replaceAll('-', '')}`
  const name = path.slice(path.lastIndexOf('/') + 1)
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${name}"\r\n`
      + 'Content-Type: application/octet-stream\r\n\r\n',
      'utf8',
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ])
  const query = new URLSearchParams({ path, username: ENVD_USER })
  const { status, body: answer } = await envdRequest(sandboxId, `/files?${query.toString()}`, body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    Authorization: CONNECT_HEADERS.Authorization,
  })
  if (status >= 400) {
    throw new Error(`envd: writing ${path} in ${sandboxId} failed (${String(status)}): ${answer.toString('utf8').trim()}`)
  }
}

/**
 * Read one Connect stream, frame by frame, as it arrives.
 *
 * The piece that makes a stream a stream. Everything else in this file waits
 * for `end` and decodes the whole body at once, which is right for a call that
 * answers and fatal for one that keeps answering. Envelopes arrive split
 * across TCP reads and several to a read, so the buffer is carried between
 * reads and drained of whole frames only.
 *
 * @param {import('node:http').IncomingMessage} response - the streaming response.
 * @param {(flags: number, message: object) => void} onFrame - called with each decoded envelope.
 */
function readEnvelopes(response, onFrame) {
  let pending = Buffer.alloc(0)
  response.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk])
    while (pending.length >= ENVELOPE_HEADER_BYTES) {
      const flags = pending.readUInt8(0)
      const length = pending.readUInt32BE(1)
      const total = ENVELOPE_HEADER_BYTES + length
      if (pending.length < total) break
      const payload = pending.subarray(ENVELOPE_HEADER_BYTES, total)
      pending = pending.subarray(total)
      let message
      try {
        message = payload.length === 0 ? {} : JSON.parse(payload.toString('utf8'))
      } catch {
        continue
      }
      onFrame(flags, message)
    }
  })
}

/**
 * Open a shell with a terminal, and stream what it prints.
 *
 * The one call in this file that does not wait for the response to finish.
 * Every other one reads `response.on('end')` and decodes the whole body, which
 * is right for a command that returns and fatal for a session that does not:
 * the reply never ends, so the read blocks until the socket times out.
 *
 * Only the OUTPUT is a stream. Keystrokes and resizes go back as ordinary
 * unary calls — see `sendPtyInput` and `resizePty` — so there is no
 * bidirectional plumbing here, and nothing to keep alive in two directions.
 *
 * @param {string} sandboxId - the sandbox to open the shell in.
 * @param {{cols: number, rows: number, cwd: string, envs: Record<string, string>}} options - the terminal's shape and where it starts.
 * @param {{onStart: (pid: number) => void, onData: (bytes: Buffer) => void, onEnd: (exitCode: number|undefined) => void, onError: (error: Error) => void}} sink - where the session's events go.
 * @returns {Promise<{close: () => void}>} a handle that ends the read.
 */
export async function startPty(sandboxId, options, sink) {
  const payload = {
    process: {
      cmd: '/bin/bash',
      args: ['-l'],
      envs: options.envs,
      cwd: options.cwd,
    },
    // The field that makes this a terminal rather than a pipe: with it envd
    // allocates a pty and the shell believes it is talking to one, which is
    // what makes a prompt, colours and line editing appear at all.
    pty: { size: { cols: options.cols, rows: options.rows } },
  }
  const endpoint = endpointOf(sandboxId)
  return await new Promise((resolve, reject) => {
    const body = encodeEnvelope(payload)
    const request = http.request({
      host: endpoint.host,
      port: endpoint.port,
      method: 'POST',
      path: '/process.Process/Start',
      headers: {
        ...CONNECT_HEADERS,
        ...(endpoint.hostHeader === undefined ? {} : { Host: endpoint.hostHeader }),
        'Content-Length': String(body.length),
      },
    }, (response) => {
      if ((response.statusCode ?? 502) >= 400) {
        response.resume()
        reject(new Error(`envd: opening a terminal in ${sandboxId} failed (${String(response.statusCode)})`))
        return
      }
      readEnvelopes(response, (flags, message) => {
        {
          if ((flags & END_STREAM_FLAG) !== 0) {
            if (message.error !== undefined) sink.onError(new Error(JSON.stringify(message.error)))
            return
          }
          const event = message.event ?? {}
          if (event.start !== undefined) sink.onStart(Number(event.start.pid))
          // A terminal's output arrives on `pty`; `stdout`/`stderr` are what a
          // pipe-backed process uses, and are forwarded too so a shell started
          // without a pty is not silently blank.
          const data = event.data?.pty ?? event.data?.stdout ?? event.data?.stderr
          if (data !== undefined) sink.onData(Buffer.from(data, 'base64'))
          if (event.end !== undefined) sink.onEnd(Number(event.end.exitCode ?? event.end.exit_code ?? 0))
        }
      })
      response.on('end', () => { sink.onEnd(undefined) })
      response.on('error', (error) => { sink.onError(error) })
      resolve({ close: () => { response.destroy(); request.destroy() } })
    })
    request.on('error', reject)
    request.end(body)
  })
}

/**
 * Type into a terminal.
 *
 * @param {string} sandboxId - the sandbox the shell is in.
 * @param {number} pid - the shell's process id, as its start event reported it.
 * @param {Buffer} bytes - what was typed.
 * @returns {Promise<void>} resolves once envd has taken it.
 */
export async function sendPtyInput(sandboxId, pid, bytes) {
  await unary(sandboxId, `${PROCESS}/SendInput`, {
    process: { pid },
    input: { pty: bytes.toString('base64') },
  })
}

/**
 * Tell a terminal how big it is now.
 *
 * Without this a resized window leaves the shell drawing to the old size, and
 * anything full-screen — an editor, a pager — wraps at the wrong column.
 *
 * @param {string} sandboxId - the sandbox the shell is in.
 * @param {number} pid - the shell's process id.
 * @param {number} cols - columns.
 * @param {number} rows - rows.
 * @returns {Promise<void>} resolves once envd has taken it.
 */
export async function resizePty(sandboxId, pid, cols, rows) {
  await unary(sandboxId, `${PROCESS}/Update`, { process: { pid }, pty: { size: { cols, rows } } })
}

/**
 * What one sandbox is using right now.
 *
 * envd's own `/metrics`, which it samples with gopsutil and answers as JSON.
 * There was an implementation of this inside the sandbox — a plugin reading
 * `/proc` and answering down the tunnel — and it is gone: the same numbers
 * were already here, on the plane the rest of the panel uses, and two ways of
 * measuring one machine is one way too many.
 *
 * It is a GET, not a subscription. Nothing about CPU usage is an event;
 * somebody has to sample. `stats.js` decides who and how often, so that a
 * tenant with three tabs open costs one sample rather than three.
 *
 * @param {string} sandboxId - the sandbox to measure.
 * @returns {Promise<object>} envd's own reading.
 * @throws {Error} when the sandbox does not answer.
 */
export async function metrics(sandboxId) {
  const { status, body } = await envdRequest(sandboxId, '/metrics', undefined, {
    Authorization: CONNECT_HEADERS.Authorization,
  }, 'GET')
  if (status >= 400) {
    throw new Error(`envd: reading metrics in ${sandboxId} failed (${String(status)})`)
  }
  return JSON.parse(body.toString('utf8'))
}

/**
 * Watch a directory, and hear about changes as they happen.
 *
 * A real push, and the reason two pollers could be deleted: the canvas asked
 * every two seconds which page was newest, and the file tree re-read a
 * directory whenever it was drawn. Both were asking a question the sandbox can
 * answer by itself the moment it becomes true.
 *
 * Recursive, and one watcher per sandbox: the workspace is the thing being
 * watched, and splitting it per open directory would mean a stream per
 * expanded row.
 *
 * @param {string} sandboxId - the sandbox to watch in.
 * @param {string} path - an absolute directory, already through the scope check.
 * @param {{onEvent: (event: {name: string, type: string}) => void, onEnd: () => void, onError: (error: Error) => void}} sink - where the changes go.
 * @returns {Promise<{close: () => void}>} a handle that ends the watch.
 */
export async function watchDir(sandboxId, path, sink) {
  const endpoint = endpointOf(sandboxId)
  const body = encodeEnvelope({ path, recursive: true, username: ENVD_USER })
  return await new Promise((resolve, reject) => {
    const request = http.request({
      host: endpoint.host,
      port: endpoint.port,
      method: 'POST',
      path: `${FILESYSTEM}/WatchDir`,
      headers: {
        ...CONNECT_HEADERS,
        ...(endpoint.hostHeader === undefined ? {} : { Host: endpoint.hostHeader }),
        'Content-Length': String(body.length),
      },
    }, (response) => {
      if ((response.statusCode ?? 502) >= 400) {
        response.resume()
        reject(new Error(`envd: watching ${path} in ${sandboxId} failed (${String(response.statusCode)})`))
        return
      }
      readEnvelopes(response, (flags, message) => {
        if ((flags & END_STREAM_FLAG) !== 0) {
          if (message.error !== undefined) sink.onError(new Error(JSON.stringify(message.error)))
          return
        }
        // The first frame is `{start:{}}`, which says the watch is live rather
        // than that anything changed.
        const event = message.filesystem
        if (event === undefined) return
        sink.onEvent({ name: String(event.name ?? ''), type: String(event.type ?? '') })
      })
      response.on('end', () => { sink.onEnd() })
      response.on('error', (error) => { sink.onError(error) })
      resolve({ close: () => { response.destroy(); request.destroy() } })
    })
    request.on('error', reject)
    request.end(body)
  })
}
