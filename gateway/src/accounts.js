/**
 * Who has an account here.
 *
 * An account is an email address that has proved it can receive mail, and
 * nothing else — there are no passwords in this deployment. Registration and
 * sign-in are the same act: whoever completes a code challenge for an address
 * either gets the account that address already has, or gets one created for
 * them, subject to whatever `invites.js` requires of a new one.
 *
 * Unlike everything else the gateway stores, an account has no expiry: it ends
 * when an administrator ends it.
 */

import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { normalizePlan } from './plans.js'

/**
 * Addresses that administer this deployment, named by the operator rather than
 * assigned by registration order — "the first person to sign up is in charge"
 * is a race the sign-up page cannot arbitrate.
 *
 * Held in the environment rather than the database because it is a property of
 * the deployment: an operator with shell access can restore their own admission
 * by editing it, where a flag in a table they have just locked themselves out of
 * would need a manual `UPDATE` to fix.
 */
const ADMIN_EMAILS = new Set(
  (process.env.GATEWAY_ADMINS ?? '')
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry !== ''),
)

/**
 * One account.
 * @typedef {object} Account
 * @property {string} email - the address, normalized; the identity everything else keys on.
 * @property {string} id - a stable opaque id, so a tenant's durable state is not named by their address.
 * @property {boolean} admin - whether this address administers the deployment.
 * @property {boolean} disabled - whether an administrator has suspended it.
 * @property {number} createdAt - epoch milliseconds of registration.
 * @property {number} lastSeenAt - epoch milliseconds of the most recent sign-in.
 * @property {string} plan - which tier they are on; always one `plans.js` names, never undefined.
 * @property {string | undefined} displayName - what the tenant asked to be called; undefined until they have said.
 * @property {string | undefined} avatar - their avatar as a `data:` URI; undefined for the default.
 * @property {number | undefined} agreedAt - epoch milliseconds of the most recent acceptance of the policies.
 * @property {string | undefined} agreedPolicy - which version of them was accepted; undefined for an account that registered before there were any.
 */

/**
 * Whether an address administers this deployment.
 *
 * Also what exempts it from needing an invite. An operator naming themselves in
 * `GATEWAY_ADMINS` has to be able to sign in before anything exists to mint a
 * code with — otherwise the first administrator of a fresh deployment has to
 * reach into the database to let themselves in.
 *
 * @param {string} email - the normalized address.
 * @returns {boolean} whether it is an administrator's.
 */
export function isAdminEmail(email) {
  return ADMIN_EMAILS.has(email)
}

/**
 * Reduce an address to the form everything keys on.
 *
 * Case only: the local part of an address is case-sensitive by the letter of
 * the spec, but no provider that matters treats it that way, and two accounts
 * differing only in case would be two sandboxes for one person. Nothing else is
 * stripped — dots and `+` tags are provider-specific, and collapsing them would
 * merge addresses their owners consider distinct.
 *
 * @param {string} email - the address as typed.
 * @returns {string} the normalized address.
 */
export function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

/**
 * Whether a string is an address this deployment will mail a code to.
 *
 * Deliberately shallow. The only test that settles whether an address exists is
 * whether the code arrives, which is the next step anyway; this rejects what is
 * obviously not an address so the mail provider is not asked about it.
 *
 * @param {string} email - the normalized address.
 * @returns {boolean} whether it is worth sending to.
 */
export function isEmailAddress(email) {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email) && email.length <= 254
}

/**
 * Turn one database row into an account.
 * @param {object} row - the row as read.
 * @returns {Account} the account.
 */
function toAccount(row) {
  return {
    email: row.email,
    id: row.id,
    // Derived on every read, so changing `GATEWAY_ADMINS` takes effect at once
    // rather than only for accounts registered afterwards.
    admin: ADMIN_EMAILS.has(row.email),
    disabled: row.disabled,
    createdAt: row.created_at.getTime(),
    lastSeenAt: row.last_seen_at.getTime(),
    // Through `normalizePlan` rather than straight off the row: the column is
    // free text, so a tier this build does not know about — written by a newer
    // gateway, or by hand — becomes the default here instead of travelling on
    // to a browser that would have to rule it out again.
    plan: normalizePlan(row.plan),
    // Undefined for a row that has none and for a row that was not asked for
    // them — `list` below leaves the avatar out on purpose. Every caller that
    // needs one reads a single account, where both columns are always present.
    displayName: row.display_name ?? undefined,
    avatar: row.avatar ?? undefined,
    // Which policy version this account last accepted, for the console to show
    // and for anyone who has to answer "did they agree, and to what".
    agreedAt: row.agreed_at?.getTime(),
    agreedPolicy: row.agreed_policy ?? undefined,
  }
}

