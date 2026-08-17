/**
 * What bounds the mail this deployment can be made to send.
 *
 * Driven directly rather than through a deployment: the ceilings are per hour,
 * so observing them end to end would mean either waiting one out or sending
 * hundreds of real messages. Both counters and the caller-address rule are
 * decidable from the module alone.
 *
 * Run: node verify/verify-send-limit.mjs
 */

import assert from 'node:assert/strict'
import process from 'node:process'

// `./` when this file sits beside the gateway tree, as it does at /app in the
// container; `../` when it is run from the repository, where it is one level
// down. Both are supported because AGENTS.md asks contributors to run the
// checks locally.
const sendLimit = await import('./gateway/src/send-limit.js')
  .catch(() => import('../gateway/src/send-limit.js'))
const { SendLimit, callerAddress } = sendLimit

let failures = 0

/**
 * Report one expectation.
 * @param {string} label - what was expected.
 * @param {() => void} body - the assertion, which throws on failure.
 */
function check(label, body) {
  try {
    body()
    console.log(`  PASS  ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL  ${label}  ${error.message}`)
  }
}

console.log('=== the per-caller ceiling ===')

{
  const limit = new SendLimit({ perCaller: 3, total: 100 })
  const verdicts = [1, 2, 3, 4].map(() => limit.allowRequest('203.0.113.7'))
  check('admits up to the ceiling, then refuses', () => {
    assert.deepEqual(verdicts, [true, true, true, false])
  })
}

{
  // The point of counting the caller rather than the address: naming a new
  // address every time is exactly what an abuser does.
  const limit = new SendLimit({ perCaller: 2, total: 100 })
  limit.allowRequest('203.0.113.7')
  limit.allowRequest('203.0.113.7')
  check('a fresh address does not buy a fresh allowance', () => {
    assert.equal(limit.allowRequest('203.0.113.7'), false)
  })
  check('a different caller has their own', () => {
    assert.equal(limit.allowRequest('198.51.100.4'), true)
  })
}

console.log('\n=== the deployment ceiling ===')

{
  const limit = new SendLimit({ perCaller: 100, total: 2 })
  const verdicts = [1, 2, 3].map(() => limit.allowSend())
  check('stops at the budget', () => { assert.deepEqual(verdicts, [true, true, false]) })
}

{
  // Requests and sends are counted separately, so a request that never sends
  // does not spend the budget.
  const limit = new SendLimit({ perCaller: 100, total: 1 })
  limit.allowRequest('203.0.113.7')
  limit.allowRequest('203.0.113.7')
  check('asking does not spend the send budget', () => { assert.equal(limit.allowSend(), true) })
}

console.log('\n=== forgetting idle callers ===')

{
  const limit = new SendLimit({ perCaller: 5, total: 100 })
  limit.allowRequest('203.0.113.7')
  check('a caller inside the window is kept', () => {
    limit.forgetIdle()
    assert.equal(limit.callers.size, 1)
  })
  // Age the entry past the window rather than waiting an hour for it.
  limit.callers.get('203.0.113.7').hits = [Date.now() - 2 * 60 * 60 * 1000]
  check('a caller whose window emptied is dropped', () => {
    limit.forgetIdle()
    assert.equal(limit.callers.size, 0)
  })
}

console.log('\n=== which address a caller is held to ===')

{
  // nginx appends the peer it saw, so the last hop is the observed client and
  // anything before it is what the client chose to claim.
  const forged = { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, socket: {} }
  check('takes the hop nginx observed, not the claimed one', () => {
    assert.equal(callerAddress(forged), '203.0.113.7')
  })
}

{
  const direct = { headers: {}, socket: { remoteAddress: '198.51.100.4' } }
  check('falls back to the socket peer', () => {
    assert.equal(callerAddress(direct), '198.51.100.4')
  })
}

{
  const blank = { headers: { 'x-forwarded-for': '  ' }, socket: { remoteAddress: '198.51.100.4' } }
  check('an empty header is not an address', () => {
    assert.equal(callerAddress(blank), '198.51.100.4')
  })
}

console.log(failures === 0 ? '\n发信限额检查全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
