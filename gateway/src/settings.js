/**
 * Deployment-wide configuration an administrator can change without a redeploy.
 *
 * Only one thing is stored so far, and it is the one that changes: the model
 * credential. It was environment-only, which meant rotating a leaked key or
 * moving to another provider was an edit to a file on the host followed by a
 * restart — during which nobody could sign in — and could only be done by
 * whoever had shell access rather than by whoever administers the deployment.
 *
 * The environment remains the fallback, so a deployment that has never touched
 * the console behaves exactly as it did before, and a database with no row is a
 * working deployment rather than a broken one.
 *
 * Read at the moment a sandbox is created rather than cached at boot. A sandbox
 * outlives a change to this by up to its idle life, which is as immediate as it
 * can be without reaching into machines that are already running.
 */

import process from 'node:process'

/** The row the model credential lives in. */
const MODEL_KEY = 'model-credential'

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
  if (apiKey === '') return '未设置'
  return `已设置 · 末四位 ${apiKey.slice(-4)}`
}
