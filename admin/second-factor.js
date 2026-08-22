/**
 * Whether a second factor is asked for, and which secret is in force.
 *
 * `totp.js` knows the algorithm. This knows the deployment: where the secret
 * is kept, how it gets onto a phone, and what happens when that phone is lost.
 *
 * ## One place the secret can be
 *
 * The enrolment row, and nowhere else. It was briefly readable from
 * `ADMIN_TOTP_SECRET` as well, so that a deployment could pin it in a file —
 * and that second source of truth immediately did what second sources of truth
 * do: a fresh deployment demanded a code from a secret nobody had scanned,
 * because the variable was set before anybody could enrol. The environment
 * cannot be written at runtime, so it cannot be the place a phone is enrolled;
 * having it win anyway only meant the console showed buttons it then refused
 * to honour.
 *
 * ## Nothing is enabled until a code proves it
 *
 * A new secret sits in memory, not in the database, until one code computed
 * from it arrives. This is the single most important rule in the file. Enable
 * first and verify later, and a QR photographed at an angle, a phone with a
 * wrong clock, or a scan nobody actually completed locks the only operator out
 * of the only console permanently — with a correct password and no way in.
 *
 * ## Recovery codes
 *
 * Ten of them, shown once, each good once. Without them the answer to a lost
 * phone is a shell on the database host, which an operator locked out of the
 * console may not have to hand.
 *
 * Stored as SHA-256 rather than scrypt, deliberately: these are 50 random bits
 * each, not passwords, so there is no dictionary to slow down — and ten scrypt
 * comparisons on every sign-in attempt would be a denial of service with extra
 * steps.
 *
 * @module second-factor
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

import { accepts as totpAccepts, enrolmentUri, generateSecret, usable } from './totp.js'

/** Where the enrolment lives in the settings table. */
const KEY = 'admin.second_factor'

/** How many recovery codes an enrolment carries. */
const RECOVERY_CODES = 10

/** Characters a recovery code is drawn from: no 0/O and no 1/l/I. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** How long a half-finished enrolment waits for its first code. */
const PENDING_MS = 10 * 60 * 1000

/**
 * The secret being enrolled but not yet proven, if there is one.
 *
 * In memory rather than in the database, which is the point: a secret that was
 * never proven should leave nothing behind. A restart during enrolment means
 * scanning again, which is a smaller cost than a row that claims a phone holds
 * a secret it does not.
 *
 * One slot, because there is one operator. Two browser tabs enrolling at once
 * would have the second replace the first — and the first would then fail to
 * verify, which is the safe direction to fail in.
 */
let pending

/**
 * @param {string} value - the code as typed.
 * @returns {string} the same code, in the one form stored codes are in.
 */
