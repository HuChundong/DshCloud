/**
 * Ending sessions, which is a fact about rows.
 *
 * Its own module, and the reason is the direction of the dependency. Minting a
 * token needs a key and a lifetime; ending one needs neither. The operator's
 * console must be able to end somebody's sessions and must deliberately not be
 * able to start one in their name — so it reaches for this rather than for
 * `tokens.js`, and does not read the signing configuration to do it.
 *
 * @module revoke
 */

/**
 * Revoke every refresh token for one address.
 *
 * An access token already issued is a signed statement with a short life and
 * is not ended by this — that is what makes the life short.
 *
 * @param {import('pg').Pool} pool - the connected database pool.
 * @param {string} email - whose sessions to end.
 * @returns {Promise<void>} resolves once they are gone.
 */
export async function revokeAllFor(pool, email) {
  await pool.query('DELETE FROM refresh_tokens WHERE email = $1', [email])
}
