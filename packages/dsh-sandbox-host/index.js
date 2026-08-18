/**
 * The sandbox adaptation layer, host half.
 *
 * dsh is built for a host on the desk of the person using it. The browser and
 * the backend share a filesystem there, so a path is enough: a file the person
 * wants to talk about is already reachable, a produced file opens in whatever
 * the desktop associates with it, and the configuration document opens in an
 * editor. None of that holds when the backend runs in a sandbox — and the
 * harness has a signal that says so, `host.describe().canOpenPath`, which is
 * already false on a Linux container with no display server.
 *
 * This plugin supplies what that signal reports missing, instead of hiding the
 * controls that depend on it. Everything in it follows from the sandbox alone:
 * take the gateway away and every line is still needed, which is why it is its
 * own package rather than more surface on `dsh-gateway-tunnel` (transport) or
 * on `dsh-tenant-account` (this deployment's tenants).
 *
 * ## Why `/files` and not `/api`
 *
 * The obvious home for these endpoints is the shared `/api` channel, through
 * `connection.rpc.intercept`. There is room for exactly one interceptor on it,
 * and dsh's own `typert-gateway` already holds it — a second registration
 * throws at mount, not at first call. So this takes a channel of its own, which
 * `connection.rpc.handle` exists for: same trust fence, same request envelope,
 * same body limit, and the nginx location and gateway forwarding rule it needs
 * are three lines in components this deployment already owns.
 *
 * @module dsh-sandbox-host
 */

import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { createUploads } from './uploads.js'

export const name = 'sandbox-host'

/**
 * `connection` is the channel registry. `webServer` is what a channel
 * registration binds its route on, and the registry reaches it through the
 * context that read it — this one — so it has to be here even though nothing
 * below names it.
 */
export const inject = ['connection', 'webServer']

/** The logical channel this plugin owns, end to end. */
const CHANNEL = '/files'

/** How often abandoned staging files are collected. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

/**
 * A caller error, in the envelope's own vocabulary.
 * @param {string} message - what the caller did.
 * @returns {object} the RPC result.
 */
const badRequest = (message) => ({ ok: false, error: { code: 'bad-request', message, details: { issues: [] } } })

/**
 * A failure that is this side's, in the envelope's own vocabulary.
 * @param {string} message - what went wrong.
 * @returns {object} the RPC result.
 */
const internal = (message) => ({ ok: false, error: { code: 'internal', message, details: {} } })

/**
 * Mount the file plane.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context, with `connection` and `webServer`.
 * @param {{root?: string}} [config] - the workspace root; the working directory by default, which is where dsh roots a tenant's workspace.
 */
