/**
 * RFC 6238, which is what an authenticator app computes.
 *
 * Implemented here rather than depended on. It is one HMAC and a truncation —
 * no wire format, no negotiation, no versioning — and a dependency for that is
 * more supply chain than arithmetic. The price of the exception is
 * `scripts/check-totp.mjs`, which tests this against the vectors printed in
 * the RFC rather than against a second reading of it: an authenticator app is
 * an offline calculator, so nothing between it and this service can report a
 * disagreement.
 *
 * ## Nothing here decides anything
 *
 * This module knows the algorithm and not the deployment. Whether a second
 * factor is asked for, which secret is in force, and where that secret is kept
 * all belong to `second-factor.js` — because those change at runtime now, and
 * an algorithm that read them from the environment could only ever answer for
 * the environment it started in.
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

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** RFC 6238's defaults, which every authenticator app assumes. */
const STEP_SECONDS = 30
const DIGITS = 6

/** How far either side of now a code is accepted. */
const DRIFT_STEPS = 1

/** The alphabet these secrets are always written in. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Codes already spent, by the secret and step they belonged to.
 *
 * Keyed by the secret as well as the step, so a code spent against one
 * enrolment says nothing about another — which matters while a new secret is
 * being verified beside the one still in force.
 */
const spent = new Set()

/**
 * A fresh secret, printed once and never again.
 *
 * Twenty bytes, which is the length RFC 4226 recommends and what every
 * authenticator app is used to reading.
 *
 * @returns {string} base32, as every authenticator app prints it.
 */
export function generateSecret() {
  let bits = 0
  let carry = 0
  let secret = ''
  for (const byte of randomBytes(20)) {
    carry = (carry << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      secret += ALPHABET[(carry >> bits) & 31]
    }
  }
  return secret
}

/**
 * The enrolment URI an authenticator app reads out of a QR code.
 *
 * @param {string} secret - the shared secret, base32.
 * @param {string} account - what the app should call this entry.
 * @param {string} issuer - what the app should file it under.
 * @returns {string} the `otpauth://` URI.
 */
export function enrolmentUri(secret, account, issuer) {
  // The label carries the issuer as well as the account, which is the older
  // convention; the `issuer` parameter is the newer one. Apps read both, and
  // the ones that read only the label are the reason to keep it.
  const label = encodeURIComponent(`${issuer}:${account}`)
  const query = new URLSearchParams({
    secret: normalize(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${query.toString()}`
}

/**
 * Tidy a secret as somebody might have typed or pasted it.
 *
 * @param {string} value - the secret.
 * @returns {string} the same secret, in the one form the rest of this uses.
 */
export function normalize(value) {
  return String(value ?? '').replaceAll(/[\s=]/g, '').toUpperCase()
}

/**
 * Whether a secret is long enough to be one.
 *
 * @param {string} value - the secret.
 * @returns {boolean} whether it can be used.
 */
export function usable(value) {
  const secret = normalize(value)
  return secret.length >= 16 && [...secret].every((character) => ALPHABET.includes(character))
}

/**
 * Decode base32.
 *
 * @param {string} value - the secret.
 * @returns {Buffer} its bytes.
 */
function base32(value) {
  let bits = 0
  let carry = 0
  const bytes = []
  for (const character of value) {
    const index = ALPHABET.indexOf(character)
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
 *
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
 * Whether this code is the one on the phone holding that secret right now.
 *
 * @param {string} secret - the shared secret, base32.
 * @param {string} offered - what was typed.
 * @returns {boolean} whether to accept it.
 */
export function accepts(secret, offered) {
  const shared = normalize(secret)
  if (!usable(shared)) return false
  const typed = String(offered ?? '').replaceAll(/\D/g, '')
  if (typed.length !== DIGITS) return false

  const key = base32(shared)
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const step = now + drift
    const expected = Buffer.from(codeFor(key, step))
    const given = Buffer.from(typed)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) continue
    // Spent, and remembered for as long as it could still be offered again.
    const ticket = `${shared}:${String(step)}:${typed}`
    if (spent.has(ticket)) return false
    spent.add(ticket)
    setTimeout(() => spent.delete(ticket), (DRIFT_STEPS * 2 + 1) * STEP_SECONDS * 1000).unref?.()
    return true
  }
  return false
}
