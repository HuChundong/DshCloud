/**
 * What the sandbox can say about itself.
 *
 * Read from `/proc` and `statfs` rather than shelled out to `top` or `df`: the
 * numbers are the same, the cost is a few file reads, and nothing here has to
 * parse a human-formatted table that changes between releases.
 *
 * Under CubeSandbox these are the micro-VM's own figures — the template gives
 * this tenant 2 cores, 4 GB and a 20 GB writable layer — so they describe what
 * the person is actually using rather than the node underneath them.
 *
 * @module dsh-sandbox-host/metrics
 */

import { readFile, statfs } from 'node:fs/promises'

/**
 * Jiffies from `/proc/stat`'s aggregate line, split into busy and total.
 *
 * The file counts time since boot, so a single read says nothing about load
 * now. Two reads a moment apart do — which is why this returns the raw pair
 * and the caller keeps the previous one.
 *
 * @returns {Promise<{busy: number, total: number} | undefined>} the counters, or nothing when unreadable.
 */
async function cpuJiffies() {
  const line = await readFile('/proc/stat', 'utf8').then((text) => text.split('\n', 1)[0]).catch(() => undefined)
  if (line === undefined || !line.startsWith('cpu ')) return undefined
  // user nice system idle iowait irq softirq steal guest guest_nice
  const fields = line.trim().split(/\s+/).slice(1).map(Number)
  if (fields.length < 4 || fields.some(Number.isNaN)) return undefined
  const total = fields.reduce((sum, value) => sum + value, 0)
  // Idle and iowait are the two the kernel counts as "not working".
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0)
  return { busy: total - idle, total }
}

/**
 * Memory in use, as the kernel judges it.
 *
 * `MemAvailable` rather than `MemFree`: free memory in a warm machine is
 * nearly zero because the page cache holds the rest, and reporting that would
 * tell a tenant their sandbox is full when it is fine.
 *
 * @returns {Promise<{usedBytes: number, totalBytes: number} | undefined>} the figures, or nothing.
 */
async function memory() {
  const text = await readFile('/proc/meminfo', 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  const kb = (name) => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm').exec(text)
    return match === null ? undefined : Number(match[1]) * 1024
  }
  const totalBytes = kb('MemTotal')
  const available = kb('MemAvailable')
  if (totalBytes === undefined || available === undefined) return undefined
  return { usedBytes: totalBytes - available, totalBytes }
}

/**
 * The workspace's filesystem, which is the one a tenant fills.
 *
 * Measured at the workspace rather than at `/`: with a volume attached those
 * are different filesystems, and the one that matters is where their files go.
 *
 * @param {string} root - the workspace path.
 * @returns {Promise<{usedBytes: number, totalBytes: number} | undefined>} the figures, or nothing.
 */
async function disk(root) {
  const stat = await statfs(root).catch(() => undefined)
  if (stat === undefined) return undefined
  const totalBytes = Number(stat.blocks) * Number(stat.bsize)
  // `bavail` rather than `bfree`: the difference is the reserve only root may
  // use, which a tenant cannot have and should not be shown as theirs.
  const freeBytes = Number(stat.bavail) * Number(stat.bsize)
  return { usedBytes: Math.max(0, totalBytes - freeBytes), totalBytes }
}

/**
 * Create the sampler.
 *
 * It keeps one previous CPU reading so the first call can answer at all: with
 * nothing to compare against, `cpu` is reported as null rather than as zero —
 * an unknown load and an idle one are different things, and a ring drawn empty
 * for the first few seconds of every page load is a lie the UI would tell.
 *
 * @param {string} root - the workspace path.
 * @returns {{read: () => Promise<object>}} the sampler.
 */
export function createMetrics(root) {
  /** @type {{busy: number, total: number} | undefined} */
  let previous

  return {
    async read() {
      const [jiffies, mem, fs] = await Promise.all([cpuJiffies(), memory(), disk(root)])
      let cpu = null
      if (jiffies !== undefined) {
        if (previous !== undefined) {
          const spent = jiffies.total - previous.total
          // A zero window means two reads landed inside one jiffy; there is
          // nothing to divide by and nothing to report.
          if (spent > 0) cpu = Math.min(1, Math.max(0, (jiffies.busy - previous.busy) / spent))
        }
        previous = jiffies
      }
      return {
        cpu,
        cores: (await readFile('/proc/cpuinfo', 'utf8').catch(() => ''))
          .split('\n').filter((line) => line.startsWith('processor')).length || null,
        memory: mem ?? null,
        disk: fs ?? null,
      }
    },
  }
}
