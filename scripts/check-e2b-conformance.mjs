/**
 * How much of the E2B protocol this deployment's platform actually speaks.
 *
 * Several vendors describe themselves as E2B-compatible and mean slightly
 * different things by it. That is not a complaint — it is the normal state of
 * a protocol with more than one implementation — but it makes "compatible" a
 * word this repository cannot build on. So the claim is measured instead: the
 * calls this deployment depends on are made, one at a time, against whatever
 * platform is configured, and each is recorded as passing, differing in shape,
 * or absent.
 *
 * It is written to run BEFORE any of our own code is migrated onto the SDK, so
 * that the incompatibilities are a list somebody decides about rather than a
 * series of surprises during a rewrite. Afterwards it stays as the check a new
 * platform is held to.
 *
 * It creates a real sandbox and destroys it. It refuses to finish quietly if
 * the destruction failed, because a probe that leaks a machine every run is
 * worse than no probe.
 *
 * Usage:
 *   E2B_API_URL=… E2B_API_KEY=… E2B_TEMPLATE=… node scripts/check-e2b-conformance.mjs
 */

import process from 'node:process'

import { Agent, fetch as undiciFetch } from 'undici'

const API_URL = process.env.E2B_API_URL ?? process.env.CUBE_API_URL ?? ''
const API_KEY = process.env.E2B_API_KEY ?? process.env.CUBE_API_KEY ?? ''
const TEMPLATE = process.env.E2B_TEMPLATE ?? process.env.CUBE_TEMPLATE_ID ?? ''

/** The proxy every sandbox is reached through, as `host:port`. Empty for a deployment whose sandboxes resolve on their own. */
const PROXY = process.env.E2B_PROXY ?? ''

/** The domain the virtual hosts are built under. */
const DOMAIN = process.env.E2B_SANDBOX_DOMAIN ?? process.env.CUBE_SANDBOX_DOMAIN ?? 'cube.app'

if (API_URL === '' || API_KEY === '' || TEMPLATE === '') {
  console.error('conformance: needs E2B_API_URL, E2B_API_KEY and E2B_TEMPLATE (or their CUBE_ equivalents)')
  process.exit(2)
}

/** @type {Array<{name: string, verdict: string, note: string}>} */
const results = []

/** Record one outcome. */
const record = (name, verdict, note = '') => {
  results.push({ name, verdict, note })
  const mark = { pass: '  ✓', shape: '  ~', missing: '  ✗', skip: '  ·' }[verdict] ?? '  ?'
  console.log(`${mark} ${name.padEnd(30)} ${note}`)
}

/**
 * Run one probe, turning a throw into a verdict rather than ending the run.
 *
 * Everything after a failure still runs: the point is the whole list, and a
 * platform that cannot do one thing usually can do the next.
 */
const probe = async (name, fn) => {
  try {
    const note = await fn()
    record(name, 'pass', note ?? '')
  } catch (error) {
    const message = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)
    record(name, /not found|404|unsupported|not implemented|501/i.test(message) ? 'missing' : 'shape', message)
  }
}

/** The raw API, for the shapes the SDK hides. */
const api = async (method, path, body) => {
  // The body is spread in rather than set to `undefined`, because a `body`
  // key present on a GET is a lint error and, in some runtimes, a request the
  // server never sees.
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'X-API-Key': API_KEY, ...body === undefined ? {} : { 'Content-Type': 'application/json' } },
    ...body === undefined ? {} : { body: JSON.stringify(body) },
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: response.status, body: parsed }
}

console.log(`conformance: ${API_URL}, template ${TEMPLATE}\n`)

// ---- what the SDK itself can do -------------------------------------------

const { Sandbox } = await import('e2b')

/**
 * Reach a sandbox the way this deployment reaches one.
 *
 * A sandbox has no address of its own here: the connection goes to the proxy
 * node and carries the virtual host in a header, which is what the proxy
 * routes by — the same thing `curl --resolve` does, and the same thing
 * `envd.js` already does by hand. The SDK builds `https://<port>-<id>.<domain>`
 * and expects DNS to answer for it, which nothing in this deployment does.
 *
 * So the request is rewritten on its way out. The SDK takes a `fetch` of our
 * own for exactly this, which is the adapter seam this migration was going to
 * need anyway.
 */
const viaProxy = () => {
  if (PROXY === '') return undefined
  const [host, port] = PROXY.split(':')
  // The connection is redirected, the URL is not. `Host` is a forbidden header
  // in fetch — setting it is silently dropped, and the proxy then answers for
  // itself rather than for the sandbox — so the virtual host stays in the URL
  // and only the socket goes somewhere else. This is `curl --resolve`.
  const agent = new Agent({ connect: { host, port: Number(port) } })
  return async (request) => undiciFetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: 'half',
    dispatcher: agent,
  })
}

