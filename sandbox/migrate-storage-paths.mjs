/**
 * Carry a tenant's workspace registry across a change of mount point.
 *
 * The harness records each workspace by absolute path, and grouping is by that
 * record rather than by anything derived at read time: a session belongs to a
 * workspace because the workspace's `sessionIds` says so. So when the volume's
 * mount point moved — `/persist` and, before it, a `/workspace` symlink, both
 * now `/mnt` — every registration made under the old layout kept pointing at a
 * directory that no longer exists. The sessions were still there and still
 * listed; they simply belonged to a workspace the harness could no longer
 * find, and appeared as ungrouped.
 *
 * Nothing here reads or rewrites a session log. A log's header is immutable
 * storage metadata and carries the cwd it was created under; the projection
 * cache validates that header and DISCARDS a record it cannot match rather
 * than trusting it, so a stale cwd there costs a re-fold and never a wrong
 * answer. The registry is the only thing that decides grouping, and the only
 * thing this touches.
 *
 * Idempotent by construction: it rewrites nothing when no old prefix is
 * present, which is every boot after the first and every tenant who never saw
 * the old layout.
 *
 * Usage: node migrate-storage-paths.mjs <dsh-home> <workspace-root>
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * Mount points this deployment has used for a tenant's own files.
 *
 * Ordered longest first so `/persist/workspace` is matched before a bare
 * `/workspace` could ever be considered for the same string.
 */
const FORMER_ROOTS = ['/persist/workspace', '/workspace']

const [home, workspace] = process.argv.slice(2)
if (home === undefined || workspace === undefined) {
  process.stderr.write('migrate-storage-paths: needs <dsh-home> <workspace-root>\n')
  process.exit(2)
}

const registry = path.join(home, 'storages', 'workspace.json')

/**
 * The same directory under the current root, when a path names an old one.
 *
 * @param {string} value - a recorded workspace path.
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

let source
try {
  source = readFileSync(registry, 'utf8')
} catch {
  // No registry is the ordinary case: a tenant who has not opened a workspace,
  // or a sandbox with no volume at all.
  process.exit(0)
}

let document
try {
  document = JSON.parse(source)
} catch (error) {
  // Left exactly as found. A registry this cannot parse is one it must not
  // rewrite — the harness may still make sense of it, and a half-understood
  // overwrite would lose what is there.
  process.stderr.write(`migrate-storage-paths: ${registry} is not JSON, leaving it alone (${error.message})\n`)
  process.exit(0)
}

const workspaces = document?.tables?.workspaces
if (workspaces === null || typeof workspaces !== 'object') process.exit(0)

const moved = []
for (const record of Object.values(workspaces)) {
  const next = relocated(record?.path)
  if (next === undefined) continue
  moved.push(`${record.path} -> ${next}`)
  record.path = next
}

if (moved.length === 0) process.exit(0)

// Written through a temporary file and renamed, so a tenant whose sandbox dies
// mid-write keeps the registry they had rather than half of one.
const temporary = `${registry}.migrating`
writeFileSync(temporary, `${JSON.stringify(document)}\n`)
renameSync(temporary, registry)
for (const line of moved) process.stdout.write(`migrate-storage-paths: ${line}\n`)
