/**
 * Tenant isolation.
 *
 * The property that matters most: one tenant's sessions, workspace, and agent
 * must be unreachable from another tenant's browser. Isolation here is not a
 * filter the gateway applies to a shared backend — each tenant's requests land
 * in a different dsh process, and this proves that separation holds at the API
 * a browser can actually reach.
 */

import process from 'node:process'
import { signIn } from './verify-login.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'

let passed = 0
let failed = 0

/**
 * Record one acceptance result.
 * @param {string} label - what was checked.
 * @param {boolean} ok - whether it held.
 * @param {string} detail - observed value.
 */
function check(label, ok, detail) {
  const mark = ok ? '[32mPASS[0m' : '[31mFAIL[0m'
  console.log(`  ${mark}  ${label.padEnd(46)} ${detail}`)
  if (ok) passed += 1
  else failed += 1
}

/**
 * Issue one unary RPC as a given tenant.
 * @param {string} cookie - that tenant's session cookie.
 * @param {string} method - the RPC method name.
 * @param {object} payload - the method payload.
 * @returns {Promise<object>} the raw `result`, successful or not.
 */
async function rpc(cookie, method, payload) {
  const response = await fetch(`${GATEWAY}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `r-${Math.random().toString(36).slice(2)}`, method, payload }),
  })
  return (await response.json()).result
}

const alice = await signIn(GATEWAY, process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev')
const bob = await signIn(GATEWAY, process.env.VERIFY_BOB ?? 'delivered+bob@resend.dev')

const created = await rpc(alice, 'session.create', { cwd: '/mnt/workspace' })
const aliceSession = created.value.sessionId
console.log(`\nalice created ${aliceSession}`)

console.log('\n=== 9. One tenant cannot see another tenant\'s sessions ===')

const aliceList = await rpc(alice, 'session.list', {})
const aliceIds = JSON.stringify(aliceList.value ?? {})
check('alice sees her own session', aliceIds.includes(aliceSession), aliceList.ok === true ? 'listed' : 'list failed')

const bobList = await rpc(bob, 'session.list', {})
const bobIds = JSON.stringify(bobList.value ?? {})
check('bob does not see it in his list', !bobIds.includes(aliceSession), bobList.ok === true ? 'absent' : 'list failed')

console.log('\n=== 10. One tenant cannot read another tenant\'s session ===')

const stolen = await rpc(bob, 'session.history', { sessionId: aliceSession })
check('bob cannot read her history', stolen.ok !== true, stolen.ok === true ? 'READ IT' : `refused: ${stolen.error?.code}`)

const hijacked = await rpc(bob, 'session.prompt', {
  sessionId: aliceSession,
  mode: 'queue',
  content: [{ type: 'text', text: 'this must not run' }],
})
check('bob cannot prompt into her session', hijacked.ok !== true, hijacked.ok === true ? 'PROMPTED' : `refused: ${hijacked.error?.code}`)

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`)
process.exit(failed === 0 ? 0 : 1)
