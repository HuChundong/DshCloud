/**
 * Deployment-wide configuration an administrator can change without a redeploy.
 *
 * Two things are stored, and they are the two that change while a deployment is
 * running: the model credential, and who is let in. Both were environment-only,
 * which meant rotating a leaked key or closing the door took an edit to a file
 * on the host followed by a restart — during which nobody could sign in — and
 * could only be done by whoever had shell access rather than by whoever
 * administers the deployment.
 *
 * The environment remains the fallback for both, so a deployment that has never
 * touched the console behaves exactly as it did before, and a database with no
 * row is a working deployment rather than a broken one.
 *
 * Every value is read at the moment it is used rather than cached at boot: a
 * sign-in reads the gate as it happens, and a sandbox reads the credential as it
 * is created. That is what makes the console's switches take effect on the next
 * request rather than on the next restart — the whole point of their being here
 * rather than in a compose file.
 */

import process from 'node:process'

/** The row the model credential lives in. */
const MODEL_KEY = 'model-credential'

/** The row the gate lives in: who may register, and how many may be running. */
const ACCESS_KEY = 'access'

/**
 * The gate as the environment states it, for a deployment whose console has
 * never been used.
 *
 * `REGISTRATION` is named `open` explicitly rather than inferred from whether
 * any invites exist: a deployment that has issued none would otherwise be wide
 * open, which is the opposite of what having none suggests.
 *
 * `SANDBOX_LIMIT` counts machines, not accounts, and 0 means no ceiling. It is
 * the number a host can actually carry — every live sandbox is memory and a
 * volume on it — so the deployment refuses the sign-in that would exceed it
 * rather than discovering the ceiling as an out-of-memory kill.
 */
function environmentAccess() {
  const limit = Number.parseInt(process.env.SANDBOX_LIMIT ?? '', 10)
  return {
    inviteRequired: (process.env.REGISTRATION ?? 'invite') !== 'open',
    sandboxLimit: Number.isInteger(limit) && limit > 0 ? limit : 0,
  }
}

export class Settings {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
  }

  /**
   * The credential a sandbox should be started with.
   *
   * @returns {Promise<{baseUrl: string, apiKey: string, source: 'console' | 'environment', updatedAt: number | undefined, updatedBy: string | undefined}>} the endpoint, the key, and where they came from.
   */
  async modelCredential() {
    const { rows } = await this.pool.query('SELECT * FROM settings WHERE key = $1', [MODEL_KEY])
    if (rows.length === 0) {
      return {
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? '',
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        source: 'environment',
        updatedAt: undefined,
        updatedBy: undefined,
      }
    }
    return {
      baseUrl: rows[0].value.baseUrl ?? '',
      apiKey: rows[0].value.apiKey ?? '',
      source: 'console',
      updatedAt: rows[0].updated_at.getTime(),
      updatedBy: rows[0].updated_by ?? undefined,
    }
  }

  /**
   * Replace the credential.
   *
   * @param {string} baseUrl - the endpoint the harness calls.
   * @param {string} apiKey - the credential to present there.
   * @param {string} updatedBy - the administrator making the change.
   * @returns {Promise<void>} resolves once stored.
   */
  async setModelCredential(baseUrl, apiKey, updatedBy) {
    await this.pool.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [MODEL_KEY, JSON.stringify({ baseUrl, apiKey }), updatedBy],
    )
  }

  /**
   * Discard the stored credential, falling back to the environment.
   * @returns {Promise<void>} resolves once the row is gone.
   */
  async clearModelCredential() {
    await this.pool.query('DELETE FROM settings WHERE key = $1', [MODEL_KEY])
  }

  /**
   * The gate in force: who may register, and how many sandboxes may run.
   *
   * Read on every sign-in rather than held anywhere, because that is what the
   * console's switches promise — an operator who closes registration while a
   * link is circulating in a group chat has closed it for the next person to
   * follow it, not for the next restart.
   *
   * @returns {Promise<{inviteRequired: boolean, sandboxLimit: number, source: 'console' | 'environment', updatedAt: number | undefined, updatedBy: string | undefined}>} the gate, and where it came from.
   */
  async access() {
    const { rows } = await this.pool.query('SELECT * FROM settings WHERE key = $1', [ACCESS_KEY])
    if (rows.length === 0) {
      return { ...environmentAccess(), source: 'environment', updatedAt: undefined, updatedBy: undefined }
    }
    const fallback = environmentAccess()
    return {
      // Each field falls back on its own: a row written by an older release
      // carries only what that release stored, and a missing field has to mean
      // "as the environment says" rather than "off".
      inviteRequired: rows[0].value.inviteRequired ?? fallback.inviteRequired,
      sandboxLimit: Number.isInteger(rows[0].value.sandboxLimit) && rows[0].value.sandboxLimit > 0
        ? rows[0].value.sandboxLimit
        : 0,
      source: 'console',
      updatedAt: rows[0].updated_at.getTime(),
      updatedBy: rows[0].updated_by ?? undefined,
    }
  }

  /**
   * Replace the gate.
   *
   * @param {boolean} inviteRequired - whether a new address needs an invite code.
   * @param {number} sandboxLimit - the most sandboxes that may be running at once; 0 for no ceiling.
   * @param {string} updatedBy - the administrator making the change.
   * @returns {Promise<void>} resolves once stored.
   */
  async setAccess(inviteRequired, sandboxLimit, updatedBy) {
    await this.pool.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [ACCESS_KEY, JSON.stringify({ inviteRequired, sandboxLimit }), updatedBy],
    )
  }
}

/**
 * How a credential is shown to an administrator who already set it.
 *
 * Never the key itself. The console is a page in a browser, and a key rendered
 * into it is a key in a screenshot, a scroll-back, and whatever proxies the
 * response — for a value whose owner already has it and whose reader would only
 * be checking which one is in force. The last four characters answer that.
 *
 * @param {string} apiKey - the stored credential.
 * @returns {string} a description safe to render.
 */
export function describeKey(apiKey) {
  // Markup, because it is page copy: the words are translated at read time and
  // the last four characters of the key are not words at all.
  if (apiKey === '') return '<span data-t="key.unset">未设置</span>'
  return `<span data-t="key.set">已设置</span> · <span data-t="key.tail">末四位</span> ${apiKey.slice(-4)}`
}
