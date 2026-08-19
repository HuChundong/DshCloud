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
 *
 * WHO OWNS WHICH SANDBOX IS IN THE DATABASE, not in this process. The table is
 * the truth and the map below is this instance's cache of it, filled once at
 * startup and written through on every change.
 *
 * That distinction is the point rather than an implementation detail. Held only
 * in memory, the registry made a restart destroy every sandbox — a tenant whose
 * session outlived the gateway came back to an empty workspace, which is losing
 * their history silently. It also made a second gateway impossible: the first
 * thing a new instance did was reap every sandbox it did not know about, which
 * is all of another instance's. And two instances could each start a sandbox
 * for one tenant, mounting one volume twice.
 *
 * A row is claimed rather than recreated. `adopt()` at startup keeps what is
 * still running and clears what is not, so a sandbox that survived the gateway
 * is redialed and recognized — the sandbox client redials on its own.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import process from 'node:process'
import { selectRuntime } from './runtimes.js'

/** The sandbox runtime in use — CubeSandbox, or the Docker simulation. */
const runtime = selectRuntime()

/** How long a sandbox may sit unused before it is reclaimed. */
const IDLE_TTL_MS = Number(process.env.SANDBOX_IDLE_TTL_MS ?? 30 * 60 * 1000)

/**
 * How long a sandbox may sit unused once nobody is looking at it.
 *
 * A browser holds the `/api` event socket open for as long as its page is
 * loaded, so no socket means the tab is closed. Waiting the full idle TTL then
 * holds a machine for someone who has left; coming back costs the seconds a
 * sandbox takes to start, and their files and history are on the volume either
 * way. Nothing here applies while an agent is working — that is decided before
 * either TTL is consulted.
 */
const DEPARTED_TTL_MS = Number(process.env.SANDBOX_DEPARTED_TTL_MS ?? 5 * 60 * 1000)

/** How often to scan for idle sandboxes. */
const REAP_INTERVAL_MS = 60_000

/** How long to wait for a freshly started sandbox to dial in. */
export const DIAL_IN_TIMEOUT_MS = Number(process.env.SANDBOX_DIAL_IN_TIMEOUT_MS ?? 60_000)

/**
 * Which gateway this is.
 *
 * Recorded on every sandbox it starts, because the tunnel that sandbox dials
 * can only land on the instance whose address it was given — so this is the
 * instance that can serve it. Nothing reads it yet; routing will.
 *
 * The hostname is right for a container per instance, which is what a compose
 * or Kubernetes deployment gives. An operator running two on one host sets the
 * variable.
 */
const GATEWAY_ID = process.env.GATEWAY_ID || hostname()

/**
 * How stale a row's `last_used_at` may get before the sweep writes it back.
 *
 * Every request touches its tenant's sandbox, and a write per request would
 * make this table the busiest thing in the database for a value read once a
 * minute. The idle TTLs are measured in minutes, so a stamp a minute behind
 * changes no decision.
 */
const TOUCH_FLUSH_MS = 60_000

export class SandboxManager {
  /**
   * @param {object} options - manager configuration.
   * @param {import('pg').Pool} options.db - the connected pool; the sandbox registry lives there.
   * @param {string} options.gatewayTunnelUrl - URL the sandbox dials back on.
   * @param {() => Promise<Record<string, string>>} options.env - extra environment for a sandbox about to start (model credentials and endpoint), resolved per creation so a credential changed in the console reaches the next sandbox.
   * @param {(username: string) => Promise<Record<string, string>>} options.secrets - the tenant's own environment, applied beneath everything the deployment sets.
   * @param {(sandboxId: string) => number | undefined} options.lastActiveAt - when traffic last crossed that sandbox's tunnel, for the idle sweep to weigh against the last request.
   */
  constructor(options) {
    this.options = options
    this.db = options.db
    /**
     * This instance's cache of the table, so the common path does not query.
     * @type {Map<string, {sandboxId: string, token: string, handle: string, accountId: string, lastUsedAt: number, flushedAt: number}>}
     */
    this.byUser = new Map()
    /** @type {Map<string, string>} */
    this.tokenBySandbox = new Map()
    /** In-flight creations, so concurrent first requests share one sandbox. @type {Map<string, Promise<{sandboxId: string, token: string, handle: string}>>} */
    this.creating = new Map()
    this.timer = setInterval(() => { void this.reapIdle() }, REAP_INTERVAL_MS)
    this.timer.unref()
  }