/**
 * Whether a tenant has been through the profile page.
 *
 * The name is what settles it, because the name is the part that is required
 * there — an account may reasonably have no avatar, but one with no name has
 * never answered.
 *
 * @param {Account} account - the account.
 * @returns {boolean} whether they have said what to call them.
 */
export function hasProfile(account) {
  return account.displayName !== undefined
}

export class Accounts {
  /**
   * @param {import('pg').Pool} pool - the connected database pool.
   */
  constructor(pool) {
    this.pool = pool
  }

  /**
   * Read one account.
   * @param {string} email - the normalized address.
   * @returns {Promise<Account | undefined>} the account, or undefined when the address has never registered.
   */
  async read(email) {
    const { rows } = await this.pool.query('SELECT * FROM accounts WHERE email = $1', [email])
    return rows.length === 0 ? undefined : toAccount(rows[0])
  }

  /**
   * Read one account by its id.
   *
   * The panel's preview tickets name an account by id rather than by address:
   * a ticket rides in a URL path, and a URL path lands in access logs and
   * browser history. An opaque id there says nothing about who the tenant is.
   *
   * @param {string} id - the account's stable id.
   * @returns {Promise<Account | undefined>} the account, or undefined when no such id exists.
   */
  async readById(id) {
    const { rows } = await this.pool.query('SELECT * FROM accounts WHERE id = $1', [id])
    return rows.length === 0 ? undefined : toAccount(rows[0])
  }

  /**
   * Return the account for an address, registering it if it has none.
   *
   * The caller must already have established that the address's owner is the one
   * asking, and that a new account is allowed — this records a decision rather
   * than making one.
   *
   * One statement rather than a read and a write: two requests for an
   * unregistered address arrive together often enough — a double-submitted form
   * is enough — and the second would otherwise find no account and insert a
   * duplicate, which the unique index would refuse and the caller would see as a
   * failed sign-in.
   *
   * The agreement is written on every sign-in rather than only on the first,
   * because the box is ticked on every sign-in: what the column then says is
   * which version this account last accepted, which is the thing anyone would
   * want to know. Overwriting the first acceptance loses nothing that was not
   * already superseded.
   *
   * @param {string} email - the normalized, verified address.
   * @param {string} policyVersion - the version of the policies the caller just agreed to.
   * @returns {Promise<Account>} the existing or newly created account.
   */
  async admit(email, policyVersion) {
    const { rows } = await this.pool.query(
      `INSERT INTO accounts (id, email, agreed_at, agreed_policy) VALUES ($1, $2, now(), $3)
       ON CONFLICT (email) DO UPDATE
         SET last_seen_at = now(), agreed_at = now(), agreed_policy = EXCLUDED.agreed_policy
       RETURNING *`,
      [randomUUID(), email, policyVersion],
    )
    return toAccount(rows[0])
  }

  /**
   * Whether an address has an account, without registering one.
   * @param {string} email - the normalized address.
   * @returns {Promise<boolean>} whether it is registered.
   */
  async exists(email) {
    const { rowCount } = await this.pool.query('SELECT 1 FROM accounts WHERE email = $1', [email])
    return rowCount > 0
  }

  /**
   * Suspend or restore an account.
   *
   * A disabled account keeps its record and its durable state; it simply cannot
   * sign in or hold a session. Restoring it gives everything back, which is what
   * makes this the reversible half of the administrator's two options.
   *
   * @param {string} email - the normalized address.
   * @param {boolean} disabled - whether to suspend it.
   * @returns {Promise<Account | undefined>} the updated account, or undefined when there is none.
   */
  async setDisabled(email, disabled) {
    const { rows } = await this.pool.query(
      'UPDATE accounts SET disabled = $2 WHERE email = $1 RETURNING *',
      [email, disabled],
    )
    return rows.length === 0 ? undefined : toAccount(rows[0])
  }

