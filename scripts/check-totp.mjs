/**
 * The second factor, against the specification's own answers.
 *
 * This repository has a rule about not implementing somebody else's protocol,
 * and TOTP is somebody else's protocol. It is here anyway, deliberately: RFC
 * 6238 has no wire format, no negotiation and no versioning — it is one HMAC
 * and a modulo, and a dependency for thirty lines of `node:crypto` would be a
 * larger liability than the thirty lines.
 *
 * The price of that exception is this file. An authenticator app is an offline
 * calculator: nothing between it and the service can report a disagreement, so
 * an implementation that is subtly wrong looks exactly like one that is right
 * until somebody with a phone cannot get in. Testing it against a second
 * implementation of the same reading proves nothing — both can misread the same
 * sentence the same way.
 *
 * So it is tested against the vectors printed in the RFC itself. Match those
 * and it interoperates with every app that also matches them, which is what
 * "Google Authenticator support" actually means.
 *
 * Vectors: RFC 6238 Appendix B, SHA-1 rows. The shared secret there is the
 * ASCII string `12345678901234567890`, which is
 * `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` in base32.
 */

import { createHmac } from 'node:crypto'
import process from 'node:process'

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const { accepts } = await import('../admin/totp.js')

/**
 * The RFC prints eight digits. A six-digit code is the same value taken mod
 * 10^6, which is the last six of them.
 */
const VECTORS = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
]

/**
 * The RFC's algorithm, written out here rather than imported.
 *
 * Not a second opinion — it would be the same opinion. It exists only to
 * produce codes for neighbouring time steps, which the RFC does not print.
 *
 * @param {number} seconds - unix time.
 * @returns {string} the six-digit code for that moment.
 */
function codeAt(seconds) {
  const key = Buffer.from('12345678901234567890', 'ascii')
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = mac[mac.length - 1] & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

const realNow = Date.now
/**
 * Offer a code as if it were a given moment.
 *
 * @param {number} seconds - the moment.
 * @param {string} code - what is being offered.
 * @returns {boolean} whether it was accepted.
 */
function at(seconds, code) {
  Date.now = () => seconds * 1000
  try {
    return accepts(SECRET, code)
  } finally {
    Date.now = realNow
  }
}

let failures = 0
for (const [seconds, expected] of VECTORS) {
  // Does the module agree with the answer the RFC printed?
  const ok = at(seconds, expected)

  // And is the window the right width, in the right place? One step either way
  // is inside the drift the module allows on purpose; two is not. A step
  // counter that was off by one would still accept the vector above — drift
  // would cover it — and would be caught here.
  //
  // The first vector sits at t=59, where two steps back is before the epoch.
  const behind = seconds >= 60 ? at(seconds, codeAt(seconds - 60)) : false
  const ahead = at(seconds, codeAt(seconds + 60))

  if (ok && !behind && !ahead) continue
  failures += 1
  console.error(
    `check-totp: t=${String(seconds)} — RFC says ${expected}; `
    + `accepted=${String(ok)}, two steps behind=${String(behind)}, two steps ahead=${String(ahead)}`,
  )
}

if (failures > 0) {
  console.error(`check-totp: ${String(failures)} of ${String(VECTORS.length)} RFC 6238 vector(s) disagree`)
  console.error('check-totp: an authenticator app cannot report this — it just fails to let anybody in')
  process.exit(1)
}

console.log(`check-totp: ${String(VECTORS.length)} RFC 6238 vector(s) agree`)