  /**
   * Put one row into the cache.
   * @param {object} row - a `sandboxes` row.
   */
  #remember(row) {
    this.byUser.set(row.username, {
      sandboxId: row.sandbox_id,
      token: row.token,
      handle: row.handle,
      accountId: row.account_id,
      lastUsedAt: new Date(row.last_used_at).getTime(),
      flushedAt: Date.now(),
    })
    this.tokenBySandbox.set(row.sandbox_id, row.token)
  }

  /**
   * Forget one tenant here and in the table.
   * @param {string} username - the owning user.
   * @param {string} sandboxId - the sandbox being dropped.
   */
  async #erase(username, sandboxId) {
    this.byUser.delete(username)
    this.tokenBySandbox.delete(sandboxId)
    await this.db.query('DELETE FROM sandboxes WHERE username = $1 AND sandbox_id = $2', [username, sandboxId])
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
   *
   * Two identities come back and they are not interchangeable. `sandboxId` is
   * the gateway's own: it is what the sandbox presents when it dials in, what
   * tunnels are keyed by, and what a tenant quotes. `handle` is the runtime's:
   * it is the only one that is an ADDRESS, and every call to `envd.js` takes
   * it. Under docker the handle is derived from the id, so confusing them
   * still works; under CubeSandbox they are unrelated and confusing them
   * reaches nothing.
   *
   * @param {string} username - the authenticated user.
   * @param {string} accountId - their stable account id, which names their durable state.
   * @returns {Promise<{sandboxId: string, token: string, handle: string}>} the gateway's identity for the sandbox, its dial-in token, and the runtime's address for it.
   */
  async ensure(username, accountId) {
    const existing = this.byUser.get(username)
    if (existing !== undefined) {
      existing.lastUsedAt = Date.now()
      return { sandboxId: existing.sandboxId, token: existing.token, handle: existing.handle }
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

    // Composed least-trusted first, and the order is the enforcement.
    //
    // What the tenant asked for goes in at the bottom, so a name that reached
    // the table despite `secrets.js` refusing it — an older row, a hand-written
    // INSERT — is overwritten here rather than obeyed. Above it sits the
    // sandbox's own identity and its way back, and above that the deployment's
    // model credential. Reversing any pair of these hands a tenant something:
    // `SANDBOX_TOKEN` is another sandbox's session, `GATEWAY_TUNNEL_URL` is
    // somewhere else to dial, `DEEPSEEK_BASE_URL` is somewhere else to send the
    // deployment's key.
    const handle = await runtime.create({ username, accountId }, {
      ...await this.options.secrets(username),
      SANDBOX_ID: sandboxId,
      SANDBOX_TOKEN: token,
      GATEWAY_TUNNEL_URL: this.options.gatewayTunnelUrl,
      ...await this.options.env(),
    })

    // The table decides who won, not this process. Two gateways can reach here
    // for one tenant at the same time — the in-flight map above only covers
    // this one — and the primary key on `username` is what stops both from
    // keeping their sandbox. The loser destroys the machine it just built
    // rather than leaving a second one mounted on the same volume.
    const { rows } = await this.db.query(
      `INSERT INTO sandboxes (username, account_id, sandbox_id, handle, token, gateway_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO NOTHING
       RETURNING *`,
      [username, accountId, sandboxId, handle, token, GATEWAY_ID],
    )
    if (rows.length === 0) {
      this.tokenBySandbox.delete(sandboxId)
      await runtime.remove(handle).catch(() => {})
      const existing = await this.db.query('SELECT * FROM sandboxes WHERE username = $1', [username])
      if (existing.rows.length === 0) {
        throw new Error(`gateway: lost the race for ${username}'s sandbox and found no winner`)
      }
      console.log(`gateway: discarded a second sandbox for ${username}; another gateway had one`)
      this.#remember(existing.rows[0])
      const won = this.byUser.get(username)
      return { sandboxId: won.sandboxId, token: won.token, handle: won.handle }
    }

    this.#remember(rows[0])
    console.log(`gateway: started sandbox ${sandboxId} for ${username}`)
    return { sandboxId, token, handle }
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
    if (record === undefined) return
    const now = Date.now()
    record.lastUsedAt = now
    // Written back on a slow beat, not per request — see TOUCH_FLUSH_MS. The
    // in-memory value is what this instance's own sweep reads; the column is
    // what survives a restart and what another instance would read.
    if (now - record.flushedAt < TOUCH_FLUSH_MS) return
    record.flushedAt = now
    void this.db.query('UPDATE sandboxes SET last_used_at = now() WHERE username = $1', [username])
      .catch((error) => { console.error(`gateway: could not stamp ${username}'s sandbox: ${error.message}`) })
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
    await this.#erase(username, record.sandboxId)
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
    await this.#erase(username, record.sandboxId)
    await runtime.remove(record.handle)
    console.log(`gateway: released sandbox ${record.sandboxId} for ${username}`)
  }

  /**
   * Reclaim sandboxes nobody is using.
   *
   * Three states, because "idle" turns out to be two questions:
   *
   * - **Something is working in there.** Never reclaimed, however quiet the
   *   tunnel is. A turn with no browser attached sends nothing at all — the
   *   page that would receive its output is closed — so traffic alone would
   *   destroy exactly the long task this exists to run.
   * - **Idle, page still open.** The tenant is present but not asking, and
   *   gets the full idle TTL.
   * - **Idle, nobody looking.** A browser holds its `/api` event socket for as
   *   long as the page is loaded, so no socket is the tenant having left. They
   *   get the short one: coming back costs the seconds a sandbox takes to
   *   start, and their files and history are on the volume regardless.
   *
   * Traffic still decides *when* within a state, because `lastUsedAt` moves
   * only as a request starts and would call a streaming sandbox untouched.
   */
  async reapIdle() {
    const now = Date.now()
    // `release` deletes the entry this iteration is on, which a Map allows: an
    // entry removed before it is reached is simply not reached, and the one
    // being visited has already been handed over.
    for (const [username, record] of this.byUser) {
      const presence = this.options.presenceOf(record.sandboxId)
      // A sandbox with no tunnel reports nothing and protects nothing, so it is
      // judged on traffic alone — which is what one that never dialled in is.
      if (presence?.busy === true) continue
      const ttl = presence?.attached === true ? IDLE_TTL_MS : DEPARTED_TTL_MS
      const active = this.options.lastActiveAt(record.sandboxId) ?? 0
      if (Math.max(record.lastUsedAt, active) > now - ttl) continue
      await this.release(username).catch((error) => {
        console.error(`gateway: reaping ${username} failed: ${error.message}`)
      })
    }
  }

  /**
   * Claim the sandboxes this deployment already has.
   *
   * Called once at startup, in place of the reap that used to happen there.
   * The reap destroyed every sandbox the runtime knew about, on the reasoning
   * that their tokens died with the process that issued them — true while the
   * registry was a Map, and the reason a tenant whose session outlived a
   * restart came back to an empty workspace. The tokens are in the table now,
   * so a surviving sandbox can be recognized when it redials, which it does on
   * its own.
   *
   * Three cases, and the third is why this cannot simply trust the table:
   *
   * - **In the table and still running.** Kept. Its row already says who it
   *   belongs to and what token proves it.
   * - **In the table and gone.** The row is deleted, so the next request builds
   *   a fresh one instead of waiting for a dial-in that will never come.
   * - **Running and in no row.** Destroyed — but only after the table has been
   *   read, and only for rows this deployment owns. That ordering is the whole
   *   difference between reaping leftovers and reaping another gateway's
   *   tenants.
   *
   * @returns {Promise<void>} resolves once the registry matches reality.
   */
  async adopt() {
    const [{ rows }, handles] = await Promise.all([
      this.db.query('SELECT * FROM sandboxes'),
      runtime.listOwned().catch(() => []),
    ])
    const live = new Set(handles)

    let kept = 0
    let lost = 0
    for (const row of rows) {
      if (live.has(row.handle)) {
        this.#remember(row)
        kept += 1
        continue
      }
      // The machine is gone; the row would otherwise point every request at a
      // sandbox that can never dial in.
      await this.db.query('DELETE FROM sandboxes WHERE username = $1', [row.username])
      lost += 1
    }

    const known = new Set(rows.map((row) => row.handle))
    const orphans = handles.filter((handle) => !known.has(handle))
    for (const handle of orphans) {
      await runtime.remove(handle).catch(() => {})
    }

    if (kept > 0) console.log(`gateway: adopted ${kept} running sandbox(es)`)
    if (lost > 0) console.log(`gateway: dropped ${lost} record(s) whose sandbox was gone`)
    if (orphans.length > 0) console.log(`gateway: reaped ${orphans.length} sandbox(es) no record claimed`)
  }
}
