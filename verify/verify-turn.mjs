/**
 * One real model turn through the whole stack.
 *
 * Everything else in the acceptance run proves the plumbing answers. This
 * proves the product works: browser-shaped calls reach a tenant's agent, the
 * agent reaches the model, and its output comes back over the mux downlink —
 * the path a person actually uses.
 */

import process from 'node:process'
import WebSocket from 'ws'
import { signIn } from './verify-login.mjs'

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8080'
const USER = process.env.TURN_USER ?? process.env.VERIFY_ALICE ?? 'delivered+alice@resend.dev'
const PROMPT = process.env.TURN_PROMPT ?? 'Reply with exactly the word READY and nothing else.'
const TURN_TIMEOUT_MS = 180_000

/** @type {string} */
let cookie

/**
 * Issue one unary RPC through the gateway.
 * @param {string} method - the RPC method name.
 * @param {object} payload - the method payload.
 * @returns {Promise<object>} the parsed `result`.
 */
async function rpc(method, payload) {
  const response = await fetch(`${GATEWAY}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `r-${Math.random().toString(36).slice(2)}`, method, payload }),
  })
  const body = await response.json()
  if (body.result?.ok !== true) {
    throw new Error(`${method}: ${JSON.stringify(body.result?.error ?? body)}`)
  }
  return body.result.value
}

cookie = await signIn(GATEWAY, USER)
console.log(`signed in as ${USER}`)

const host = await rpc('host.describe', {})
console.log(`sandbox: cwd=${host.cwd} provider=${host.provider} model=${host.model}`)

// The downlink must be open before the prompt, or its early events are lost:
// the socket carries what the host pushes, and nothing replays it.
const mux = new WebSocket(`${GATEWAY.replace('http', 'ws')}/api/events.mux`, { headers: { Cookie: cookie } })
await new Promise((resolve, reject) => {
  mux.on('open', resolve)
  mux.on('error', reject)
})
console.log('mux downlink open')

const { sessionId } = await rpc('session.create', { cwd: '/mnt/workspace' })
console.log(`session: ${sessionId}`)

/** Text parts of the assistant messages this turn produced, in arrival order. */
const said = []
let settled = false

const finished = new Promise((resolve) => {
  const timer = setTimeout(() => { resolve('timeout') }, TURN_TIMEOUT_MS)
  /**
   * Settle once, on whichever of turn end or timeout comes first.
   * @param {string} outcome - how the turn ended.
   */
  const settle = (outcome) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(outcome)
  }
  mux.on('message', (raw) => {
    let frame
    try {
      frame = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }
    const event = frame.payload?.event ?? frame.event
    if (event === undefined) return
    // Only assistant messages count. The same downlink also carries the user
    // message and the runtime-context snapshot, both of which are text the
    // model received rather than text it produced.
    if (event.type === 'assistant/message') {
      for (const part of event.data?.message?.content ?? []) {
        if (part.type === 'text') said.push(part.text)
      }
    }
    if (event.type === 'turn/end') settle('turn/end')
  })
})

await rpc('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: PROMPT }],
})
console.log(`prompted: ${PROMPT}`)

const outcome = await finished
mux.close()

const answer = said.join('').trim()
console.log(`\n--- model output (${outcome}) ---\n${answer.slice(0, 600)}\n---`)

if (outcome !== 'turn/end' || answer === '') {
  console.error(`FAIL: expected an assistant message before turn/end, got ${outcome} with ${said.length} message part(s)`)
  process.exit(1)
}
console.log('PASS: a real model turn completed through gateway -> tunnel -> sandbox -> model')
process.exit(0)
