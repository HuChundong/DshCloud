/**
 * What the idle sweep reclaims, and what it must leave alone.
 *
 * Drives `SandboxManager` directly rather than a real sandbox: the case that
 * matters takes longer than the idle TTL by definition, so observing it through
 * a deployment would mean waiting out the TTL to learn the answer. Both clocks
 * it decides on are handed in instead.
 *
 * `release` is replaced on the instance, because what is under test is the
 * decision rather than the reclamation — the runtime call it makes is the same
 * one the acceptance run already exercises against a live sandbox.
 */

import assert from 'node:assert/strict'
import process from 'node:process'

/** The TTL these cases are written against, set before the module reads it. */
const TTL_MS = 30 * 60 * 1000
process.env.SANDBOX_IDLE_TTL_MS = String(TTL_MS)

// `./` beside the gateway tree at /app in the container; `../` from the
// repository, where this sits one level down.
const { SandboxManager } = await import('./gateway/src/sandboxes.js')
  .catch(() => import('../gateway/src/sandboxes.js'))

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

/**
 * A manager holding one sandbox for `alice`, with both activity signals under
 * the caller's control.
 *
 * @param {object} times - the two signals.
 * @param {number} times.lastUsedAt - when a request last started, as an age in milliseconds.
 * @param {number | undefined} times.lastActiveAt - when a frame last crossed the tunnel, as an age in milliseconds; undefined when no tunnel is connected.
 * @param {boolean} [times.attached] - whether a browser holds the event socket.
 * @param {boolean} [times.busy] - whether anything is working inside the sandbox.
 * @param {boolean} [times.tunnel] - whether a tunnel is connected at all.
 * @returns {{manager: object, released: string[]}} the manager and the names it reclaims.
 */
function managerWith({ lastUsedAt, lastActiveAt, attached = true, busy = false, tunnel = true }) {
  const now = Date.now()
  const released = []
  const manager = new SandboxManager({
    gatewayTunnelUrl: 'ws://10.100.0.1:8090/_tunnel',
    env: async () => ({}),
    lastActiveAt: () => (lastActiveAt === undefined ? undefined : now - lastActiveAt),
    presenceOf: () => (tunnel ? { attached, busy } : undefined),
  })
  clearInterval(manager.timer)
  manager.byUser.set('alice', {
    sandboxId: 'sandbox-1',
    token: 't',
    handle: 'h',
    lastUsedAt: now - lastUsedAt,
  })
  manager.release = async (username) => {
    released.push(username)
    manager.byUser.delete(username)
  }
  return { manager, released }
}

const MINUTE = 60 * 1000

console.log('=== the idle sweep ===')

{
  // The regression this exists for. One agent turn can run for hours; it is
  // driven over a socket opened when it started, so no new request arrives for
  // as long as it runs. Reaping on request age alone destroys the sandbox with
  // the turn's work still inside it.
  const { manager, released } = managerWith({ lastUsedAt: 90 * MINUTE, lastActiveAt: 5 * MINUTE })
  await manager.reapIdle()
  check('spares a sandbox streaming a long turn', () => { assert.deepEqual(released, []) })
}

{
  // The case reclamation exists for, and the one an activity signal could
  // easily break: a browser tab left open holds its socket open too. The tunnel
  // carries no heartbeat, so an abandoned tab falls silent and still ages out.
  const { manager, released } = managerWith({ lastUsedAt: 90 * MINUTE, lastActiveAt: 90 * MINUTE })
  await manager.reapIdle()
  check('reclaims an abandoned sandbox whose socket is still open', () => {
    assert.deepEqual(released, ['alice'])
  })
}

{
  const { manager, released } = managerWith({ lastUsedAt: 90 * MINUTE, lastActiveAt: undefined })
  await manager.reapIdle()
  check('reclaims one whose tunnel is gone', () => { assert.deepEqual(released, ['alice']) })
}

{
  const { manager, released } = managerWith({ lastUsedAt: 1 * MINUTE, lastActiveAt: 90 * MINUTE })
  await manager.reapIdle()
  check('spares one requested recently but quiet since', () => { assert.deepEqual(released, []) })
}

{
  const { manager, released } = managerWith({ lastUsedAt: 29 * MINUTE, lastActiveAt: 29 * MINUTE })
  await manager.reapIdle()
  check('spares one just inside the TTL', () => { assert.deepEqual(released, []) })
}

console.log('\n=== the two questions "idle" turns out to be ===')

{
  // The case traffic cannot see at all: a long turn with the page closed sends
  // nothing through the tunnel, and judging on traffic alone destroys it.
  const { manager, released } = managerWith({
    lastUsedAt: 90 * MINUTE, lastActiveAt: 90 * MINUTE, attached: false, busy: true,
  })
  await manager.reapIdle()
  check('spares a working sandbox nobody is watching', () => { assert.deepEqual(released, []) })
}

{
  const { manager, released } = managerWith({
    lastUsedAt: 10 * MINUTE, lastActiveAt: 10 * MINUTE, attached: false, busy: false,
  })
  await manager.reapIdle()
  check('reclaims an idle one once the page is closed', () => {
    assert.deepEqual(released, ['alice'])
  })
}

{
  // The same age, but the tenant is still sitting there. They keep the long TTL.
  const { manager, released } = managerWith({
    lastUsedAt: 10 * MINUTE, lastActiveAt: 10 * MINUTE, attached: true, busy: false,
  })
  await manager.reapIdle()
  check('spares that same age while the page is open', () => { assert.deepEqual(released, []) })
}

{
  const { manager, released } = managerWith({
    lastUsedAt: 2 * MINUTE, lastActiveAt: 2 * MINUTE, attached: false, busy: false,
  })
  await manager.reapIdle()
  check('and spares one only just closed', () => { assert.deepEqual(released, []) })
}

{
  // No tunnel means nothing to ask, so it falls back to the departed TTL: a
  // sandbox that never dialled in is not one somebody is watching.
  const { manager, released } = managerWith({
    lastUsedAt: 10 * MINUTE, lastActiveAt: undefined, tunnel: false,
  })
  await manager.reapIdle()
  check('reclaims one whose tunnel never arrived', () => { assert.deepEqual(released, ['alice']) })
}

console.log('\n=== coming back ===')

{
  // Closed the tab, then reopened it before the short TTL ran out. Reopening
  // is requests and a fresh event socket, so both clocks move and the ceiling
  // goes back to the long one — there is no lifetime counted from creation.
  const { manager, released } = managerWith({
    lastUsedAt: 4 * MINUTE, lastActiveAt: 4 * MINUTE, attached: false, busy: false,
  })
  await manager.reapIdle()
  check('a tab closed four minutes ago is still there', () => {
    assert.deepEqual(released, [])
  })
  // What reopening does to the record: a request touches it and the socket
  // attaches.
  manager.byUser.get('alice').lastUsedAt = Date.now()
  manager.options.presenceOf = () => ({ attached: true, busy: false })
  manager.options.lastActiveAt = () => Date.now()
  await manager.reapIdle()
  check('and reopening puts it back on the long TTL', () => {
    assert.deepEqual(released, [])
  })
  // Twenty minutes later it is still inside the idle TTL, which it would not
  // have been had the clock kept running from before the tab closed.
  manager.byUser.get('alice').lastUsedAt = Date.now() - 20 * MINUTE
  manager.options.lastActiveAt = () => Date.now() - 20 * MINUTE
  await manager.reapIdle()
  check('twenty minutes after that, still not reclaimed', () => {
    assert.deepEqual(released, [])
  })
}

console.log(failures === 0 ? '\n空闲回收检查全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
