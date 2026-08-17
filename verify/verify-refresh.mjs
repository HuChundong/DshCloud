/**
 * What a refresh token does when a browser wakes up.
 *
 * The case this exists for is concurrency, not time: a tab returning from the
 * background asks several times at once with the cookie it went to sleep with.
 * Spending by deletion answered one and refused the rest, which to the person
 * is being asked for a code again after leaving a tab open.
 *
 * Driven against the store directly, because the failure needs simultaneous
 * requests rather than elapsed time, and because the grace window is measured
 * in seconds — long enough to reproduce, short enough that a replay test does
 * not have to wait one out.
 *
 * Needs the deployment's database; run inside the gateway container.
 */

import assert from 'node:assert/strict'
import process from 'node:process'

const { connect } = await import('./gateway/src/db.js')
  .catch(() => import('../gateway/src/db.js'))
const { Tokens } = await import('./gateway/src/tokens.js')
  .catch(() => import('../gateway/src/tokens.js'))

const pool = await connect()
const tokens = new Tokens('a-secret-only-this-check-uses-0123456789', pool)

const email = `refresh-probe-${Date.now()}@example.com`
await pool.query('INSERT INTO accounts (id, email) VALUES (gen_random_uuid(), $1)', [email])
const account = { email, id: 'probe', admin: false }

let failures = 0

/**
 * Report one expectation.
 *
 * Awaited, because several of these assert on something that has to be fetched
 * first: a non-awaited async body would throw into a promise nobody reads and
 * every such check would pass regardless.
 *
 * @param {string} label - what was expected.
 * @param {() => void | Promise<void>} body - the assertion, which throws on failure.
 * @returns {Promise<void>} resolves once the outcome is reported.
 */
async function check(label, body) {
  try {
    await body()
    console.log(`  PASS  ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL  ${label}  ${error.message}`)
  }
}

console.log('=== a browser waking with one cookie ===')

{
  const issued = await tokens.issueRefresh(account)
  // What the burst looks like: every request carrying the same cookie, none of
  // them having seen another's replacement yet.
  const spent = await Promise.all(Array.from({ length: 6 }, () => tokens.spendRefresh(issued)))
  await check('every concurrent request is answered', () => {
    assert.equal(spent.filter((one) => one !== undefined).length, 6)
  })
  await check('all of them name the same account', () => {
    assert.deepEqual([...new Set(spent.map((one) => one?.email))], [email])
  })
  // The point of returning the replacement rather than minting one each: six
  // replacements would leave five tokens nobody holds.
  await check('and all end up holding one replacement', () => {
    assert.equal(new Set(spent.map((one) => one?.refresh)).size, 1)
  })
  await check('which is not the one they presented', () => {
    assert.notEqual(spent[0]?.refresh, issued)
  })
}

console.log('\n=== the replacement is usable, the original is not forever ===')

{
  const issued = await tokens.issueRefresh(account)
  const first = await tokens.spendRefresh(issued)
  const again = await tokens.spendRefresh(first.refresh)
  await check('the replacement rotates in its turn', () => { assert.equal(again?.email, email) })
  await check('and yields a further one', () => { assert.notEqual(again?.refresh, first.refresh) })
}

{
  const issued = await tokens.issueRefresh(account)
  await tokens.spendRefresh(issued)
  // Aged past the grace rather than waited out, so this check costs no time.
  await pool.query(
    "UPDATE refresh_tokens SET spent_at = now() - interval '1 hour' WHERE token = $1",
    [issued],
  )
  await check('a token replayed after its grace is refused', async () => {
    assert.equal(await tokens.spendRefresh(issued), undefined)
  })
}

console.log('\n=== what revocation still means ===')

{
  const issued = await tokens.issueRefresh(account)
  const spent = await tokens.spendRefresh(issued)
  await tokens.revokeAll(email)
  await check('signing out kills the replacement', async () => {
    assert.equal(await tokens.spendRefresh(spent.refresh), undefined)
  })
  await check('and the token it replaced, inside its grace', async () => {
    assert.equal(await tokens.spendRefresh(issued), undefined)
  })
}

await check('an unknown token is refused', async () => {
  assert.equal(await tokens.spendRefresh('not-a-token'), undefined)
})

await pool.query('DELETE FROM accounts WHERE email = $1', [email])
await pool.end()

console.log(failures === 0 ? '\n刷新令牌检查全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
