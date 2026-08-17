/**
 * Staged writes: how a browser's bytes become a file the agent can be told
 * about.
 *
 * Three calls rather than one, and the body limit is not the reason — dsh
 * accepts 160 MiB and nginx is set to 200. The tunnel is: it carries every
 * request as base64 frames over one WebSocket, so an upload sent whole holds
 * that socket for its whole duration and every other `/api` call queues behind
 * it. Chunks give the socket somewhere to breathe.
 *
 * Nothing is visible under the uploads directory until `commit`. A half-written
 * file an agent could pick up and read is worse than no file: it looks
 * complete, and neither side can tell that it is not.
 *
 * No caller-supplied path reaches the filesystem here. The directory is this
 * side's choice and the name is reduced to one segment, so the fence that would
 * otherwise be needed against `../` does not have to exist.
 *
 * @module dsh-sandbox-host/uploads
 */

import { link, mkdir, open, readdir, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Raw bytes per chunk. Base64 inflates this by a third on the wire. */
export const CHUNK_BYTES = 4 * 1024 * 1024

/** Ceiling on one upload. A tenant's volume is not a place to park a disk image. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/** How long a begun-but-never-committed upload keeps its staging file. */
const STAGING_TTL_MS = 30 * 60 * 1000

/** Simultaneous staged uploads, so an abandoned browser cannot accumulate them. */
const MAX_OPEN_UPLOADS = 16

/**
 * Reduce a browser-supplied filename to something safe to create.
 *
 * The browser sends whatever the file was called on the person's own machine,
 * which is a value from outside this deployment: it can carry separators, a
 * traversal, control characters, or nothing at all. Everything structural is
 * removed rather than escaped — the name is a label here, and the directory it
 * lands in is chosen by this side.
 *
 * @param {unknown} name - the browser's filename.
 * @returns {string} a single path segment, never empty, never `.` or `..`.
 */
export function safeName(name) {
  const base = [...path.basename(String(name ?? ''))]
    .map((ch) => (ch === '/' || ch === '\\' || ch.codePointAt(0) < 0x20 ? '_' : ch))
    .join('')
    .trim()
  if (base === '' || base === '.' || base === '..') return 'file'
  // Long enough for any real name; short enough that the result plus a
  // collision suffix stays inside the 255-byte limit every filesystem here has.
  return base.length > 180 ? base.slice(0, 180) : base
}

/**
 * Create the upload store rooted at one workspace.
 *
 * The root is resolved through `realpath`, once, on first use: `/workspace` is
 * a symlink onto the tenant's volume whenever they have one, and a published
 * path that still names the link would read as somewhere else to anything that
 * resolves it.
 *
 * @param {string} root - the workspace root, normally dsh's working directory.
 * @returns {object} the store: begin, chunk, commit, abort, sweep, close.
 */
export function createUploads(root) {
  /** @type {Promise<{uploads: string, staging: string}> | undefined} */
  let dirs

  const directories = () => {
    dirs ??= realpath(path.resolve(root)).then((resolved) => ({
      uploads: path.join(resolved, 'uploads'),
      staging: path.join(resolved, 'uploads', '.staging'),
    }))
    return dirs
  }

  /** @type {Map<string, {name: string, size: number, bytes: number, file: object, staging: string, begun: number}>} */
  const inFlight = new Map()

  /**
   * Discard one staged upload, whether it is being abandoned or replaced.
   * @param {string} id - the upload id.
   */
  const discard = async (id) => {
    const record = inFlight.get(id)
    if (record === undefined) return
    inFlight.delete(id)
    await record.file.close().catch(() => {})
    await rm(record.staging, { force: true }).catch(() => {})
  }

  const store = {
    /**
     * Reserve a staging file for one upload.
     * @param {unknown} name - the browser's filename.
     * @param {unknown} size - the byte count the browser states, which commit holds it to.
     * @returns {Promise<{id: string, chunkBytes: number}>} the handle and the chunk size to use.
     */
    async begin(name, size) {
      const declared = Number(size)
      if (!Number.isInteger(declared) || declared < 0 || declared > MAX_UPLOAD_BYTES) {
        throw new RangeError(`upload size must be an integer between 0 and ${String(MAX_UPLOAD_BYTES)} bytes`)
      }
      if (inFlight.size >= MAX_OPEN_UPLOADS) {
        // Swept first: the limit exists for abandoned uploads, and the ones
        // that aged out are exactly those.
        await store.sweep()
        if (inFlight.size >= MAX_OPEN_UPLOADS) {
          throw new RangeError(`too many uploads in flight (${String(MAX_OPEN_UPLOADS)})`)
        }
      }
      const { staging: stagingDir } = await directories()
      await mkdir(stagingDir, { recursive: true })
      const id = randomUUID()
      const staging = path.join(stagingDir, id)
      // 'wx' rather than 'w': a repeated id would otherwise truncate a live
      // upload instead of failing.
      const file = await open(staging, 'wx')
      inFlight.set(id, { name: safeName(name), size: declared, bytes: 0, file, staging, begun: Date.now() })
      return { id, chunkBytes: CHUNK_BYTES }
    },

    /**
     * Append one chunk, in order.
     * @param {unknown} id - the upload id.
     * @param {unknown} data - base64 of the next raw bytes.
     * @returns {Promise<{received: number}>} bytes written so far.
     */
    async chunk(id, data) {
      const key = String(id)
      const record = inFlight.get(key)
      if (record === undefined) throw new RangeError('no such upload')
      const bytes = Buffer.from(String(data ?? ''), 'base64')
      if (record.bytes + bytes.length > record.size) {
        // The declared size is what commit trusts, so a stream that outgrows it
        // ends here rather than quietly producing a file of a length nobody
        // stated.
        await discard(key)
        throw new RangeError('upload exceeded the size it declared')
      }
      await record.file.write(bytes)
      record.bytes += bytes.length
      return { received: record.bytes }
    },

    /**
     * Publish the staged bytes under a name the agent can be given.
     * @param {unknown} id - the upload id.
     * @returns {Promise<{path: string, name: string, bytes: number}>} where it landed.
     */
    async commit(id) {
      const key = String(id)
      const record = inFlight.get(key)
      if (record === undefined) throw new RangeError('no such upload')
      if (record.bytes !== record.size) {
        await discard(key)
        throw new RangeError(`upload is ${String(record.bytes)} bytes, declared ${String(record.size)}`)
      }
      // Durable before it is visible. A crash between these two is allowed to
      // lose the upload; it must not publish a name whose bytes are still only
      // in a page cache.
      await record.file.sync()
      await record.file.close()
      inFlight.delete(key)

      // Dated rather than flat. A tenant uploads against a conversation, and
      // months of them in one directory is a listing nobody reads — while the
      // date is the thing they can still remember about a file they sent.
      const { uploads } = await directories()
      const directory = path.join(uploads, new Date().toISOString().slice(0, 10))
      await mkdir(directory, { recursive: true })

      // Published by hard link, which fails rather than overwrites: two files
      // of the same name uploaded on one day are two files. `rename` would have
      // replaced the first with the second and said nothing.
      const extension = path.extname(record.name)
      const stem = record.name.slice(0, record.name.length - extension.length)
      let published
      for (let attempt = 0; published === undefined; attempt += 1) {
        const candidate = path.join(
          directory,
          attempt === 0 ? record.name : `${stem}-${String(attempt)}${extension}`,
        )
        try {
          await link(record.staging, candidate)
          published = candidate
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
          if (attempt > 999) throw new RangeError('too many files of that name today')
        }
      }
      await rm(record.staging, { force: true }).catch(() => {})
      return { path: published, name: path.basename(published), bytes: record.bytes }
    },

    /**
     * Give up on one upload.
     * @param {unknown} id - the upload id.
     * @returns {Promise<Record<string, never>>} nothing.
     */
    async abort(id) {
      await discard(String(id))
      return {}
    },

    /** Collect staged files nobody is going to commit. */
    async sweep() {
      const deadline = Date.now() - STAGING_TTL_MS
      for (const [id, record] of Array.from(inFlight)) {
        if (record.begun <= deadline) await discard(id)
      }
      // Staging files with no record belong to a previous process: this plugin
      // mounts once per sandbox boot, and a sandbox that stopped mid-upload
      // leaves them behind with nothing that will ever commit them.
      const { staging: stagingDir } = await directories()
      for (const entry of await readdir(stagingDir).catch(() => [])) {
        if (inFlight.has(entry)) continue
        const orphan = path.join(stagingDir, entry)
        const age = await stat(orphan).then((info) => Date.now() - info.mtimeMs).catch(() => 0)
        if (age > STAGING_TTL_MS) await rm(orphan, { force: true }).catch(() => {})
      }
    },

    /** Drop everything in flight, on unload. */
    async close() {
      for (const id of Array.from(inFlight.keys())) await discard(id)
    },
  }

  return store
}
