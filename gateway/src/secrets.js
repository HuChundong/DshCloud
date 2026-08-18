/**
 * Environment a tenant asks for in their own sandbox.
 *
 * The agent inside a sandbox reaches things — a database, an internal API, a
 * paid service — and reaching them needs a credential this deployment has no
 * business knowing about. There was nowhere to put one: the model credential is
 * the deployment's and lives in `settings`, and everything else a sandbox got
 * was decided by the gateway. This is the tenant's own half of that.
 *
 * Two rules make it safe to hand a tenant a lever on their sandbox's
 * environment, and both are enforced here rather than in the page:
 *
 * - **A name a tenant chooses can never be one the gateway sets.** The sandbox
 *   is told its own id, its dial-in token, and where to dial; a tenant who
 *   could set `SANDBOX_TOKEN` or `GATEWAY_TUNNEL_URL` could point their
 *   sandbox's tunnel at something else, or claim another one. `RESERVED` below
 *   refuses those names, and `sandboxes.js` composes the environment so that
 *   even a name that slipped through would be overwritten rather than win.
 * - **A value goes in and never comes back.** The page shows the name and when
 *   it changed, which is what somebody checking their own configuration needs;
 *   rendering the value would put it in a screenshot, a scroll-back, and
 *   whatever proxies the response, for a value its owner already has.
 *
 * @module secrets
 */

/**
 * Names the gateway sets itself, which a tenant may not.
 *
 * The first three are the sandbox's identity and its way back to the gateway.
 * The rest describe the deployment's model, which is deliberately handed to
 * the sandbox rather than to the browser — letting a tenant replace the
 * endpoint, the credential, or the route that names both would turn their
 * agent's traffic somewhere the deployment did not choose.
 */
const RESERVED = new Set([
  'SANDBOX_ID',
  'SANDBOX_TOKEN',
  'GATEWAY_TUNNEL_URL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'MODEL_PROVIDER',
])

/** How many a tenant may keep, so one account cannot fill the table. */
const MAX_SECRETS = 32

/** How long a value may be. Generous for a token, short of a file. */
const MAX_VALUE_BYTES = 4096

/**
 * What a shell will accept as a variable name, and nothing else.
 *
 * Deliberately stricter than the environment's own rules: `env` will carry a
 * name with a dot or a dash in it, but nothing can read one back with `$NAME`,
 * so accepting it would store something the agent could never use.
 */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/**
 * One secret, as the page is allowed to see it.
 * @typedef {object} SecretSummary
 * @property {string} name - the variable name.
 * @property {number} updatedAt - epoch milliseconds of the last write.
 */

/**
 * Why a name was refused, or undefined when it is fine.
 *
 * Returns the reason rather than a boolean because each one is a different
 * sentence to the person typing it, and the caller is a form.
 *
 * @param {string} name - the name as submitted.
 * @returns {string | undefined} the reason, or undefined when acceptable.
 */
export function nameProblem(name) {
  if (!NAME_PATTERN.test(name)) {
    return '名称只能由字母、数字和下划线组成，且不能以数字开头。'
  }
  if (RESERVED.has(name)) {
    return `${name} 由部署本身设置，不能覆盖。`
  }
  return undefined
}

export class Secrets {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
  }

  /**
   * What a tenant has set, without the values.
   *
   * @param {string} email - the normalized address.
   * @returns {Promise<SecretSummary[]>} the names, alphabetically.
   */
  async list(email) {
    const { rows } = await this.pool.query(
      'SELECT name, updated_at FROM sandbox_secrets WHERE email = $1 ORDER BY name',
      [email],
    )
    return rows.map((row) => ({ name: row.name, updatedAt: row.updated_at.getTime() }))
  }

  /**
   * The environment to start this tenant's sandbox with.
   *
   * The only caller is sandbox creation, which is the one place a value is
   * meant to leave this table.
   *
   * @param {string} email - the normalized address.
   * @returns {Promise<Record<string, string>>} name to value.
   */
  async environment(email) {
    const { rows } = await this.pool.query(
      'SELECT name, value FROM sandbox_secrets WHERE email = $1',
      [email],
    )
    return Object.fromEntries(rows.map((row) => [row.name, row.value]))
  }

  /**
   * Set one, or replace it.
   *
   * The ceiling is checked in the same statement that inserts, because two
   * requests arriving together would each read a count below the limit and both
   * write — and the cheapest correct version of "no more than N" is to let the
   * database decide rather than to read and then write.
   *
   * @param {string} email - the normalized address.
   * @param {string} name - the variable name, already validated by `nameProblem`.
   * @param {string} value - the value to store.
   * @returns {Promise<'ok' | 'full' | 'too-long'>} what happened.
   */
  async set(email, name, value) {
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) return 'too-long'
    const { rowCount } = await this.pool.query(
      `INSERT INTO sandbox_secrets (email, name, value)
       SELECT $1, $2, $3
        WHERE (SELECT count(*) FROM sandbox_secrets WHERE email = $1) < $4
           OR EXISTS (SELECT 1 FROM sandbox_secrets WHERE email = $1 AND name = $2)
       ON CONFLICT (email, name) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
      [email, name, value, MAX_SECRETS],
    )
    return rowCount === 0 ? 'full' : 'ok'
  }

  /**
   * Remove one.
   * @param {string} email - the normalized address.
   * @param {string} name - the variable name.
   * @returns {Promise<void>} resolves once it is gone or was never there.
   */
  async remove(email, name) {
    await this.pool.query('DELETE FROM sandbox_secrets WHERE email = $1 AND name = $2', [email, name])
  }
}

export { MAX_SECRETS, MAX_VALUE_BYTES }
