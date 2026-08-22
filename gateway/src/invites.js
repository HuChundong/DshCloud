/**
 * Invite codes: the gate on who may register.
 *
 * Without one, an address that can receive mail is enough, and a deployment on a
 * reachable address accumulates accounts until an administrator prunes them. An
 * invite makes registration something the deployment grants rather than
 * something a visitor takes.
 *
 * Only registration is gated. A returning account signs in with nothing but its
 * code, because the invite bought the account, not each session.
 *
 * Whether the gate is up at all is not decided here: it is a switch in the
 * administrator's console, kept with the rest of the deployment's own state in
 * `settings.js`, so that closing registration is something an operator does to
 * a running deployment rather than to a compose file. This module is what a
 * code is, not who needs one.
 *
 * An invite is redeemed rather than deleted, so an operator can see which one
 * admitted whom. Redemption is the same statement as the check — a code claimed
 * twice by two simultaneous sign-ins would otherwise admit two people on one
 * invite.
 */

import { randomInt } from 'node:crypto'

/**
 * The alphabet invite codes are drawn from.
 *
 * No `0`/`O` or `1`/`I`/`l`: these are read off a screen and typed into another
 * one, often from a chat message, and a code that cannot be transcribed is a
 * support request.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** How many characters a code carries. 31^10 is far past guessing. */
const CODE_LENGTH = 10

/** The most codes one generation request will make. */
const MAX_BATCH = 200

/**
 * Format one code for reading: `XXXXX-XXXXX`.
 * @param {string} raw - the undelimited code.
 * @returns {string} the code as it is shown and stored.
 */
function group(raw) {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

/**
 * Reduce a code to the form it is stored in, so that spacing and case as typed
 * do not decide whether it works.
 * @param {string} code - the code as typed.
 * @returns {string} the normalized code.
 */
export function normalizeInvite(code) {
  const bare = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return bare.length === CODE_LENGTH ? group(bare) : bare
}

export class Invites {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
  }

  /**
   * Mint new invite codes.
   * @param {number} count - how many to make.
   * @param {string} createdBy - the administrator asking, recorded on each.
   * @returns {Promise<string[]>} the new codes.
   */
  async mint(count, createdBy) {
    const wanted = Math.min(Math.max(Math.trunc(count), 1), MAX_BATCH)
    const codes = Array.from({ length: wanted }, () => group(
      Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join(''),
    ))
    // `ON CONFLICT DO NOTHING` rather than a retry: a collision at this size is
    // vanishingly unlikely, and the caller is told how many were actually made.
    const { rows } = await this.pool.query(
      `INSERT INTO invites (code, created_by) SELECT unnest($1::text[]), $2
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [codes, createdBy],
    )
    return rows.map((row) => row.code)
  }

  /**
   * Spend one invite on an address.
   *
   * One statement, so a code cannot be claimed twice: the `WHERE` refuses a row
   * that is already redeemed, and two simultaneous attempts leave exactly one
   * winner.
   *
   * @param {string} code - the normalized code.
   * @param {string} email - the address redeeming it.
   * @returns {Promise<boolean>} whether the code was valid and is now spent.
   */
  async redeem(code, email) {
    const { rowCount } = await this.pool.query(
      `UPDATE invites SET redeemed_at = now(), redeemed_by = $2
       WHERE code = $1 AND redeemed_at IS NULL`,
      [code, email],
    )
    return rowCount > 0
  }

  /**
   * Whether a code exists and is unspent, without spending it.
   *
   * For the first step of the form, where the address has not been proved yet:
   * an invite that is already wrong can be said so immediately rather than
   * after a round trip through someone's mail. Invite validity is not personal
   * data, so answering it early reveals nothing about who is registered.
   *
   * @param {string} code - the normalized code.
   * @returns {Promise<boolean>} whether it would be accepted right now.
   */
  async usable(code) {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM invites WHERE code = $1 AND redeemed_at IS NULL',
      [code],
    )
    return rowCount > 0
  }

  /**
   * Every invite, unredeemed first and newest first within each group.
   * @returns {Promise<Array<{code: string, createdAt: number, redeemedAt: number | undefined, redeemedBy: string | undefined}>>} the invites.
   */
  async list({ limit, offset }) {
    // Paged in SQL. Minting is a button that makes as many as it is asked for,
    // so this is the table most likely to be long, and reading all of it to
    // show twenty is how a console gets slower the more it is used.
    const { rows } = await this.pool.query(
      `SELECT *, count(*) OVER () AS total
         FROM invites
        ORDER BY redeemed_at NULLS FIRST, created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    const total = rows.length === 0
      ? Number((await this.pool.query('SELECT count(*) AS total FROM invites')).rows[0].total)
      : Number(rows[0].total)
    return {
      total,
      rows: rows.map((row) => ({
        code: row.code,
        createdAt: row.created_at.getTime(),
        redeemedAt: row.redeemed_at === null ? undefined : row.redeemed_at.getTime(),
        redeemedBy: row.redeemed_by ?? undefined,
      })),
    }
  }

  /**
   * Delete an invite, spent or not.
   *
   * Deleting a redeemed one revokes nothing — the account it admitted already
   * exists and is unaffected — it only erases the record of how that account
   * came to be. The console confirms before doing it for that reason; this is
   * the operator's call to make, not this module's to refuse.
   *
   * @param {string} code - the normalized code.
   * @returns {Promise<boolean>} whether an invite was deleted.
   */
  async discard(code) {
    const { rowCount } = await this.pool.query('DELETE FROM invites WHERE code = $1', [code])
    return rowCount > 0
  }
}
