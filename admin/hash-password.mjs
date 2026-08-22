/**
 * Turn a password into the form `ADMIN_PASSWORD_HASH` takes.
 *
 * The only supported way to produce one: a hash from elsewhere may use
 * parameters this deployment cannot read, and the failure mode of that is a
 * console nobody can enter.
 *
 * Reads from stdin rather than from an argument, so the password does not end
 * up in a shell history or in the process list of a shared machine.
 *
 * Usage:  printf '%s' 'the password' | node admin/hash-password.mjs
 */

import process from 'node:process'

import { hashPassword } from './auth.js'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')

if (password.length < 12) {
  process.stderr.write('hash-password: use at least 12 characters — this one credential opens every account\n')
  process.exit(2)
}

process.stdout.write(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}\n`)