export function apply(ctx, config) {
  const root = config?.root ?? process.cwd()
  const uploads = createUploads(root)
  // One sampler for the plugin's lifetime, because CPU is a difference between
  // two readings and a per-request sampler would have nothing to subtract.

  /**
   * The configuration document, prepared the way the control this replaces
   * prepared it.
   *
   * `settings.openDocument` calls `prepareDocument()` before handing the path
   * to the desktop, and that call is what materializes a document nobody has
   * written yet. Reading `documentPath` alone would answer "does not exist" for
   * every tenant who has never changed a setting — true, and useless.
   *
   * @returns {Promise<object>} the RPC result.
   */
  const readDocument = async () => {
    const settings = ctx.get('settings')
    if (settings === undefined) return internal('this composition mounts no settings service')
    const prepared = await settings.prepareDocument?.().catch(() => undefined)
    const documentPath = prepared ?? settings.documentPath
    if (documentPath === undefined) return internal('this settings service is not file-backed')
    const text = await readFile(documentPath, 'utf8').catch(() => undefined)
    return { ok: true, value: { path: documentPath, text: text ?? '', exists: text !== undefined } }
  }

  /**
   * How the agent is told a file arrived.
   *
   * Not through the draft. A path typed into the composer is what a LOCAL host
   * gives an agent, and copying that here means the person reads a path they
   * did not write, in a box that already shows them a card for the same file.
   * dsh has a better seat for exactly this: the agent inbox takes injected
   * context — the same channel approval notices and attached snapshots ride —
   * and a `plugin`-sourced message on `next-step` is invisible until the next
   * turn claims it, then renders as a context row rather than as words the
   * person appears to have said.
   *
   * Built by hand rather than through `createUserMessage`, because that lives
   * in `@deepseek-ai/dsh-llm` under `/app/node_modules`, which Node cannot
   * reach from this plugin's home in the profile. The factory is
   * `{...input, id: randomUUID()}` frozen; this is the same object.
   *
   * @param {string} sessionId - the session the upload belongs to.
   * @param {{path: string, name: string, bytes: number}} file - the published file.
   * @returns {string|undefined} the message id, when one was injected.
   */
  const announce = (sessionId, file) => {
    const agent = ctx.get('agents')?.get(sessionId)
    if (agent === undefined) return undefined
    const message = Object.freeze({
      id: randomUUID(),
      role: 'user',
      content: Object.freeze([Object.freeze({
        type: 'text',
        text: `The user attached a file. It is in this sandbox at ${file.path} `
          + `(${String(file.bytes)} bytes, originally named ${file.name}). `
          + 'Read it when the request refers to it; do not assume its contents.',
      })]),
      source: Object.freeze({
        kind: 'plugin',
        plugin: 'sandbox-host',
        form: 'notice',
        summary: `附件 ${file.name}`,
      }),
    })
    agent.inbox.append('next-step', message)
    return message.id
  }

  /**
   * One decoded call on this channel.
   * @param {string} endpoint - channel-relative endpoint.
   * @param {unknown} payload - the caller's payload.
   * @returns {Promise<object>} the RPC result.
   */
  const dispatch = async (endpoint, payload) => {
    const body = payload ?? {}
    switch (endpoint) {
      case 'upload.begin':
        return { ok: true, value: await uploads.begin(body.name, body.size) }
      case 'upload.chunk':
        return { ok: true, value: await uploads.chunk(body.id, body.data) }
      case 'upload.commit': {
        const file = await uploads.commit(body.id)
        // A sandbox with no session yet still gets the file; it just has
        // nobody to tell, and the card in the browser is the whole receipt.
        const messageId = body.sessionId === undefined ? undefined : announce(String(body.sessionId), file)
        return { ok: true, value: { ...file, name: path.basename(file.path), messageId } }
      }
      case 'upload.abort':
        return { ok: true, value: await uploads.abort(body.id) }
      case 'upload.retract': {
        // Taking the card off the message has to take the notice with it, or
        // the agent is told about a file the person changed their mind about.
        const agent = ctx.get('agents')?.get(String(body.sessionId))
        return { ok: true, value: { removed: agent?.inbox.remove(String(body.messageId)) === true } }
      }
      case 'document.read':
        return await readDocument()
      default:
        return badRequest(`no such endpoint: ${endpoint}`)
    }
  }

  // Registered against this context, so the route goes away with the plugin.
  // `trusted-host` rather than `loopback`: this is the same fence `/api` itself
  // stands behind, and pinning it to loopback would refuse nothing extra —
  // every request arrives from the tunnel, on loopback, either way.
  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    try {
      return await dispatch(endpoint, payload)
    } catch (error) {
      // RangeError is this package's own word for "the caller asked for
      // something it may not have", so it crosses as a caller error. Anything
      // else is a filesystem or a bug, and says so without inventing a cause.
      if (error instanceof RangeError) return badRequest(error.message)
      ctx.logger?.warn?.(`sandbox-host: ${endpoint} failed: ${error.message}`)
      return internal(error.message)
    }
  }, { authority: 'trusted-host' })

  ctx.effect(() => {
    const timer = setInterval(() => { void uploads.sweep().catch(() => {}) }, SWEEP_INTERVAL_MS)
    // The sweep is housekeeping; it must never be the reason a process stays up.
    timer.unref?.()
    return () => {
      clearInterval(timer)
      void uploads.close().catch(() => {})
    }
  }, 'sandbox-host: staged upload housekeeping')
}
