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
 * Only `startProcess` is implemented. The gateway runs one command per sandbox
 * and never reads a file or executes anything on a tenant's behalf.
 */

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
 * `node:http` rather than `fetch`, because the whole mechanism is a `Host`
 * header that names somewhere other than the address dialled, and `fetch`
 * forbids setting `Host`.
 *
 * @param {string} sandboxId - the sandbox to address.
 * @param {string} path - the envd path to call.
 * @param {Buffer} body - the encoded request body.
 * @param {Record<string, string>} headers - request headers, less `Host`.
 * @returns {Promise<{status: number, body: Buffer}>} the response status and complete body.
 */
async function envdRequest(sandboxId, path, body, headers) {
  if (PROXY_NODE_IP === undefined) {
    throw new Error('envd: CUBE_PROXY_NODE_IP is required to reach a sandbox')
  }
  return await new Promise((resolve, reject) => {
    const request = http.request({
      host: PROXY_NODE_IP,
      port: PROXY_PORT,
      method: 'POST',
      path,
      headers: {
        ...headers,
        Host: `${ENVD_PORT}-${sandboxId}.${SANDBOX_DOMAIN}`,
        'Content-Length': String(body.length),
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
export async function runCommand(sandboxId, command, envs) {
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
