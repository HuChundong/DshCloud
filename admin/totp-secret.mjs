/**
 * A fresh TOTP secret, printed once.
 *
 * Base32 because that is what every authenticator app reads, and printed with
 * the `otpauth://` URI so it can be turned into a QR code without the secret
 * passing through a website that offers to draw one.
 *
 * Usage:  node admin/totp-secret.mjs [label]
 */

import { randomBytes } from 'node:crypto'
import process from 'node:process'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const bytes = randomBytes(20)
let bits = 0
let carry = 0
let secret = ''
for (const byte of bytes) {
  carry = (carry << 8) | byte
  bits += 8
  while (bits >= 5) {
    bits -= 5
    secret += ALPHABET[(carry >> bits) & 31]
  }
}

const label = encodeURIComponent(process.argv[2] ?? 'HamsterHQ admin')
process.stdout.write(`ADMIN_TOTP_SECRET=${secret}\n\n`)
process.stdout.write(`otpauth://totp/${label}?secret=${secret}&issuer=HamsterHQ&digits=6&period=30\n`)
