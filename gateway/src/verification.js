/**
 * The code challenge that stands in for a password.
 *
 * Whoever completes it has shown they can read mail at an address, which is the
 * whole of what this deployment knows about anybody. That makes this the
 * boundary a shell sits behind, so it is built to be attacked:
 *
 * - Codes are six digits, which is 10^6 guesses. Five attempts per code and one
 *   code per address per minute make guessing it remotely impossible while
 *   keeping the code short enough to read out of a mail client.
 * - A code is spent on its first correct use and destroyed after five wrong
 *   ones, so a captured code cannot be replayed and a partly-guessed one cannot
 *   be resumed.
 * - Comparison is constant-time. A code is a secret of exactly the length an
 *   attacker knows, which is the shape timing analysis is good at.
 * - Requesting a code says the same thing whether or not the address has an
 *   account, so this is not also a way to ask who has registered.
 */

import { randomInt, timingSafeEqual } from 'node:crypto'

/** How long a code stays valid. Long enough for slow mail, short enough to matter. */
export const CODE_TTL_SECONDS = 10 * 60

/** Wrong guesses a single code survives. */
const MAX_ATTEMPTS = 5

/** How long an address must wait between codes. */
const RESEND_INTERVAL_SECONDS = 60

export class Verification {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
  }

  /**
   * Start a challenge for an address, unless one was started too recently.
   *
   * @param {string} email - the normalized address.
   * @returns {Promise<{code: string} | {retryAfterSeconds: number}>} the code to mail, or how long the caller must wait.
   */
  async open(email) {
    // `randomInt`, not `Math.random`: this is a credential, and the difference
    // between the two is the difference between guessing and predicting.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    // The rate limit and the new challenge are one statement, so two requests
    // arriving together cannot both find no cooldown and both send. The `WHERE`
    // on the update is what refuses the second: it leaves the existing row
    // untouched and returns nothing.
    const { rows } = await this.pool.query(
      `INSERT INTO challenges (email, code, attempts, expires_at, cooldown_until)
       VALUES ($1, $2, 0, now() + make_interval(secs => $3), now() + make_interval(secs => $4))
       ON CONFLICT (email) DO UPDATE
         SET code = EXCLUDED.code,
             attempts = 0,
             expires_at = EXCLUDED.expires_at,
             cooldown_until = EXCLUDED.cooldown_until
         WHERE challenges.cooldown_until < now()
       RETURNING code`,
      [email, code, CODE_TTL_SECONDS, RESEND_INTERVAL_SECONDS],
    )
    if (rows.length > 0) return { code: rows[0].code }

    const { rows: waiting } = await this.pool.query(
      'SELECT ceil(extract(epoch FROM cooldown_until - now())) AS seconds FROM challenges WHERE email = $1',
      [email],
    )
    return { retryAfterSeconds: Math.max(1, Number(waiting[0]?.seconds ?? RESEND_INTERVAL_SECONDS)) }
  }

  /**
   * Answer a challenge.
   *
   * A correct answer is not spent here. Whether the sign-in proceeds depends on
   * things this does not know — whether an invite is needed and valid — and
   * spending the code before those are settled would make a rejected attempt
   * cost the code, forcing someone whose invite was wrong to wait for a new
   * one. The caller spends it with `consume` once nothing else can refuse.
   *
   * @param {string} email - the normalized address.
   * @param {string} attempt - the code as typed.
   * @returns {Promise<'ok' | 'wrong' | 'expired'>} whether the address is now proven, the code was wrong, or there is nothing to answer.
   */
  async answer(email, attempt) {
    const { rows } = await this.pool.query(
      'SELECT code, attempts FROM challenges WHERE email = $1 AND expires_at > now()',
      [email],
    )
    if (rows.length === 0) return 'expired'

    const expected = Buffer.from(rows[0].code)
    const given = Buffer.from(attempt)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      if (rows[0].attempts + 1 >= MAX_ATTEMPTS) {
        await this.pool.query('DELETE FROM challenges WHERE email = $1', [email])
        return 'expired'
      }
      // `expires_at` is left alone: a wrong guess must not extend the window it
      // is being guessed in.
      await this.pool.query('UPDATE challenges SET attempts = attempts + 1 WHERE email = $1', [email])
      return 'wrong'
    }

    return 'ok'
  }

  /**
   * Spend an answered challenge.
   *
   * The row carries the cooldown as well as the code, so deleting it also means
   * signing in does not leave the address unable to sign in again for another
   * minute.
   *
   * @param {string} email - the normalized address.
   * @returns {Promise<void>} resolves once the code can no longer be used.
   */
  async consume(email) {
    await this.pool.query('DELETE FROM challenges WHERE email = $1', [email])
  }
}