/** @type {any} */
let sbx
await probe('SDK Sandbox.create', async () => {
  sbx = await Sandbox.create(TEMPLATE, {
    apiKey: API_KEY,
    domain: DOMAIN,
    apiUrl: API_URL,
    timeoutMs: 120_000,
    fetch: viaProxy(),
  })
  return `sandboxId ${String(sbx.sandboxId).slice(0, 20)}`
})

if (sbx !== undefined) {
  await probe('SDK files.write', async () => { await sbx.files.write('/tmp/probe.txt', 'probe\n'); return '' })
  await probe('SDK files.read', async () => JSON.stringify(await sbx.files.read('/tmp/probe.txt')))
  await probe('SDK files.list', async () => `${String((await sbx.files.list('/tmp')).length)} entries`)
  await probe('SDK files.exists', async () => String(await sbx.files.exists('/tmp/probe.txt')))
  await probe('SDK files.rename', async () => { await sbx.files.rename('/tmp/probe.txt', '/tmp/probe2.txt'); return '' })
  await probe('SDK files.makeDir', async () => { await sbx.files.makeDir('/tmp/probe-dir'); return '' })
  await probe('SDK files.remove', async () => { await sbx.files.remove('/tmp/probe2.txt'); return '' })
  await probe('SDK commands.run', async () => (await sbx.commands.run('echo conformance')).stdout.trim())
  await probe('SDK pty.create', async () => {
    const pty = await sbx.pty.create({ cols: 80, rows: 24, onData: () => {} })
    await sbx.pty.sendInput(pty.pid, new TextEncoder().encode('exit\n'))
    return `pid ${String(pty.pid)}`
  })
  await probe('SDK Sandbox.list', async () => `${String((await Sandbox.list({ apiKey: API_KEY, apiUrl: API_URL, domain: DOMAIN })).length ?? 0)} running`)
}

// ---- the shapes we depend on, read straight off the API --------------------

await probe('API GET /sandboxes', async () => {
  const { status, body } = await api('GET', '/sandboxes')
  if (status !== 200) throw new Error(`answered ${String(status)}`)
  const first = Array.isArray(body) ? body[0] : body?.sandboxes?.[0]
  return first === undefined ? 'empty' : `keys: ${Object.keys(first).slice(0, 6).join(',')}`
})

// The two extensions this deployment leans on. Their SHAPE is what may differ,
// so both are offered in the standard spelling and the answer is recorded.
await probe('API create · standard egress rules', async () => {
  const { status, body } = await api('POST', '/sandboxes', {
    templateID: TEMPLATE,
    metadata: { probe: 'conformance' },
    network: { allowOut: ['example.com'], rules: { 'example.com': [{ transform: { headers: { 'X-Probe': 'v' } } }] } },
  })
  if (status >= 400) throw new Error(`${String(status)}: ${JSON.stringify(body).slice(0, 90)}`)
  const id = body?.sandboxID ?? body?.sandboxId ?? body?.id
  if (id !== undefined) await api('DELETE', `/sandboxes/${encodeURIComponent(id)}`)
  return 'accepted'
})

await probe('API create · standard volume mount', async () => {
  const { status, body } = await api('POST', '/sandboxes', {
    templateID: TEMPLATE,
    metadata: { probe: 'conformance' },
    volumes: [{ volumeID: 'conformance-probe', path: '/mnt/probe' }],
  })
  if (status >= 400) throw new Error(`${String(status)}: ${JSON.stringify(body).slice(0, 90)}`)
  const id = body?.sandboxID ?? body?.sandboxId ?? body?.id
  if (id !== undefined) await api('DELETE', `/sandboxes/${encodeURIComponent(id)}`)
  return 'accepted'
})

// ---- clean up, loudly ------------------------------------------------------

let leaked = false
if (sbx !== undefined) {
  try {
    await sbx.kill()
    record('cleanup', 'pass', 'probe sandbox destroyed')
  } catch (error) {
    leaked = true
    record('cleanup', 'missing', `FAILED — a machine may be left running: ${String(error.message).slice(0, 80)}`)
  }
}

const counts = results.reduce((all, { verdict }) => ({ ...all, [verdict]: (all[verdict] ?? 0) + 1 }), {})
console.log(`\nconformance: ${String(counts.pass ?? 0)} pass, ${String(counts.shape ?? 0)} differ, ${String(counts.missing ?? 0)} missing`)
if (leaked) process.exit(1)
