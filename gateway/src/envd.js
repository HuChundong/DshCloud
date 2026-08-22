/**
 * Reaching into one tenant's sandbox: files, processes, terminals.
 *
 * Everything here goes through envd, the daemon every sandbox platform in this
 * family embeds, and it is spoken by the official E2B client rather than by
 * this file. That is the whole point of the module now: it used to carry a
 * hand-written implementation of envd's Connect protocol — worked out by
 * experiment, including which calls frame themselves in envelopes and which
 * are plain JSON — and every one of those details was ours to keep right
 * against a daemon somebody else versions.
 *
 * What is left is the part nobody else can know: WHERE this deployment's
 * sandboxes are, and what its callers expect back.
 *
 * ## Where a sandbox is
 *
 * A sandbox has no address this host can route to, so the connection goes to
 * the proxy, which routes by PATH: `/sandbox/<id>/<port>/…`, prefix stripped
 * before forwarding. That is one of two routings the proxy offers, and it is
 * deliberately not the other one.
 *
 * The other is a virtual host — `<port>-<id>.<domain>` in a `Host` header —
 * which is what this file used to do, and which is exactly what a standard
 * client cannot do: `Host` is a forbidden header in fetch, silently dropped,
 * so the proxy answers for itself instead of for the sandbox. Hand-written
 * code could set it because it used Node's own http client. Choosing the path
 * routing is what lets the client be somebody else's.
 *
 * Under `docker` there is no proxy and no routing to do: the container name is
 * an address on the network the gateway shares with it.
 *
 * ## What callers expect
 *
 * The signatures here are unchanged, and so is the way failure is reported:
 * `error.code === 'not_found'` is how a caller tells "there is no such file"
 * from "the sandbox is not answering", and `readFile` answers with a status
 * rather than throwing, because the panel turns it into an HTTP response. The
 * client's own errors are translated back into that vocabulary rather than
 * leaking outward — a change of client is not a change of contract.
 *
 * @module envd
 */

import process from 'node:process'

import { Sandbox } from 'e2b'

/** The port envd listens on inside every sandbox. */
const ENVD_PORT = 49983

/**
 * The proxy connections into a sandbox are dialled at.
 *
 * Required rather than defaulted under `cube`: a gateway pointed at the wrong
 * proxy fails on every sandbox it starts, and the failure looks like a sandbox
 * that never dialled in.
 */
const PROXY_NODE_IP = process.env.CUBE_PROXY_NODE_IP
const PROXY_PORT = Number(process.env.CUBE_PROXY_PORT_HTTP ?? 30080)

/**
 * Which runtime provides the sandboxes, read the same way `runtimes.js` reads
 * it. Read here rather than imported to keep the two files from depending on
 * each other — `runtimes.js` already imports this one.
 */
const RUNTIME = process.env.SANDBOX_RUNTIME === 'cube' ? 'cube' : 'docker'

/** The sandbox user commands run as. The backend owns the whole machine. */
const ENVD_USER = 'root'

/**
 * The base URL one sandbox's envd is reached at.
 *
 * The argument is the RUNTIME's own handle — what `runtime.create` returned —
 * and never the gateway's `sandboxId`. The two are not the same thing and only
 * one of them is an address:
 *
 *   docker   handle = `hamsterhq-sandbox-<first 12 of SANDBOX_ID>`, the container name
 *   cube     handle = the platform's own sandbox id, which the proxy routes by
 *
 * @param {string} handle - the runtime's handle for the sandbox to reach.
 * @returns {string} the base URL, with no trailing slash.
 */
function envdUrl(handle) {
  if (RUNTIME === 'docker') return `http://${handle}:${String(ENVD_PORT)}`
  if (PROXY_NODE_IP === undefined) {
    throw new Error('envd: CUBE_PROXY_NODE_IP is required to reach a sandbox')
  }
  return `http://${PROXY_NODE_IP}:${String(PROXY_PORT)}/sandbox/${handle}/${String(ENVD_PORT)}`
}