  /**
   * Move an account to another tier.
   *
   * The only way a tier changes in this deployment. Nothing here takes money,
   * so there is no checkout to grant one and no webhook to revoke one — an
   * administrator says so from the console, and this records it.
   *
   * The tier is normalized on the way in as well as on the way out, so a value
   * that is not a tier cannot be written at all rather than being written and
   * then quietly read back as the default: a column that disagrees with every
   * reader of it is worse than one that refused the write.
   *
   * Nothing is revoked and nothing is released. Moving between tiers changes no
   * capability today — that is `docs/design.md`'s next question, not this
   * one — so a move that reached into a running sandbox would be enforcing a
   * difference that does not exist.
   *
   * @param {string} email - the normalized address.
   * @param {string} plan - the tier to move them to.
   * @returns {Promise<Account | undefined>} the updated account, or undefined when there is none.
   */
  async setPlan(email, plan) {
    const { rows } = await this.pool.query(
      'UPDATE accounts SET plan = $2 WHERE email = $1 RETURNING *',
      [email, normalizePlan(plan)],
    )
    return rows.length === 0 ? undefined : toAccount(rows[0])
  }

  /**
   * Erase an account.
   *
   * Its refresh tokens go with it, by cascade rather than by a second call that
   * could be interrupted. The caller is still responsible for its sandbox, which
   * this store knows nothing about.
   *
   * @param {string} email - the normalized address.
   * @returns {Promise<void>} resolves once the address is unregistered.
   */
  async erase(email) {
    await this.pool.query('DELETE FROM accounts WHERE email = $1', [email])
  }

  /**
   * The addresses this deployment names, as accounts.
   *
   * Bounded by `GATEWAY_ADMINS` rather than by the table, so it is never
   * paged: a deployment naming enough administrators to need a second page has
   * a different problem than a long list.
   *
   * @returns {Promise<Account[]>} the accounts, for the names that have signed in.
   */
  async admins() {
    const named = [...ADMIN_EMAILS]
    if (named.length === 0) return []
    const { rows } = await this.pool.query(
      `SELECT id, email, disabled, created_at, last_seen_at, display_name, plan
         FROM accounts WHERE email = ANY($1) ORDER BY created_at DESC`,
      [named],
    )
    return rows.map(toAccount)
  }

  /**
   * One page of the accounts this deployment does NOT name, newest first.
   *
   * Paged in SQL rather than sliced after the fact. A console that reads every
   * row to show twenty is a console that gets slower the better the deployment
   * does, and finds out on the day it has the most to lose.
   *
   * The administrators are excluded here rather than filtered out afterwards,
   * or a page of twenty would be however many are left once they were removed.
   *
   * @param {{limit: number, offset: number}} window - the page to read.
   * @returns {Promise<{rows: Account[], total: number}>} the page, and how many there are.
   */
  async tenants({ limit, offset }) {
    const named = [...ADMIN_EMAILS]
    // Every column but the avatar, which is the only large one here and which
    // the console does not show: `SELECT *` would pull every tenant's image
    // into memory to render a table of addresses.
    const { rows } = await this.pool.query(
      `SELECT id, email, disabled, created_at, last_seen_at, display_name, plan,
              count(*) OVER () AS total
         FROM accounts
        WHERE NOT (email = ANY($1))
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [named, limit, offset],
    )
    // The count rides on the rows, so the page and its total cannot disagree
    // about a table that changed between two queries.
    const total = rows.length === 0 ? await this.countTenants(named) : Number(rows[0].total)
    return { rows: rows.map(toAccount), total }
  }

  /**
   * How many accounts there are, for a page that came back empty.
   *
   * @param {string[]} named - the addresses to exclude.
   * @returns {Promise<number>} the count.
   */
  async countTenants(named) {
    const { rows } = await this.pool.query(
      'SELECT count(*) AS total FROM accounts WHERE NOT (email = ANY($1))',
      [named],
    )
    return Number(rows[0].total)
  }

  /**
   * Record what a tenant calls themselves and what they look like.
   *
   * Both are written together because they are one form, and both are written
   * unconditionally because "leave it as it was" is a decision the caller has
   * already made by passing the current value back.
   *
   * @param {string} email - the normalized address.
   * @param {string} displayName - the name, already validated and trimmed.
   * @param {string | undefined} avatar - the `data:` URI, already validated, or undefined for none.
   * @returns {Promise<Account | undefined>} the updated account, or undefined when there is none.
   */
  async setProfile(email, displayName, avatar) {
    const { rows } = await this.pool.query(
      'UPDATE accounts SET display_name = $2, avatar = $3 WHERE email = $1 RETURNING *',
      [email, displayName, avatar ?? null],
    )
    return rows.length === 0 ? undefined : toAccount(rows[0])
  }
}
