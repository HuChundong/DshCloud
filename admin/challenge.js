/**
 * The half-open door between the two steps of signing in.
 *
 * A password is checked first and a code second, the way every 2FA system
 * people already know works. Between the two the service has to remember that
 * somebody got the password right, and this is that memory: a signed token,
 * short-lived, that says nothing except "this caller cleared the first step".
 *
 * ## Why this is not just a flag on the session
 *
 * It is signed with the session key but carries a different audience, so a
 * challenge can never be presented as a session. The two are separate cookies
 * for the same reason — a bug that sent the wrong one somewhere would fail
 * closed rather than admit.
 *
 * ## Why it counts attempts
 *
 * Two-step sign-in introduces a risk one-step did not have. In one step, every
 * guess at the code also had to carry the password. In two, whoever cleared the
 * first step can sit on the second and try codes — and a code is six digits,
 * with three of them valid at any moment once drift is allowed.
 *
 * So a challenge is spent on success and burned after a few failures, and the
 * caller is sent back to the password. The per-address limiter in `auth.js`
 * still runs underneath this; the count here is what stops one password from
 * buying an unlimited number of guesses.
 *
 * @module challenge
 */

import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { SignJWT, jwtVerify } from 'jose'

/** The cookie that carries a half-finished sign-in. */
export const COOKIE = 'hq_admin_step'

/**
 * How long the second step stays open.
 *
 * Long enough to unlock a phone and read a code, short enough that a challenge
 * left on a shared machine is not a standing invitation.
 */
const TTL_SECONDS = 5 * 60

/**
 * How many wrong codes one challenge is worth.
 *
 * Five, because a person mistyping six digits twice is ordinary and a person
 * mistyping them five times is not — and because 5 in 1_000_000 is not a
 * search. Past this the password has to be typed again.
 */
const ATTEMPTS = 5

const secret = process.env.ADMIN_SESSION_SECRET ?? ''
const key = secret === '' ? undefined : new TextEncoder().encode(secret)

/**
 * Wrong codes so far, by challenge.
 *
 * In memory, and that is a deliberate limit rather than an oversight: a
 * restart forgets them. A restart of this service also ends every session it
 * has issued a challenge to, and an attacker who can restart it has the
 * machine — at which point the console is not what is protecting anything.
 */
const misses = new Map()

/** Challenges that may not be presented again, until they would expire anyway. */
const burned = new Set()

/**
 * Open the second step for a caller who cleared the first.
 *
 * @returns {Promise<string>} the token to set as a cookie.
 */
export async function issue() {
  const id = randomUUID()
  return await new SignJWT({ step: 'totp' })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(id)
    .setIssuedAt()
    .setIssuer('hamsterhq-admin')
    // Not the session's audience. This is what makes a challenge unusable as
    // a session even though the same key signs both.
    .setAudience('hamsterhq-admin-challenge')
    .setExpirationTime(`${String(TTL_SECONDS)}s`)
    .sign(key)
}

/**
 * The open challenge this request carries, if it carries one.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<string|undefined>} its id, or nothing.
 */
export async function read(req) {
  if (key === undefined) return undefined
  const raw = (req.headers.cookie ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${COOKIE}=`))
  if (raw === undefined) return undefined
  try {
    const { payload } = await jwtVerify(raw.slice(COOKIE.length + 1), key, {
      issuer: 'hamsterhq-admin',
      audience: 'hamsterhq-admin-challenge',
    })
    const id = payload.jti
    if (typeof id !== 'string' || burned.has(id)) return undefined
    return id
  } catch {
    // Expired, forged, or a session presented as a challenge. Same answer.
    return undefined
  }
}

/**
 * Record a wrong code against a challenge.
 *
 * @param {string} id - the challenge.
 * @returns {boolean} whether it is still open afterwards.
 */
export function failed(id) {
  const seen = (misses.get(id) ?? 0) + 1
  if (seen >= ATTEMPTS) {
    spend(id)
    return false
  }
  misses.set(id, seen)
  return true
}

/**
 * Close a challenge for good — on success, or once it has been spent.
 *
 * @param {string} id - the challenge.
 */
export function spend(id) {
  misses.delete(id)
  burned.add(id)
  // Remembered only for as long as the token could still be presented. After
  // that the signature has expired and the set would be holding ids that
  // nothing can offer.
  setTimeout(() => burned.delete(id), TTL_SECONDS * 1000).unref?.()
}

/**
 * The cookie that opens and closes the second step.
 *
 * @param {string|undefined} token - the challenge, or nothing to close it.
 * @param {boolean} secure - whether the request arrived over TLS.
 * @returns {string} the `Set-Cookie` value.
 */
export function cookie(token, secure) {
  const attributes = `HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Path=/`
  return token === undefined
    ? `${COOKIE}=; ${attributes}; Max-Age=0`
    : `${COOKIE}=${token}; ${attributes}; Max-Age=${String(TTL_SECONDS)}`
}
