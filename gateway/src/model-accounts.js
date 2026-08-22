/**
 * One model account per tenant, held on the model gateway rather than here.
 *
 * The deployment used to hand every sandbox the same model credential: one key,
 * one bill, and no way to say that a particular tenant had spent their share.
 * A per-tenant key answers all three at once — the model gateway meters it,
 * refuses it when the allowance is gone, and says which tenant spent what —
 * and it costs this deployment one row per account.
 *
 * What is stored here is the key and the id it belongs to. The allowance, the
 * prices, and the refusal are the model gateway's; this file never decides
 * whether a request may proceed, which is what keeps a metering plane out of
 * the request path.
 *
 * The provisioning is idempotent and lazy: the row is made the first time a
 * tenant needs a key, not when they register, because registration is on the
 * sign-in path and an upstream that is slow or down would fail a sign-in for a
 * key nobody has asked for yet. A tenant whose provisioning fails gets the
 * deployment's own credential — the arrangement that was there before this
 * file — rather than a sandbox with no model at all.
 *
 * @module model-accounts
 */

import { randomBytes, randomUUID } from 'node:crypto'
import process from 'node:process'

/**
 * How the model gateway counts money.
 *
 * Its quota is an integer of its own; the number of them in one US dollar is
 * published at `/api/status` as `quota_per_unit` and is 500,000 by default.
 * Stated here rather than read per call because it is a property of an
 * installation, not of a moment, and a deployment whose gateway disagrees sets
 * the variable.
 */
const QUOTA_PER_USD = Number(process.env.MODEL_GATEWAY_QUOTA_PER_USD ?? 500_000)

/** What a new tenant is given, in dollars. */
const ALLOWANCE_USD = Number(process.env.MODEL_GATEWAY_ALLOWANCE_USD ?? 1000)

/** How long any one call to the model gateway may take. */
const TIMEOUT_MS = 15_000

/**
 * Whether this deployment mints per-tenant model accounts at all.
 *
 * Both halves are required and neither has a default: an address with no token
 * is a deployment that has not been told which gateway to provision on, and a
 * token with no address is a credential with nowhere to go.
 *
 * @returns {boolean} whether provisioning is configured.
 */
export function mintsModelAccounts() {
  return (process.env.MODEL_GATEWAY_URL ?? '') !== '' && (process.env.MODEL_GATEWAY_ADMIN_TOKEN ?? '') !== ''
}

/**
 * One call to the model gateway's administration API.
 *
 * Errors carry the body rather than the status alone: this API answers 200
 * with `{success: false, message}` for most refusals, so a status check on its
 * own reports success for a failure and the message is the only thing that
 * says what went wrong.
 *
 * @param {string} path - the API path, from the root.
 * @param {object} [init] - method and body.
 * @returns {Promise<object>} the `data` the call answered with.
 * @throws {Error} when the call fails, or answers with `success: false`.
 */