function tidyRecovery(value) {
  return String(value ?? '').toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

/**
 * @param {string} code - a recovery code.
 * @returns {string} what is stored for it.
 */
function fingerprint(code) {
  return createHash('sha256').update(tidyRecovery(code)).digest('hex')
}

/**
 * Ten fresh recovery codes.
 * @returns {string[]} the codes, in the form they are shown.
 */
function mintRecovery() {
  const codes = []
  for (let index = 0; index < RECOVERY_CODES; index += 1) {
    let code = ''
    for (let position = 0; position < 10; position += 1) {
      // Grouped in fives, which is how anybody transcribing one will read it.
      if (position === 5) code += '-'
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
    }
    codes.push(code)
  }
  return codes
}

/** The enrolment, and everything that can be said about it. */
export class SecondFactor {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
  }

  /**
   * The stored enrolment, if the console made one.
   * @returns {Promise<{secret: string, recovery: string[], updatedAt: number, updatedBy: string|undefined}|undefined>} the row.
   */
  async stored() {
    const { rows } = await this.pool.query('SELECT * FROM settings WHERE key = $1', [KEY])
    if (rows.length === 0) return undefined
    return {
      secret: rows[0].value.secret ?? '',
      recovery: rows[0].value.recovery ?? [],
      updatedAt: rows[0].updated_at.getTime(),
      updatedBy: rows[0].updated_by ?? undefined,
    }
  }

  /**
   * What the console shows, and what sign-in decides with.
   *
   * @returns {Promise<{enabled: boolean, source: 'console'|'none', recoveryLeft: number, updatedAt: number|undefined, updatedBy: string|undefined}>} the state.
   */
  async state() {
    const row = await this.stored()
    if (row !== undefined && usable(row.secret)) {
      return {
        enabled: true,
        source: 'console',
        recoveryLeft: row.recovery.length,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      }
    }
    return { enabled: false, source: 'none', recoveryLeft: 0, updatedAt: undefined, updatedBy: undefined }
  }

  /**
   * Whether this deployment asks for a second factor at all.
   * @returns {Promise<boolean>} whether to ask.
   */
  async required() {
    return (await this.state()).enabled
  }

  /**
   * Whether what was typed gets somebody in.
   *
   * A six-digit number is read as a code from the app; anything else is read as
   * a recovery code, which is spent if it matches.
   *
   * @param {string} offered - what was typed.
   * @returns {Promise<boolean>} whether to accept it.
   */
  async accepts(offered) {
    const typed = String(offered ?? '').trim()
    const row = await this.stored()
    if (row === undefined || !usable(row.secret)) return false
    const secret = row.secret

    if (/^\d{6}$/.test(typed.replaceAll(/\s/g, ''))) return totpAccepts(secret, typed)

    // A recovery code, which only a console enrolment has.
    if (row === undefined || row.recovery.length === 0) return false
    const offeredPrint = fingerprint(typed)
    const match = row.recovery.find((held) => {
      const a = Buffer.from(held)
      const b = Buffer.from(offeredPrint)
      return a.length === b.length && timingSafeEqual(a, b)
    })
    if (match === undefined) return false
    await this.spendRecovery(row, match)
    return true
  }

  /**
   * Cross one recovery code off.
   *
   * @param {{secret: string, recovery: string[]}} row - the enrolment.
   * @param {string} used - the fingerprint to remove.
   * @returns {Promise<void>} resolves once stored.
   */
  async spendRecovery(row, used) {
    await this.pool.query(
      'UPDATE settings SET value = $2 WHERE key = $1',
      [KEY, JSON.stringify({ secret: row.secret, recovery: row.recovery.filter((held) => held !== used) })],
    )
  }

  /**
   * Start an enrolment: a secret to scan, proven by nothing yet.
   *
   * @param {string} account - what the authenticator app should call this.
   * @param {string} issuer - what it should file it under.
   * @returns {{secret: string, uri: string}} the secret and the URI a QR carries.
   */
  begin(account, issuer) {
    const secret = generateSecret()
    pending = { secret, until: Date.now() + PENDING_MS }
    return { secret, uri: enrolmentUri(secret, account, issuer) }
  }

  /**
   * The enrolment in progress, if one has not timed out.
   * @returns {string|undefined} the secret being enrolled.
   */
  inProgress() {
    if (pending === undefined) return undefined
    if (Date.now() > pending.until) {
      pending = undefined
      return undefined
    }
    return pending.secret
  }

  /** Abandon an enrolment in progress. */
  abandon() {
    pending = undefined
  }

  /**
   * Turn on the enrolment in progress, if a code proves the phone holds it.
   *
   * @param {string} code - a code from the app that scanned it.
   * @param {string} updatedBy - who is enrolling.
   * @returns {Promise<string[]|undefined>} the recovery codes, or nothing if the code was wrong.
   */
  async activate(code, updatedBy) {
    const secret = this.inProgress()
    if (secret === undefined) return undefined
    if (!totpAccepts(secret, code)) return undefined

    const codes = mintRecovery()
    await this.pool.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [KEY, JSON.stringify({ secret, recovery: codes.map(fingerprint) }), updatedBy],
    )
    pending = undefined
    return codes
  }

  /**
   * Fresh recovery codes, replacing whatever is left.
   *
   * @param {string} updatedBy - who asked.
   * @returns {Promise<string[]|undefined>} the new codes, or nothing if nothing is enrolled here.
   */
  async remintRecovery(updatedBy) {
    const row = await this.stored()
    if (row === undefined || !usable(row.secret)) return undefined
    const codes = mintRecovery()
    await this.pool.query(
      `UPDATE settings SET value = $2, updated_at = now(), updated_by = $3 WHERE key = $1`,
      [KEY, JSON.stringify({ secret: row.secret, recovery: codes.map(fingerprint) }), updatedBy],
    )
    return codes
  }

  /**
   * Turn the second factor off, by forgetting what was enrolled.
   *
   * @returns {Promise<void>} resolves once the row is gone.
   */
  async forget() {
    pending = undefined
    await this.pool.query('DELETE FROM settings WHERE key = $1', [KEY])
  }
}
