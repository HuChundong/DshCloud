/**
 * Per-user sandbox lifecycle.
 *
 * One user gets one sandbox, holding their sessions, their workspace, and the
 * agent that acts on both. Isolation between users is container isolation:
 * nothing in the gateway multiplexes two users into one dsh process, because
 * dsh has no tenant concept of its own — its `/api` surface is single-occupancy
 * and its session store is process-wide.
 *
 * Which runtime provides that machine — CubeSandbox, or the Docker simulation
 * — is chosen in `runtimes.js`. Nothing else here knows the difference: the
 * sandbox dials the gateway, so no code path depends on being able to reach in.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import process from 'node:process'
import { selectRuntime } from './runtimes.js'

/** The sandbox runtime in use — CubeSandbox, or the Docker simulation. */
const runtime = selectRuntime()

/** How long a sandbox may sit unused before it is reclaimed. */
const IDLE_TTL_MS = Number(process.env.SANDBOX_IDLE_TTL_MS ?? 30 * 60 * 1000)

/** How often to scan for idle sandboxes. */
const REAP_INTERVAL_MS = 60_000

/** How long to wait for a freshly started sandbox to dial in. */
export const DIAL_IN_TIMEOUT_MS = Number(process.env.SANDBOX_DIAL_IN_TIMEOUT_MS ?? 60_000)

export class SandboxManager {
  /**
   * @param {object} options - manager configuration.
   * @param {string} options.gatewayTunnelUrl - URL the sandbox dials back on.
   * @param {() => Promise<Record<string, string>>} options.env - extra environment for a sandbox about to start (model credentials and endpoint), resolved per creation so a credential changed in the console reaches the next sandbox.
   * @param {(sandboxId: string) => number | undefined} options.lastActiveAt - when traffic last crossed that sandbox's tunnel, for the idle sweep to weigh against the last request.
   */
  constructor(options) {
    this.options = options
    /** @type {Map<string, {sandboxId: string, token: string, handle: string, lastUsedAt: number}>} */
    this.byUser = new Map()
    /** @type {Map<string, string>} */
    this.tokenBySandbox = new Map()
    /** In-flight creations, so concurrent first requests share one sandbox. @type {Map<string, Promise<{sandboxId: string, token: string}>>} */
    this.creating = new Map()
    this.timer = setInterval(() => { void this.reapIdle() }, REAP_INTERVAL_MS)
    this.timer.unref()
  }

  /**
   * Whether a dial-in presents the token this gateway issued for that sandbox.
   *
   * The check is the sandbox's whole identity proof: a tunnel that passes it is
   * trusted to answer that tenant's streams, so an unknown id must fail closed.
   *
   * @param {string} sandboxId - the claimed sandbox id.
   * @param {string} token - the presented token.
   * @returns {boolean} whether the dial-in is authorized.
   */
  authorize(sandboxId, token) {
    const expected = this.tokenBySandbox.get(sandboxId)
    return expected !== undefined && expected === token
  }

  /**
   * Return the user's sandbox, starting one if they have none.
   * @param {string} username - the authenticated user.
   * @param {string} accountId - their stable account id, which names their durable state.
   * @returns {Promise<{sandboxId: string, token: string}>} the sandbox identity.
   */
  async ensure(username, accountId) {
    const existing = this.byUser.get(username)
    if (existing !== undefined) {
      existing.lastUsedAt = Date.now()
      return { sandboxId: existing.sandboxId, token: existing.token }
    }
    // A browser opens a page and several /api calls at once, so requests for a
    // tenant with no sandbox arrive together. Each would otherwise pass the
    // check above — creating a sandbox takes long enough that none has
    // recorded one yet — and start its own, leaving every sandbox but the last
    // orphaned: still dialling in, still holding memory, and reachable by a
    // request routed before the record settled.
    const inFlight = this.creating.get(username)
    if (inFlight !== undefined) return await inFlight

    const creation = this.#create(username, accountId)
    this.creating.set(username, creation)
    try {
      return await creation
    } finally {
      this.creating.delete(username)
    }
  }

  /**
   * Create and start one sandbox for a user.
   * @param {string} username - the owning user.
   * @param {string} accountId - their stable account id.
   * @returns {Promise<{sandboxId: string, token: string}>} the sandbox identity.
   */
  async #create(username, accountId) {
    const sandboxId = randomUUID()
    const token = randomBytes(32).toString('hex')
    // Registered before the sandbox starts: it may dial in while the runtime
    // call is still returning, and a dial-in that arrives before its own token
    // is known would be rejected as forged.
    this.tokenBySandbox.set(sandboxId, token)