/**
 * A client for one sandbox.
 *
 * Not cached. A client holds no connection of its own — it is a base URL and a
 * few generated stubs — and caching it would mean deciding when a sandbox has
 * gone, which is a question this module is in no position to answer and the
 * manager already answers elsewhere.
 *
 * `debug` keeps the client from asking an API where the sandbox is: this
 * deployment already knows, and under `docker` there is no such API at all.
 *
 * @param {string} handle - the runtime's handle.
 * @returns {Promise<import('e2b').Sandbox>} the client.
 */
async function client(handle) {
  return await Sandbox.connect(handle, {
    apiKey: process.env.CUBE_API_KEY ?? 'e2b_000000',
    sandboxUrl: envdUrl(handle),
    debug: true,
  })
}

/**
 * Restate one of the client's failures in the vocabulary callers already
 * speak.
 *
 * `not_found` is the only code anything matches on, and it is the difference
 * between a 404 and a 502 on the panel's routes — between "you asked for a
 * file that is not there" and "this deployment could not reach your sandbox".
 * The client raises its own error types; what they have in common is a message
 * and, on the ones that matter, a name that says which kind it is.
 *
 * @param {unknown} error - whatever the client threw.
 * @param {string} what - the operation, for the message.
 * @param {string} handle - the sandbox, for the message.
 * @returns {Error} the error to throw onward.
 */
function restate(error, what, handle) {
  const name = String(error?.constructor?.name ?? '')
  const message = String(error?.message ?? error)
  const failure = new Error(`envd: ${what} in ${handle} failed: ${message}`)
  if (name === 'NotFoundError' || /not found|no such file|does not exist/i.test(message)) {
    failure.code = 'not_found'
  }
  return failure
}

/**
 * Run one call against a sandbox, restating whatever it throws.
 * @param {string} handle - the sandbox.
 * @param {string} what - the operation, for the message.
 * @param {(sandbox: import('e2b').Sandbox) => Promise<any>} body - the call.
 * @returns {Promise<any>} whatever it answered.
 */
async function call(handle, what, body) {
  try {
    return await body(await client(handle))
  } catch (error) {
    throw restate(error, what, handle)
  }
}

/** Where a sandbox's backend writes what it would otherwise print to a terminal. */
const BACKEND_LOG_PATH = '/var/log/dsh.log'

/**
 * Run one command to completion.
 *
 * Private: the two callers below are the only ones, and a general "run
 * anything in a tenant's sandbox" is not a door this module wants open.
 *
 * @param {string} handle - the sandbox to run in.
 * @param {string} command - the shell line.
 * @param {Record<string, string>} [envs] - extra environment.
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} how it went.
 */
