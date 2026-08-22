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

import { revokeAllFor } from './revoke.js'

/** How long an access token proves anything. Also the revocation delay. */
const ACCESS_TTL_SECONDS = 15 * 60

/** How long a browser may stay signed in without presenting a code again. */
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TTL_SECONDS ?? 30 * 24 * 60 * 60)

/**
 * How long a rotated token still answers with its replacement.
 *
 * Long enough to cover the burst a waking browser makes with one cookie, short
 * enough that a token replayed later is still refused. Seconds, not minutes:
 * the requests it exists for are made at once.
 */
const ROTATION_GRACE_SECONDS = Number(process.env.REFRESH_GRACE_SECONDS ?? 30)

/** Cookie carrying the access token. */
export const ACCESS_COOKIE = 'dsh_gw_access'

/** Cookie carrying the refresh token. */
export const REFRESH_COOKIE = 'dsh_gw_refresh'

/**
 * Issuer and audience claims, so a token minted for something else is refused.
 *
 * Renaming these invalidates every token already issued — which is the point of
 * having them, and why they are changed with the deployment's name rather than
 * left behind it. Everyone signs in again once.
 */
const ISSUER = 'hamsterhq-gateway'
const AUDIENCE = 'hamsterhq-web'

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
   * @returns {Promise<{email: string, refresh: string} | undefined>} the owning address and the token that replaces the one presented, or undefined when it is unknown, expired, or replayed after its grace.
   */
  async spendRefresh(token) {
    if (token === undefined) return undefined

    // Rotate in one statement. The `WHERE spent_at IS NULL` is what makes it
    // atomic: of several requests presenting the same token, exactly one
    // updates the row and learns it rotated it.
    //
    // The old row is kept rather than deleted, because a browser waking from
    // the background asks several times at once — session history, the preset
    // list, the event socket — all carrying the cookie it went to sleep with.
    // Deleting on first use answered one of them and told the rest their token
    // was unknown, which is a signed-in person being asked for a code again.
    const replacement = randomBytes(32).toString('hex')
    const { rows } = await this.pool.query(
      `UPDATE refresh_tokens
          SET spent_at = now(), replaced_by = $2
        WHERE token = $1 AND spent_at IS NULL AND expires_at > now()
      RETURNING email`,
      [token, replacement],
    )
    if (rows.length > 0) {
      await this.pool.query(
        `INSERT INTO refresh_tokens (token, email, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3))`,
        [replacement, rows[0].email, REFRESH_TTL_SECONDS],
      )
      return { email: rows[0].email, refresh: replacement }
    }

    // It did not rotate. Either another request just did — in which case this
    // one is the same browser a moment later and gets that same replacement —
    // or the token is being replayed long after its use, which is what a stolen
    // one looks like and is refused.
    const spent = await this.pool.query(
      `SELECT email, replaced_by
         FROM refresh_tokens
        WHERE token = $1
          AND replaced_by IS NOT NULL
          AND spent_at > now() - make_interval(secs => $2)`,
      [token, ROTATION_GRACE_SECONDS],
    )
    if (spent.rows.length === 0) return undefined
    return { email: spent.rows[0].email, refresh: spent.rows[0].replaced_by }
  }

  /**
   * Revoke every refresh token an account holds, signing out all its browsers.
   * @param {string} email - the normalized address.
   * @returns {Promise<void>} resolves once none of them can be spent.
   */
  async revokeAll(email) {
    await revokeAllFor(this.pool, email)
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
