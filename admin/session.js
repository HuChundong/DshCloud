/**
 * The operator's session, which belongs to this service and no other.
 *
 * Signed rather than stored, for the same reason the gateway's are: this
 * service should survive its own restart without turning every open console
 * into a sign-in page, and a session table is a table to keep.
 *
 * Its own secret, deliberately. Sharing the gateway's would mean a token
 * minted for a tenant and a token minted for an operator were signed by the
 * same key — which is the coupling this whole separation exists to remove,
 * and the kind that survives a refactor because nothing breaks when it is
 * there.
 *
 * Short-lived, with no refresh half. An operator signing in again after a few
 * hours is a small cost; a long-lived credential to a console that can rotate
 * the model key is not.
 *
 * @module session
 */

import process from 'node:process'

import { SignJWT, jwtVerify } from 'jose'

/** The cookie this service reads. Named apart from the gateway's on purpose. */
export const COOKIE = 'hq_admin'

/** How long an operator stays signed in. */
const TTL_SECONDS = 8 * 60 * 60

const secret = process.env.ADMIN_SESSION_SECRET ?? ''
const key = secret === '' ? undefined : new TextEncoder().encode(secret)

/** @returns {boolean} whether sessions can be issued at all. */
export function canIssue() {
  return key !== undefined && secret.length >= 16
}

/**
 * Mint a session for the operator.
 * @returns {Promise<string>} the token.
 */
export async function issue() {
  return await new SignJWT({ operator: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('hamsterhq-admin')
    .setAudience('hamsterhq-admin')
    .setExpirationTime(`${String(TTL_SECONDS)}s`)
    .sign(key)
}

/**
 * Whether this request carries a session this service issued.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<boolean>} whether to serve it.
 */
export async function signedIn(req) {
  if (key === undefined) return false
  const raw = (req.headers.cookie ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${COOKIE}=`))
  if (raw === undefined) return false
  try {
    await jwtVerify(raw.slice(COOKIE.length + 1), key, {
      issuer: 'hamsterhq-admin',
      audience: 'hamsterhq-admin',
    })
    return true
  } catch {
    // Expired, forged, or signed by something else. All the same answer.
    return false
  }
}

/**
 * The cookies that begin and end a session.
 *
 * @param {string|undefined} token - the session, or nothing to end it.
 * @param {boolean} secure - whether the request arrived over TLS.
 * @returns {string} the `Set-Cookie` value.
 */
export function cookie(token, secure) {
  const attributes = `HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/`
  return token === undefined
    ? `${COOKIE}=; ${attributes}; Max-Age=0`
    : `${COOKIE}=${token}; ${attributes}; Max-Age=${String(TTL_SECONDS)}`
}
