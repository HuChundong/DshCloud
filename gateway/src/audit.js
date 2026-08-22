/**
 * What a privileged action did, and who did it.
 *
 * The console can rotate the model credential every tenant's agent calls with,
 * suspend an account, erase one, and move anybody between tiers. None of that
 * left a trace. `settings` carries an `updated_by`, which says who touched a
 * row last and nothing about what it held before, or how many times, or by
 * whom the time before that.
 *
 * This is the record. It is append-only by discipline rather than by grant —
 * nothing here updates or deletes, and a trail that can be edited records only
 * what somebody was willing to leave behind.
 *
 * ## It never fails the thing it is recording
 *
 * A write here that throws must not turn a successful suspension into an error
 * the operator retries — which would suspend twice, or worse, look like it
 * failed when it did not. So a failure is logged and swallowed. That is a
 * deliberate trade: an audit trail with a hole in it, over an action whose
 * outcome the operator cannot trust.
 *
 * The hole is visible, which is what makes it acceptable: the failure goes to
 * the deployment's log, where the operator is already looking when something
 * is wrong.
 *
 * ## What belongs in `detail`
 *
 * Enough to answer "what changed", and never a secret. A credential rotation
 * records that the credential was rotated and which endpoint it points at; it
 * does not record the key, not even its last four characters — this table
 * outlives the key and is read by whoever can read the database.
 *
 * @module audit
 */

/**
 * Record one privileged action.
 *
 * @param {import('pg').Pool} db - the deployment's database.
 * @param {object} entry - what happened.
 * @param {string} entry.actor - the address that did it.
 * @param {string} entry.action - a stable name, dotted, e.g. `account.suspended`.
 * @param {string} [entry.subject] - who it was done to, absent for an action about the deployment.
 * @param {Record<string, unknown>} [entry.detail] - what changed, carrying no secret.
 * @returns {Promise<void>} resolves whether or not it was recorded.
 */
export async function record(db, { actor, action, subject, detail }) {
  try {
    await db.query(
      'INSERT INTO audit (actor, action, subject, detail) VALUES ($1, $2, $3, $4)',
      [actor, action, subject ?? null, JSON.stringify(detail ?? {})],
    )
  } catch (error) {
    // Deliberately not rethrown; see the module comment.
    console.error(`gateway: could not record ${action} by ${actor}: ${error.message}`)
  }
}

/**
 * One page of entries, newest first.
 *
 * @param {import('pg').Pool} db - the deployment's database.
 * @param {{limit: number, offset: number}} window - the page to read.
 * @returns {Promise<{rows: Array<object>, total: number}>} the page, and how many there are.
 */
export async function recent(db, { limit, offset }) {
  const { rows } = await db.query(
    `SELECT at, actor, action, subject, detail, count(*) OVER () AS total
       FROM audit ORDER BY at DESC, id DESC LIMIT $1 OFFSET $2`,
    [Math.min(Math.max(1, Math.trunc(limit)), 500), Math.max(0, Math.trunc(offset))],
  )
  const total = rows.length === 0
    ? Number((await db.query('SELECT count(*) AS total FROM audit')).rows[0].total)
    : Number(rows[0].total)
  return { rows, total }
}
