/**
 * Bring a tenant's stored data up to the layout this image understands.
 *
 * Steps are numbered and run in order, each one taking the volume from the
 * layout below it to its own. The entrypoint decides whether to call this at
 * all: it compares the version stamped on the volume with the one the image
 * was built for and, when they agree, never starts this process. So the cost
 * on an ordinary boot is one read of a small file, and the cost here is paid
 * once per upgrade rather than once per sandbox.
 *
 * Adding a step means adding an entry below and raising
 * `SANDBOX_LAYOUT_VERSION` in the Dockerfile by one. The two are read together
 * and neither is useful alone: a step nobody's version reaches never runs, and
 * a version with no step claims work that was never done.
 *
 * Usage: node migrate-storage-paths.mjs <dsh-home> <workspace-root> <from> <to>
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const [home, workspace, from, to] = process.argv.slice(2)
if (home === undefined || workspace === undefined || from === undefined || to === undefined) {
  process.stderr.write('migrate-storage-paths: needs <dsh-home> <workspace-root> <from> <to>\n')
  process.exit(2)
}

/**
 * Mount points this deployment has used for a tenant's own files.
 *
 * Ordered longest first, so `/persist/workspace` is matched before a bare
 * `/workspace` could be considered for the same string.
 */
const FORMER_ROOTS = ['/persist/workspace', '/workspace']

/**
 * Rewrite one recorded path onto the current root.
 *
 * @param {unknown} value - a recorded workspace path.
 * @returns {string|undefined} the rewritten path, or undefined to leave it alone.
 */
function relocated(value) {
  if (typeof value !== 'string') return undefined
  for (const former of FORMER_ROOTS) {
    if (value === former) return workspace
    if (value.startsWith(`${former}/`)) return workspace + value.slice(former.length)
  }
  return undefined
}

/**
 * Move the workspace registry onto the current mount point.
 *
 * The harness records each workspace by absolute path and groups by that
 * record — a session belongs to a workspace because that workspace's
 * `sessionIds` says so. A registration written while the volume was mounted
 * somewhere else therefore points at a directory that no longer exists, and
 * its sessions, still present and still listed, appear ungrouped.
 *
 * Session logs are deliberately untouched. A log header is immutable storage
 * metadata carrying the cwd it was created under, and the projection cache
 * validates that header and discards a record it cannot match rather than
 * trusting it — so a stale cwd there costs a re-fold and never a wrong answer.
 * Grouping is decided by the registry alone.
 *
 * @returns {string[]} what moved, for the log.
 */
function relocateWorkspaceRegistry() {
  const registry = path.join(home, 'storages', 'workspace.json')

  let source
  try {
    source = readFileSync(registry, 'utf8')
  } catch {
    // No registry is the ordinary case for a tenant who has not opened a
    // workspace, and for a first boot on a fresh volume.
    return []
  }

  let document
  try {
    document = JSON.parse(source)
  } catch (error) {
    // Left exactly as found. A registry this cannot parse is one it must not
    // rewrite: the harness may still make sense of it, and a half-understood
    // overwrite would lose what is there.
    process.stderr.write(`migrate-storage-paths: ${registry} is not JSON, leaving it alone (${error.message})\n`)
    return []
  }

  const workspaces = document?.tables?.workspaces
  if (workspaces === null || typeof workspaces !== 'object') return []

  const moved = []
  for (const record of Object.values(workspaces)) {
    const next = relocated(record?.path)
    if (next === undefined) continue
    moved.push(`${record.path} -> ${next}`)
    record.path = next
  }
  if (moved.length === 0) return []

  // Written through a temporary file and renamed, so a sandbox that dies
  // mid-write leaves the registry it had rather than half of one.
  const temporary = `${registry}.migrating`
  writeFileSync(temporary, `${JSON.stringify(document)}\n`)
  renameSync(temporary, registry)
  return moved
}

/** Every layout step, by the version it brings a volume TO. */
const STEPS = [
  { to: 2, what: 'workspace registry onto the current mount point', run: relocateWorkspaceRegistry },
]

const start = Number(from)
const target = Number(to)
if (!Number.isInteger(start) || !Number.isInteger(target)) {
  process.stderr.write(`migrate-storage-paths: <from> and <to> must be integers, got ${from} and ${to}\n`)
  process.exit(2)
}

for (const step of STEPS) {
  if (step.to <= start || step.to > target) continue
  process.stdout.write(`migrate-storage-paths: [${String(step.to)}] ${step.what}\n`)
  for (const line of step.run()) process.stdout.write(`migrate-storage-paths:   ${line}\n`)
}
