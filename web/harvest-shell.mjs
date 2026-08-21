/**
 * Harvest the composed frontend shell at build time.
 *
 * The Vite build alone is not servable: a dsh host injects `window.__DSH_BOOT__`
 * — the entry graph naming the client plugin bundles and their revisions — and
 * serves those bundles under `/plugins`. Taking them from a tenant's sandbox at
 * request time would make the interface unavailable whenever that tenant's
 * sandbox is starting, reclaimed, or broken.
 *
 * They do not have to come from there. The graph describes a *composition*, not
 * a tenant: every sandbox in this deployment runs the same image, so all of
 * them serve byte-identical output. Booting that composition once here and
 * saving what it serves turns the shell back into what it should be — a static
 * artifact of the build, served by the frontend deployment, with the sandbox
 * needed only for `/api`.
 *
 * Usage: node web/harvest-shell.mjs <output-dir>
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

/** Where dsh is booted for the harvest. */
const AUTHORITY = '127.0.0.1:3080'

/** How long to wait for the composition to come up before giving up on the build. */
const BOOT_TIMEOUT_MS = 180_000

const outputDir = process.argv[2]
if (outputDir === undefined) {
  console.error('harvest-shell: an output directory is required')
  process.exit(1)
}

/**
 * Fetch one path from the booted host.
 * @param {string} path - the request path.
 * @returns {Promise<{status: number, body: Buffer}>} the response.
 */
async function get(path) {
  const response = await fetch(`http://${AUTHORITY}${path}`, { headers: { Host: AUTHORITY } })
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) }
}

/**
 * Resolve once `/api` answers, which is later than the socket opening: dsh
 * registers the route before the service behind it exists and answers 404 in
 * between.
 * @param {number} deadline - epoch milliseconds after which to fail.
 * @returns {Promise<void>} resolves when the host is serving.
 */
async function waitForBoot(deadline) {
  for (;;) {
    if (Date.now() > deadline) throw new Error('harvest-shell: dsh did not boot in time')
    const probe = await fetch(`http://${AUTHORITY}/api/host.describe`, {
      method: 'POST',
      headers: { Host: AUTHORITY, 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined)
    if (probe?.status === 200) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * Write one harvested file, creating its directories.
 * @param {string} path - request path, used as the relative file path.
 * @param {Buffer} body - the file contents.
 */
function save(path, body) {
  const file = join(outputDir, path.replace(/^\//, ''))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
}

// The sandbox composition minus its tunnel, which has no gateway to dial here.
// Everything that contributes a client half is identical, so the manifest this
// captures is the one the sandboxes serve.
const patch = process.env.DSH_PATCH ?? '/app/web/harvest.patch.yml'
// `--no-open` for the same reason the sandbox passes it: since 0.1.0-rc.8 this
// command opens a browser, and this one runs inside a build.
const host = spawn('node', [process.env.DSH_BIN ?? '/app/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--patch', patch, '--port', '3080', '--no-open'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'inherit', 'inherit'],
})

try {
  await waitForBoot(Date.now() + BOOT_TIMEOUT_MS)

  const index = await get('/')
  if (index.status !== 200) throw new Error(`harvest-shell: / answered ${index.status}`)
  save('/index.html', index.body)

  const html = index.body.toString('utf8')
  // Two spellings, because the host changed how it writes this and both are
  // the same fact. Through 0.1.0-rc.8 it assigned `window.__DSH_BOOT__`
  // directly; 0.1.1-rc.1 renders every injected global through one table as
  // `globalThis["__DSH_BOOT__"]`. Matching both keeps this able to harvest an
  // older shell, which is what a version bump wants to be reversible against.
  //
  // Anchored on `</script>` in either case: the injected row is one element
  // holding one assignment, so the first close after the value is its own.
  const manifest = /(?:window\.__DSH_BOOT__|globalThis\[(?:"|')__DSH_BOOT__(?:"|')\])\s*=\s*(\{.*?\})<\/script>/s.exec(html)
  if (manifest === null) throw new Error('harvest-shell: no boot manifest in the served index.html')
  const graph = JSON.parse(manifest[1].replaceAll('\\u003c', '<'))

  const entries = Array.isArray(graph) ? graph : (graph.entries ?? Object.values(graph).flat())
  const rows = entries.filter((entry) => typeof entry?.url === 'string')
  if (rows.length === 0) throw new Error('harvest-shell: the boot manifest names no bundles')

  for (const row of rows) {
    const bundle = await get(row.url)
    if (bundle.status !== 200) throw new Error(`harvest-shell: ${row.url} answered ${bundle.status}`)
    // Saved under the path without its ?rev= query: nginx resolves a request to
    // the file and ignores the query, and the revision is already pinned by the
    // manifest that was harvested alongside it.
    save(row.url.split('?')[0], bundle.body)
  }

  console.log(`harvest-shell: saved index.html and ${rows.length} client bundle(s) to ${outputDir}`)
} finally {
  host.kill('SIGTERM')
}