async function call(path, init = {}) {
  const base = (process.env.MODEL_GATEWAY_URL ?? '').replace(/\/$/, '')
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${process.env.MODEL_GATEWAY_ADMIN_TOKEN ?? ''}`,
      ...init.body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...init.headers,
    },
    ...init.body === undefined ? {} : { body: JSON.stringify(init.body) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = undefined }
  if (!response.ok || body?.success === false) {
    throw new Error(`model gateway: ${init.method ?? 'GET'} ${path} — ${body?.message ?? `HTTP ${String(response.status)}`}`)
  }
  return body?.data ?? {}
}

/**
 * The name a tenant's model account carries on the gateway.
 *
 * Derived from the address rather than random, so an operator looking at the
 * gateway's user list can tell whose account is whose — that list is the place
 * a spend is investigated from. Sanitised because the field is a username on a
 * system with its own rules, and truncated because it has a length limit.
 *
 * @param {string} email - the tenant's address.
 * @returns {string} the username to register.
 */
function usernameFor(email) {
  const stem = email.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `hq-${stem}`
}

/**
 * Per-tenant model credentials, minted on the model gateway and kept here.
 */
export class ModelAccounts {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
    /** In-flight provisioning, so two sandbox creations do not mint two accounts. @type {Map<string, Promise<object>>} */
    this.inFlight = new Map()
    /** The one-time settings check, once per process. @type {Promise<void> | undefined} */
    this.defaults = undefined
  }

  /**
   * The key this tenant's sandbox should use, minting the account if it has none.
   *
   * @param {string} email - the tenant's address.
   * @returns {Promise<string | undefined>} the key, or undefined when this deployment mints none.
   */
  async keyFor(email) {
    if (!mintsModelAccounts()) return undefined
    const { rows } = await this.pool.query('SELECT api_key FROM model_accounts WHERE email = $1', [email])
    if (rows.length > 0) return rows[0].api_key
    // One promise per address, shared: a tenant whose first two sandboxes are
    // created at once would otherwise be registered twice, and the second
    // registration fails on the gateway's own unique name — leaving one of the
    // two creations with no key for no reason.
    const pending = this.inFlight.get(email) ?? this.provision(email).finally(() => { this.inFlight.delete(email) })
    this.inFlight.set(email, pending)
    return (await pending).apiKey
  }

  /**
   * Register this tenant on the model gateway, fund them, and mint their key.
   *
   * Four calls, in the only order that works: the account has to exist before
   * it can be funded, and it has to be signed in as before it can be given a
   * key — the gateway's key API mints for the caller, so an administrator
   * cannot mint one on somebody's behalf. The password is generated, used
   * once, and kept: it is the only way back into that account if an operator
   * ever needs to look at it from the inside.
   *
   * @param {string} email - the tenant's address.
   * @returns {Promise<{apiKey: string, gatewayUserId: number}>} what was minted.
   */
  async provision(email) {
    const username = usernameFor(email)
    const password = randomBytes(18).toString('base64url')

    // The allowance is a property of registering, not something done to an
    // account afterwards. `PUT /api/user/` looks like it would carry it and
    // does not: the gateway's own update writes four columns — name, display
    // name, group, remark — and drops everything else in the body without
    // saying so, which is a call that answers `success: true` and changes
    // nothing. What does work is the registration default, so it is set once
    // and every account minted here arrives funded.
    await this.ensureDefaults()

    await call('/api/user/', { method: 'POST', body: { username, password, display_name: email } })

    // Found by search rather than returned by the creation, which answers with
    // no body: the gateway's own list is the only place the id exists.
    const found = await call(`/api/user/search?keyword=${encodeURIComponent(username)}&p=0`)
    const user = (found.items ?? found ?? []).find((row) => row.username === username)
    if (user === undefined) throw new Error(`model gateway: registered ${username} and could not find it again`)

    const apiKey = await this.mintKey(username, password)
    const { rows } = await this.pool.query(
      `INSERT INTO model_accounts (email, gateway_user_id, gateway_username, gateway_password, api_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET api_key = EXCLUDED.api_key
       RETURNING api_key, gateway_user_id`,
      [email, user.id, username, password, apiKey],
    )
    return { apiKey: rows[0].api_key, gatewayUserId: rows[0].gateway_user_id }
  }

  /**
   * Put the deployment's two numbers on the model gateway, if nobody has.
   *
   * The allowance every new account is registered with, and what this model
   * costs. Both are the gateway's own settings rather than ours, and both are
   * written here only when they are still at their factory value — an operator
   * who has priced the model in the gateway's own console has made a decision,
   * and a deployment that reasserted its defaults on every restart would undo
   * it silently.
   *
   * Once per process: these are installation-wide, and re-reading the whole
   * option table for every tenant would be a page of JSON per registration.
   *
   * @returns {Promise<void>} when the two are in place.
   */
  async ensureDefaults() {
    if (this.defaults !== undefined) return this.defaults
    this.defaults = (async () => {
      const options = await call('/api/option/')
      /**
       * One option's current value.
       * @param {string} key - the option.
       * @returns {string} its value, or the empty string.
       */
      const at = (key) => String((options.items ?? options ?? []).find((row) => row.key === key)?.value ?? '')

      if (at('QuotaForNewUser') === '0' || at('QuotaForNewUser') === '') {
        const quota = Math.round(ALLOWANCE_USD * QUOTA_PER_USD)
        await call('/api/option/', { method: 'PUT', body: { key: 'QuotaForNewUser', value: String(quota) } })
        console.log(`gateway: model accounts register with $${String(ALLOWANCE_USD)} (${String(quota)} quota)`)
      }

      // The price, stated per million tokens here and converted to the ratio
      // the gateway thinks in: its unit is $0.002 per thousand tokens, so a
      // ratio of 1 is $2 per million. The completion ratio multiplies the
      // input price rather than standing on its own.
      const model = process.env.MODEL_ID ?? ''
      if (model !== '') {
        const ratios = JSON.parse(at('ModelRatio') || '{}')
        const completions = JSON.parse(at('CompletionRatio') || '{}')
        if (ratios[model] === undefined) {
          ratios[model] = Number(process.env.MODEL_PRICE_IN_PER_M ?? 0.1) / 2
          await call('/api/option/', { method: 'PUT', body: { key: 'ModelRatio', value: JSON.stringify(ratios) } })
        }
        if (completions[model] === undefined) {
          const input = Number(process.env.MODEL_PRICE_IN_PER_M ?? 0.1)
          completions[model] = input === 0 ? 1 : Number(process.env.MODEL_PRICE_OUT_PER_M ?? 0.3) / input
          await call('/api/option/', { method: 'PUT', body: { key: 'CompletionRatio', value: JSON.stringify(completions) } })
        }
      }
    })()
    return this.defaults
  }

  /**
   * Sign in as one tenant's model account and mint a key inside it.
   *
   * The session is a cookie the gateway sets on the sign-in, carried by hand
   * into the two calls that follow — `fetch` keeps no jar, and a jar shared
   * across tenants is exactly the bug worth not having.
   *
   * @param {string} username - the account on the gateway.
   * @param {string} password - what it was registered with.
   * @returns {Promise<string>} the key.
   */
  async mintKey(username, password) {
    const base = (process.env.MODEL_GATEWAY_URL ?? '').replace(/\/$/, '')
    const login = await fetch(`${base}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await login.json().catch(() => undefined)
    if (!login.ok || body?.success === false) {
      throw new Error(`model gateway: signing in as ${username} — ${body?.message ?? `HTTP ${String(login.status)}`}`)
    }
    // The access token the sign-in answers with, not the cookie it also sets.
    // Both come back and only one is honoured: the cookie alone is refused
    // with `AUTH_UNAUTHORIZED, invalid access token`, which reads like a
    // missing credential rather than the wrong one and cost an hour.
    const access = body?.data?.access_token
    const id = body?.data?.id
    if (typeof access !== 'string' || access === '') {
      throw new Error(`model gateway: signing in as ${username} returned no access token`)
    }
    /**
     * One call inside that session.
     * @param {string} path - the API path.
     * @param {object} [init] - method and body.
     * @returns {Promise<object>} the `data` the call answered with.
     */
    const asUser = async (path, init = {}) => {
      const response = await fetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${access}`,
          ...id === undefined ? {} : { 'New-Api-User': String(id) },
          ...init.body === undefined ? {} : { 'Content-Type': 'application/json' },
        },
        ...init.body === undefined ? {} : { body: JSON.stringify(init.body) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { parsed = undefined }
      if (!response.ok || parsed?.success === false) {
        throw new Error(`model gateway: ${init.method ?? 'GET'} ${path} as ${username} — ${parsed?.message ?? `HTTP ${String(response.status)}`}`)
      }
      return parsed?.data ?? {}
    }

    // Unlimited on the key, bounded on the account: two ceilings for one
    // allowance is two places to raise it, and the account's is the one the
    // gateway enforces and reports against.
    await asUser('/api/token/', {
      method: 'POST',
      body: { name: `hamsterhq-${randomUUID().slice(0, 8)}`, remain_quota: 0, expired_time: -1, unlimited_quota: true, model_limits_enabled: false },
    })
    const tokens = await asUser('/api/token/?p=0&size=10')
    const mine = (tokens.items ?? tokens ?? [])[0]
    if (mine?.id === undefined) throw new Error(`model gateway: minted a key for ${username} and could not find it again`)
    const key = await asUser(`/api/token/${String(mine.id)}/key`, { method: 'POST' })
    const value = typeof key === 'string' ? key : key.key
    if (typeof value !== 'string' || value === '') throw new Error(`model gateway: the key minted for ${username} came back empty`)
    // `sk-` is the prefix the gateway's OpenAI surface expects; the key it
    // hands back does not carry it, and both forms are accepted — the prefix
    // is added so that what is stored is what a person would paste.
    return value.startsWith('sk-') ? value : `sk-${value}`
  }
}