    const handle = await runtime.create({ username, accountId }, {
      SANDBOX_ID: sandboxId,
      SANDBOX_TOKEN: token,
      GATEWAY_TUNNEL_URL: this.options.gatewayTunnelUrl,
      ...await this.options.env(),
    })

    this.byUser.set(username, { sandboxId, token, handle, lastUsedAt: Date.now() })
    console.log(`gateway: started sandbox ${sandboxId} for ${username}`)
    return { sandboxId, token }
  }

  /**
   * Whether a user has a sandbox, for the administrator's console.
   *
   * Reports this gateway's own record rather than asking the runtime: the
   * console is answering "is this tenant occupying a machine right now", and a
   * sandbox the gateway has no record of is one nothing can route to.
   *
   * @param {string} username - the user to ask about.
   * @returns {'running' | 'none'} whether a sandbox is held for them.
   */
  stateOf(username) {
    return this.byUser.has(username) ? 'running' : 'none'
  }

  /**
   * Record that a user's sandbox was just used, deferring its idle reclamation.
   * @param {string} username - the authenticated user.
   */
  touch(username) {
    const record = this.byUser.get(username)
    if (record !== undefined) record.lastUsedAt = Date.now()
  }

  /**
   * Drop a user's sandbox record so the next request builds a fresh one.
   *
   * A sandbox can die without the gateway hearing about it — it can crash, be
   * OOM-killed, or be removed by an operator. The record would otherwise keep
   * pointing every request at a sandbox that will never dial in again, and
   * the tenant would sit at 503 until the idle sweep eventually reclaimed it.
   *
   * @param {string} username - the owning user.
   * @param {string} [sandboxId] - forget only if the record still names this sandbox; omitted forgets whatever is recorded.
   */
  async forget(username, sandboxId) {
    const record = this.byUser.get(username)
    if (record === undefined) return
    // The caller observed a specific sandbox fail. If the record has moved on
    // since, another request already replaced it and this one must not undo
    // that — it would discard a working sandbox and build a third.
    if (sandboxId !== undefined && record.sandboxId !== sandboxId) return
    this.byUser.delete(username)
    this.tokenBySandbox.delete(record.sandboxId)
    // Best-effort: the sandbox is usually already gone, which is why we are here.
    await runtime.remove(record.handle).catch(() => {})
    console.log(`gateway: forgot unreachable sandbox ${record.sandboxId} for ${username}`)
  }

  /**
   * Destroy a user's sandbox.
   * @param {string} username - the owning user.
   */
  async release(username) {
    const record = this.byUser.get(username)
    if (record === undefined) return
    this.byUser.delete(username)
    this.tokenBySandbox.delete(record.sandboxId)
    await runtime.remove(record.handle)
    console.log(`gateway: released sandbox ${record.sandboxId} for ${username}`)
  }

  /**
   * Reclaim sandboxes whose owner has been gone longer than the idle TTL.
   *
   * Idle means no traffic, not no new request. `lastUsedAt` moves when a
   * request starts, which misses the case that matters most: one agent turn can
   * run for an hour, and it streams its answer over a socket opened before it
   * began, so on that signal alone the sandbox looks untouched and gets
   * destroyed with the turn's work inside it. The tunnel's own last frame
   * covers that, and carries no heartbeat to confound it — an abandoned browser
   * tab holds its socket open in silence and is still reclaimed on time.
   */
  async reapIdle() {
    const deadline = Date.now() - IDLE_TTL_MS
    // `release` deletes the entry this iteration is on, which a Map allows: an
    // entry removed before it is reached is simply not reached, and the one
    // being visited has already been handed over.
    for (const [username, record] of this.byUser) {
      const active = this.options.lastActiveAt(record.sandboxId) ?? 0
      if (Math.max(record.lastUsedAt, active) > deadline) continue
      await this.release(username).catch((error) => {
        console.error(`gateway: reaping ${username} failed: ${error.message}`)
      })
    }
  }

  /**
   * Remove sandboxes left behind by a previous gateway process.
   *
   * Their tokens died with that process, so they can never dial in again and
   * would otherwise sit idle holding memory until an operator noticed.
   *
   * TODO: adopt them instead of reaping them. Sessions now outlive a restart,
   * so a tenant stays signed in across one and is handed a fresh workspace with
   * no conversation history — silent loss of their work where being signed out
   * at least made the reset visible. Persisting this registry (id, token,
   * container, owner) beside the session store would let a surviving container
   * redial and be recognized; the sandbox client already redials on its own.
   * Sandbox filesystems also need a volume before adoption is worth much.
   */
  async reapOrphans() {
    const handles = await runtime.listOwned().catch(() => [])
    for (const handle of handles) {
      await runtime.remove(handle).catch(() => {})
    }
    if (handles.length > 0) console.log(`gateway: reaped ${handles.length} orphaned sandbox(es)`)
  }
}
