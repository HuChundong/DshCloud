/**
 * Signing in, for the suites that run inside the gateway container.
 *
 * There are no passwords in this deployment: a sign-in is a code mailed to an
 * address, and an acceptance run has no mailbox. It reads the pending code out
 * of the deployment's own database instead — operator access, not a way in that
 * a user has, and not a test-only path through the gateway. The code is a secret
 * held for ten minutes, and whoever can read that database can already mint a
 * session without one.
 *
 * Shared rather than repeated in each suite, so that a change to how sign-in
 * works is one edit and not three.
 */

import process from 'node:process'
import pg from 'pg'

/**
 * Read the code a challenge is waiting for.
 * @param {string} email - the address the challenge belongs to.
 * @returns {Promise<string>} the six-digit code.
 * @throws {Error} when no challenge is outstanding for that address.
 */
async function pendingCode(email) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      'SELECT code FROM challenges WHERE email = $1 AND expires_at > now()',
      [email],
    )
    if (rows.length === 0) throw new Error(`no sign-in code is pending for ${email}`)
    return rows[0].code
  } finally {
    await client.end()
  }
}

/**
 * Mint one invite, so a suite can register an address that has no account.
 *
 * Straight into the table rather than through the console, because signing in
 * must not depend on an administrator existing. Carried on every sign-in: only
 * the server knows whether this address is new, and an invite an existing
 * account does not need is simply not spent.
 *
 * @returns {Promise<string>} the new code.
 */
async function mintInvite() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      `INSERT INTO invites (code, created_by)
       VALUES ('VERIF-' || upper(substr(md5(random()::text), 1, 5)), 'verify')
       RETURNING code`,
    )
    return rows[0].code
  } finally {
    await client.end()
  }
}

/**
 * Register or sign in an address, and return the cookies that prove it.
 *
 * Both cookies are returned, not only the access one: the access token expires
 * in fifteen minutes, and a suite that held only it would start failing partway
 * through a long run with no way to renew.
 *
 * @param {string} gateway - the deployment's base URL.
 * @param {string} email - the address to sign in.
 * @returns {Promise<string>} the `Cookie` header value.
 * @throws {Error} when either step is refused.
 */
export async function signIn(gateway, email) {
  const form = (body) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'manual',
  })

  // The policies the form is currently asking people to accept, read off the
  // form rather than written down here: bumping the documents must not break
  // the suites, and a form that stopped asking would fail here instead.
  const agree = (await (await fetch(`${gateway}/login`)).text())
    .match(/name="agree" value="([^"]*)"/)?.[1]
  if (agree === undefined) throw new Error('the sign-in form no longer asks for consent')

  // The invite rides on BOTH posts, not only the one that spends it. A
  // deployment with registration closed opens no challenge for an address that
  // may not receive one — the form answers with the same neutral notice it
  // shows everyone, and the suite then reads a code that was never minted and
  // fails with "no sign-in code is pending". Which is what the acceptance run
  // did against the first deployment that closed its door.
  const invite = await mintInvite()

  // A cooldown answer is not a failure here: it means a code is already
  // outstanding for this address, which is the code the next step reads.
  await fetch(`${gateway}/login`, form({ email, invite, agree }))

  const response = await fetch(`${gateway}/login`, form({
    email,
    code: await pendingCode(email),
    invite,
    agree,
  }))
  const setCookie = response.headers.getSetCookie?.() ?? []
  if (setCookie.length === 0) throw new Error(`sign-in failed for ${email}: HTTP ${response.status}`)
  return setCookie.map((cookie) => cookie.split(';')[0]).join('; ')
}
