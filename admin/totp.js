/**
 * The second factor, because the first one is on the public internet.
 *
 * A password alone in front of a console that can rotate every tenant's model
 * credential is a single secret that never changes, guessable forever by
 * anyone who finds the address — and the address announces itself: a
 * certificate for a name is published to certificate transparency logs the
 * moment it is issued, which is a matter of minutes and is not reversible.
 *
 * RFC 6238, implemented here rather than depended on. It is one HMAC and a
 * truncation; a dependency for it is more supply chain than arithmetic.
 *
 * ## Why the window is small
 *
 * One step either side of now, and no more. The usual reason to widen it is a
 * clock that drifts, and the answer to a drifting clock is to fix the clock: a
 * wide window is a longer period in which a code observed over somebody's
 * shoulder, or replayed from a phished page, is still good.
 *
 * ## Codes are spent
 *
 * A code that has been accepted is not accepted again, for as long as it could
 * still be valid. Without that, watching one succeed is enough to reuse it
 * within the same half-minute — which is exactly the window a phishing page
 * operates in.
 *
 * @module totp
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import process from 'node:process'

/** The shared secret, base32 as every authenticator app prints it. */
const SECRET = (process.env.ADMIN_TOTP_SECRET ?? '').replaceAll(/[\s=]/g, '').toUpperCase()

/** RFC 6238's defaults, which every authenticator app assumes. */
const STEP_SECONDS = 30
const DIGITS = 6

/** How far either side of now a code is accepted. */
const DRIFT_STEPS = 1

/** Codes already spent, by the step they belonged to. */
const spent = new Set()

/**
 * Whether this deployment asks for a second factor at all.
 * @returns {boolean} whether a secret is configured.
 */
export function required() {
  return SECRET.length >= 16
}

/**
 * Decode base32, which is how these secrets are always written.
 * @param {string} value - the secret.
 * @returns {Buffer} its bytes.
 */
function base32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let carry = 0
  const bytes = []
  for (const character of value) {
    const index = alphabet.indexOf(character)
    if (index < 0) continue
    carry = (carry << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((carry >> bits) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

/**
 * The code for one time step.
 * @param {Buffer} key - the secret's bytes.
 * @param {number} step - which step.
 * @returns {string} the code, zero-padded.
 */
function codeFor(key, step) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff
  return String(truncated % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Whether this code is the one on the operator's phone right now.
 *
 * @param {string} offered - what was typed.
 * @returns {boolean} whether to accept it.
 */
export function accepts(offered) {
  if (!required()) return true
  const typed = String(offered ?? '').replaceAll(/\D/g, '')
  if (typed.length !== DIGITS) return false

  const key = base32(SECRET)
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const step = now + drift
    const expected = Buffer.from(codeFor(key, step))
    const given = Buffer.from(typed)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) continue
    // Spent, and remembered for as long as it could still be offered again.
    const ticket = `${String(step)}:${typed}`
    if (spent.has(ticket)) return false
    spent.add(ticket)
    setTimeout(() => spent.delete(ticket), (DRIFT_STEPS * 2 + 1) * STEP_SECONDS * 1000).unref?.()
    return true
  }
  return false
}