async function runCommand(handle, command, envs) {
  return await call(handle, `running a command`, async (sandbox) => {
    const result = await sandbox.commands.run(command, { user: ENVD_USER, envs, timeoutMs: 0 })
    return { exitCode: result.exitCode ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  })
}

/**
 * Start the tenant's own backend.
 *
 * Detached on purpose, and the detaching is the whole trick: `setsid nohup …&`
 * leaves a process that outlives the call that started it, so this returns as
 * soon as the shell forks rather than holding a connection open for the life
 * of the sandbox.
 *
 * @param {string} handle - the sandbox to start it in.
 * @param {Record<string, string>} env - the environment it runs with.
 * @returns {Promise<void>} resolves once the shell has forked it.
 */
export async function startBackend(handle, env) {
  const command = `setsid nohup /app/sandbox/entrypoint.sh >${BACKEND_LOG_PATH} 2>&1 </dev/null &`
  const { exitCode, stderr } = await runCommand(handle, command, env)
  if (exitCode !== 0) {
    throw new Error(`envd: starting the backend in ${handle} exited ${String(exitCode)}: ${stderr.trim()}`)
  }
}

/**
 * The most recently written file of one kind under a directory.
 *
 * `find` rather than a walk of our own: it is one call instead of one per
 * directory, and the sandbox does the work.
 *
 * `-H` follows a symlink named on the command line and nothing inside the
 * tree. The workspace is a real directory now, so this is no longer
 * load-bearing for it — but a root that was a link once cost the canvas every
 * page in production while the simulation looked perfect, and a tenant may
 * still point this at a link of their own. `-L` would follow links inside the
 * tree too, and could walk into a cycle.
 *
 * @param {string} handle - the sandbox to scan.
 * @param {string} root - the directory to scan under.
 * @param {string} pattern - a `find -name` pattern.
 * @returns {Promise<{path: string, modified: number}|undefined>} the newest, or nothing.
 */
export async function newestFile(handle, root, pattern) {
  const quoted = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`
  const { exitCode, stdout } = await runCommand(
    handle,
    `/usr/bin/find -H ${quoted(root)} -type f -name ${quoted(pattern)} -printf '%T@\\t%p\\n'`,
  )
  // `find` answers non-zero for a directory it could not read while still
  // printing everything it could, so its status is not a reason to discard the
  // lines it did produce.
  if (exitCode !== 0 && stdout.trim() === '') return undefined

  let newest
  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const modified = Number.parseFloat(line.slice(0, tab))
    const path = line.slice(tab + 1)
    if (!Number.isFinite(modified) || path === '') continue
    // Seconds, as `find` prints them and as the caller has always compared
    // them. Multiplying to milliseconds here would be a unit change nothing
    // announces: the canvas asks whether the newest page is newer than the one
    // it is showing, and both sides have to be counting the same thing.
    if (newest === undefined || modified > newest.modified) newest = { path, modified }
  }
  return newest
}

/**
 * Open a terminal, and keep it open.
 *
 * The one streaming surface here. Output arrives on the sink as it is
 * produced; the returned handle closes the stream, which kills the shell with
 * it — a terminal nobody is watching is a shell nobody will ever type into.
 *
 * @param {string} handle - the sandbox to open it in.
 * @param {{cols: number, rows: number, cwd: string, envs: Record<string, string>}} options - the shell's shape.
 * @param {{onStart: (pid: number) => void, onData: (bytes: Buffer) => void, onEnd: (exitCode: number|undefined) => void, onError: (error: Error) => void}} sink - where the terminal's life is reported.
 * @returns {Promise<{close: () => void}>} the handle that ends it.
 */
export async function startPty(handle, options, sink) {
  const sandbox = await client(handle)
  const terminal = await sandbox.pty.create({
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    envs: options.envs,
    user: ENVD_USER,
    // No deadline. A terminal ends when the person closes it or the shell
    // exits, and a timeout here would close a window somebody left open.
    timeoutMs: 0,
    onData: (bytes) => { sink.onData(Buffer.from(bytes)) },
  })

  sink.onStart(Number(terminal.pid))
  // `wait` settles when the shell exits. Its rejection is how a terminal that
  // died reports itself, and it is not an error in this call — which has
  // already resolved.
  terminal.wait().then(
    (result) => { sink.onEnd(Number(result?.exitCode ?? 0)) },
    (error) => { sink.onError(error instanceof Error ? error : new Error(String(error))) },
  )

  return { close: () => { void sandbox.pty.kill(terminal.pid).catch(() => {}) } }
}

/**
 * Type into a terminal.
 *
 * @param {string} handle - the sandbox it is in.
 * @param {number} pid - the terminal's process.
 * @param {Buffer} bytes - what was typed.
 * @returns {Promise<void>} resolves once it is delivered.
 */
export async function sendPtyInput(handle, pid, bytes) {
  await call(handle, `typing into ${String(pid)}`, async (sandbox) => {
    await sandbox.pty.sendInput(pid, new Uint8Array(bytes))
  })
}

/**
 * Tell a terminal its window changed.
 *
 * Without this a shell keeps drawing to the size it was born with, and
 * anything full-width wraps in the wrong place.
 *
 * @param {string} handle - the sandbox it is in.
 * @param {number} pid - the terminal's process.
 * @param {number} cols - the new width.
 * @param {number} rows - the new height.
 * @returns {Promise<void>} resolves once it is told.
 */
export async function resizePty(handle, pid, cols, rows) {
  await call(handle, `resizing ${String(pid)}`, async (sandbox) => {
    await sandbox.pty.resize(pid, { cols, rows })
  })
}

/**
 * What is directly inside one directory.
 *
 * One level. The tree asks for a directory when it opens it, so anything
 * deeper would read a tenant's whole workspace to draw one row of it.
 *
 * @param {string} handle - the sandbox to read in.
 * @param {string} path - an absolute path, already through the fence.
 * @returns {Promise<Array<object>>} the entries.
 */
export async function listDir(handle, path) {
  return await call(handle, `listing ${path}`, async (sandbox) => await sandbox.files.list(path, { user: ENVD_USER }))
}

/**
 * What one path is.
 *
 * @param {string} handle - the sandbox to read in.
 * @param {string} path - an absolute path, already through the fence.
 * @returns {Promise<object>} the entry.
 */
export async function stat(handle, path) {
  return await call(handle, `stat ${path}`, async (sandbox) => await sandbox.files.getInfo(path, { user: ENVD_USER }))
}

/**
 * One file's bytes.
 *
 * Answers with a status rather than throwing, because its caller is turning
 * the answer into an HTTP response and the difference between "no such file"
 * and "the sandbox is unreachable" is the difference between the two statuses
 * it sends. Keeping that here means the panel's route did not have to learn a
 * new client's error types.
 *
 * @param {string} handle - the sandbox to read in.
 * @param {string} path - an absolute path, already through the fence.
 * @returns {Promise<{status: number, body: Buffer}>} the status, and the bytes.
 */
export async function readFile(handle, path) {
  try {
    const sandbox = await client(handle)
    const bytes = await sandbox.files.read(path, { user: ENVD_USER, format: 'bytes' })
    return { status: 200, body: Buffer.from(bytes) }
  } catch (error) {
    const failure = restate(error, `reading ${path}`, handle)
    return { status: failure.code === 'not_found' ? 404 : 502, body: Buffer.from(failure.message, 'utf8') }
  }
}

/**
 * Move or rename one path.
 *
 * The filesystem calls both the same thing: a rename is a move within one
 * directory.
 *
 * @param {string} handle - the sandbox to act in.
 * @param {string} source - an absolute path, already through the scope check.
 * @param {string} destination - an absolute path, likewise.
 * @returns {Promise<object>} the entry as it now is.
 */
export async function move(handle, source, destination) {
  return await call(handle, `moving ${source}`, async (sandbox) => await sandbox.files.rename(source, destination, { user: ENVD_USER }))
}

/**
 * Remove one path.
 *
 * A directory goes with its contents. That is what a file manager needs and
 * what a person expects from a delete, so the warning belongs in the interface
 * asking for it, not in a second call here.
 *
 * @param {string} handle - the sandbox to act in.
 * @param {string} path - an absolute path, already through the scope check.
 * @returns {Promise<void>} resolves once it is gone.
 */
export async function remove(handle, path) {
  await call(handle, `removing ${path}`, async (sandbox) => { await sandbox.files.remove(path, { user: ENVD_USER }) })
}

/**
 * Create one directory.
 *
 * @param {string} handle - the sandbox to act in.
 * @param {string} path - an absolute path, already through the scope check.
 * @returns {Promise<object>} the entry.
 */
export async function makeDir(handle, path) {
  return await call(handle, `making ${path}`, async (sandbox) => {
    await sandbox.files.makeDir(path, { user: ENVD_USER })
    return await sandbox.files.getInfo(path, { user: ENVD_USER })
  })
}

/**
 * Write one file, creating the directories above it.
 *
 * @param {string} handle - the sandbox to act in.
 * @param {string} path - an absolute path, already through the scope check.
 * @param {Buffer|string} content - the bytes to write.
 * @returns {Promise<object>} the entry as written.
 */
export async function writeFile(handle, path, content) {
  return await call(handle, `writing ${path}`, async (sandbox) => await sandbox.files.write(path, content, { user: ENVD_USER }))
}
