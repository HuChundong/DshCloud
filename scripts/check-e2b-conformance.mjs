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

const API_URL = process.env.E2B_API_URL ?? process.env.CUBE_API_URL ?? ''
const API_KEY = process.env.E2B_API_KEY ?? process.env.CUBE_API_KEY ?? ''
const TEMPLATE = process.env.E2B_TEMPLATE ?? process.env.CUBE_TEMPLATE_ID ?? ''

/** The proxy every sandbox is reached through, as `host:port`. Empty for a deployment whose sandboxes resolve on their own. */
const PROXY = process.env.E2B_PROXY ?? ''

/** The domain the virtual hosts are built under. */
const DOMAIN = process.env.E2B_SANDBOX_DOMAIN ?? process.env.CUBE_SANDBOX_DOMAIN ?? 'cube.app'

// Absent configuration is not a failure. This is the one check that needs a
// platform rather than a checkout, so on a laptop — and in the docker
// simulation, which is not an E2B API at all — it says so and stands down.
// Failing here would train everyone to ignore it, which is the opposite of
// what a conformance report is for.
if (API_URL === '' || API_KEY === '' || TEMPLATE === '') {
  console.log('check-e2b-conformance: no platform configured, nothing to measure')
  process.exit(0)
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
 * Where one sandbox's envd is, the way this deployment reaches it.
 *
 * The proxy routes by path with the prefix stripped before forwarding, which
 * is what `envd.js` uses and what any standard client can reach. The other
 * routing it offers — a virtual host in a `Host` header — is unreachable from
 * a fetch-based client, `Host` being forbidden there.
 *
 * @param {string} id - the platform's sandbox id.
 * @returns {string|undefined} the base URL, or nothing when no proxy is configured.
 */
const envdUrl = (id) => (PROXY === '' ? undefined : `http://${PROXY}/sandbox/${id}/49983`)

/** @type {any} */
let sbx
await probe('SDK Sandbox.create', async () => {
  sbx = await Sandbox.create(TEMPLATE, {
    apiKey: API_KEY,
    domain: DOMAIN,
    apiUrl: API_URL,
    timeoutMs: 120_000,
  })
  return `sandboxId ${String(sbx.sandboxId).slice(0, 20)}`
})

// Reconnected through the path routing, because that is how everything in this
// deployment reaches a sandbox. `Sandbox.create` answers with a client
// addressed the standard way, and nothing here resolves that name.
let inside = sbx
if (sbx !== undefined && PROXY !== '') {
  await probe('SDK reconnect via path', async () => {
    inside = await Sandbox.connect(sbx.sandboxId, { apiKey: API_KEY, sandboxUrl: envdUrl(sbx.sandboxId), debug: true })
    return 'path routing'
  })
}

if (inside !== undefined) {
  await probe('SDK files.write', async () => { await inside.files.write('/tmp/probe.txt', 'probe\n'); return '' })
  await probe('SDK files.read', async () => JSON.stringify(await inside.files.read('/tmp/probe.txt')))
  await probe('SDK files.list', async () => `${String((await inside.files.list('/tmp')).length)} entries`)
  await probe('SDK files.exists', async () => String(await inside.files.exists('/tmp/probe.txt')))
  await probe('SDK files.rename', async () => { await inside.files.rename('/tmp/probe.txt', '/tmp/probe2.txt'); return '' })
  await probe('SDK files.makeDir', async () => { await inside.files.makeDir('/tmp/probe-dir'); return '' })
  await probe('SDK files.remove', async () => { await inside.files.remove('/tmp/probe2.txt'); return '' })
  await probe('SDK commands.run', async () => (await inside.commands.run('echo conformance')).stdout.trim())
  await probe('SDK pty.create', async () => {
    const pty = await inside.pty.create({ cols: 80, rows: 24, onData: () => {} })
    await inside.pty.sendInput(pty.pid, new TextEncoder().encode('exit\n'))
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

// The divergences this deployment already knows about and has adapted to. A
// check that reports them every run trains people to skim it; one that reports
// something NEW is worth reading. So the known ones are named, and anything
// else is what the exit code is about.
const KNOWN = new Set(['API create · standard egress rules'])

const counts = results.reduce((all, { verdict }) => ({ ...all, [verdict]: (all[verdict] ?? 0) + 1 }), {})
const surprises = results.filter(({ name, verdict }) => verdict !== 'pass' && !KNOWN.has(name))

console.log(`\ncheck-e2b-conformance: ${String(counts.pass ?? 0)} pass, ${String(counts.shape ?? 0)} differ, ${String(counts.missing ?? 0)} missing`)
if (KNOWN.size > 0) console.log(`  known and adapted to: ${[...KNOWN].join('; ')}`)
if (surprises.length > 0) {
  console.error(`\n${String(surprises.length)} divergence(s) nobody has decided about:`)
  for (const { name, note } of surprises) console.error(`  ${name} — ${note}`)
  process.exit(1)
}
if (leaked) process.exit(1)
