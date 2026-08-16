/**
 * The session mechanism: a short access token that proves who is calling, and a
 * long refresh token that can be taken away.
 *
 * The split is what makes both halves possible at once. An access token is a
 * signed JWT the gateway verifies without asking anything — no round trip on
 * the path of every `/api` call — but for exactly that reason nothing can
 * revoke it once issued, so it is given fifteen minutes. A refresh token is an
 * opaque random string with a row of its own, so signing out, suspending an
 * account, or deleting it takes effect the moment the access token expires.
 *
 * Fifteen minutes is therefore the real answer to "how long after I revoke can
 * they still reach a shell". A single long-lived JWT would have made that
 * answer "until it expires", which is the wrong property for a deployment whose
 * sessions reach a shell.
 *
 * Refresh tokens rotate on use: presenting one issues a replacement and retires
 * it. A stolen token is then usable only until its owner's browser next
 * refreshes, and the collision when both are used is visible rather than silent.
 */

import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { SignJWT, jwtVerify } from 'jose'

/** How long an access token proves anything. Also the revocation delay. */
const ACCESS_TTL_SECONDS = 15 * 60

/** How long a browser may stay signed in without presenting a code again. */
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TTL_SECONDS ?? 30 * 24 * 60 * 60)

/** Cookie carrying the access token. */
export const ACCESS_COOKIE = 'dsh_gw_access'

/** Cookie carrying the refresh token. */
export const REFRESH_COOKIE = 'dsh_gw_refresh'

/** Issuer and audience claims, so a token minted for something else is refused. */
const ISSUER = 'dsh-gateway'
const AUDIENCE = 'dsh-web'

export class Tokens {
  /**
   * @param {string} secret - the signing key; changing it invalidates every access token in circulation.
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(secret, pool) {
    this.key = new TextEncoder().encode(secret)
    this.pool = pool
  }

  /**
   * Mint an access token for an account.
   * @param {import('./accounts.js').Account} account - the signed-in account.
   * @returns {Promise<string>} the signed JWT.
   */
  async issueAccess(account) {
    return await new SignJWT({ email: account.email, admin: account.admin })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(account.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.key)
  }

  /**
   * Read an access token.
   *
   * `jose` checks the algorithm against the key rather than against the token's
   * own header, so a token re-signed as `none` or with a public key is refused
   * rather than believed.
   *
   * @param {string | undefined} token - the presented token, if any.
   * @returns {Promise<{id: string, email: string, admin: boolean} | undefined>} the caller, or undefined when the token is absent, forged, or expired.
   */
  async readAccess(token) {
    if (token === undefined) return undefined
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE })
      return { id: String(payload.sub), email: String(payload.email), admin: payload.admin === true }
    } catch {
      // Every failure means the same thing to a caller — this token proves
      // nothing — and distinguishing expired from forged in a response would
      // tell an attacker which of their guesses was closer.
      return undefined
    }
  }

  /**
   * Issue a refresh token for an account.
   * @param {import('./accounts.js').Account} account - the signed-in account.
   * @returns {Promise<string>} the opaque token.
   */
  async issueRefresh(account) {
    const token = randomBytes(32).toString('hex')
    await this.pool.query(
      `INSERT INTO refresh_tokens (token, email, expires_at)
       VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [token, account.email, REFRESH_TTL_SECONDS],
    )
    return token
  }

  /**
   * Spend a refresh token, returning whose it was.
   *
   * The token is retired here rather than by the caller: it has been seen on the
   * wire by the time this returns, so leaving it usable would widen the window
   * in which a copy still works.
   *
   * @param {string | undefined} token - the presented token, if any.
   * @returns {Promise<string | undefined>} the owning address, or undefined when the token is unknown or spent.
   */
  async spendRefresh(token) {
    if (token === undefined) return undefined
    // Deleting and reading in one statement is what makes spending atomic: two
    // requests presenting the same token cannot both be told it was theirs.
    // Expiry is a condition of the delete rather than a sweep, so a token past
    // its date is already unspendable.
    const { rows } = await this.pool.query(
      'DELETE FROM refresh_tokens WHERE token = $1 AND expires_at > now() RETURNING email',
      [token],
    )
    return rows.length === 0 ? undefined : rows[0].email
  }

  /**
   * Revoke every refresh token an account holds, signing out all its browsers.
   * @param {string} email - the normalized address.
   * @returns {Promise<void>} resolves once none of them can be spent.
   */
  async revokeAll(email) {
    await this.pool.query('DELETE FROM refresh_tokens WHERE email = $1', [email])
  }
}

/**
 * Cookie attributes shared by every token cookie.
 *
 * `HttpOnly` keeps both tokens away from the agent-rendered page, which renders
 * model output into the same document. `SameSite=Lax` blocks the cross-site
 * POST that dsh's own fence would have caught, had the tunnel not deliberately
 * made every forwarded call look local.
 *
 * `Secure` follows the scheme the browser actually used, reported by nginx as
 * `X-Forwarded-Proto`. Setting it unconditionally would be stricter and wrong:
 * a browser will not send a `Secure` cookie back over the plain port, so the
 * deployment's HTTP front door — and every check that runs against it — would
 * sign in and then appear signed out.
 *
 * @param {boolean} secure - whether the browser reached the deployment over TLS.
 * @returns {string} the attribute suffix.
 */
function attributes(secure) {
  return `HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/`
}

/**
 * The `Set-Cookie` values that establish a signed-in browser.
 * @param {string} access - the access token.
 * @param {string} refresh - the refresh token.
 * @param {boolean} secure - whether the browser reached the deployment over TLS.
 * @returns {string[]} the cookie headers to send.
 */
export function signedInCookies(access, refresh, secure) {
  return [
    `${ACCESS_COOKIE}=${access}; ${attributes(secure)}; Max-Age=${ACCESS_TTL_SECONDS}`,
    `${REFRESH_COOKIE}=${refresh}; ${attributes(secure)}; Max-Age=${REFRESH_TTL_SECONDS}`,
  ]
}

/**
 * The `Set-Cookie` values that clear a signed-in browser.
 * @param {boolean} secure - whether the browser reached the deployment over TLS.
 * @returns {string[]} the cookie headers to send.
 */
export function signedOutCookies(secure) {
  return [
    `${ACCESS_COOKIE}=; ${attributes(secure)}; Max-Age=0`,
    `${REFRESH_COOKIE}=; ${attributes(secure)}; Max-Age=0`,
  ]
}
