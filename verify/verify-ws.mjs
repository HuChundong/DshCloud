/**
 * WebSocket half of the acceptance run.
 *
 * The two `/api` downlinks are the part most likely to break silently: their
 * upgrades pass the same trust fence as the HTTP calls, and the frontend treats
 * either socket ending as loss of the whole connection generation. A stack that
 * answers every HTTP call correctly can still be unusable if these do not open.
 */

import process from 'node:process'
import WebSocket from 'ws'
import { signIn } from './verify-login.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.WS_USER ?? process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev'

let passed = 0
let failed = 0

/**
 * Record one acceptance result.
 * @param {string} label - what was checked.
 * @param {boolean} ok - whether it held.
 * @param {string} detail - observed value.
 */
function check(label, ok, detail) {
  const mark = ok ? '[32mPASS[0m' : '[31mFAIL[0m'
  console.log(`  ${mark}  ${label.padEnd(46)} ${detail}`)
  if (ok) passed += 1
  else failed += 1
}

/**
 * Open one downlink and report whether it reached OPEN.
 * @param {string} path - the downlink path.
 * @param {string} cookie - the session cookie header value.
 * @param {boolean} authenticated - whether to send the cookie at all.
 * @returns {Promise<{open: boolean, detail: string}>} the outcome.
 */
function openDownlink(path, cookie, authenticated) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${GATEWAY.replace('http', 'ws')}${path}`, {
      headers: authenticated ? { Cookie: cookie } : {},
    })
    const timer = setTimeout(() => {
      socket.terminate()
      resolve({ open: false, detail: 'timeout' })
    }, 120_000)
    socket.on('open', () => {
      clearTimeout(timer)
      socket.close()
      resolve({ open: true, detail: '101 open' })
    })
    socket.on('error', (error) => {
      clearTimeout(timer)
      resolve({ open: false, detail: error.message })
    })
  })
}

const cookie = await signIn(GATEWAY, USER)

console.log('\n=== 7. Both /api downlinks open through the tunnel ===')
for (const path of ['/api/events.mux', '/api/events.host']) {
  const result = await openDownlink(path, cookie, true)
  check(`authenticated ${path}`, result.open, result.detail)
}

console.log('\n=== 8. Downlinks are refused without a session ===')
for (const path of ['/api/events.mux', '/api/events.host']) {
  const result = await openDownlink(path, cookie, false)
  check(`unauthenticated ${path} is refused`, !result.open, result.open ? 'opened' : result.detail)
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`)
process.exit(failed === 0 ? 0 : 1)
