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

const { SandboxManager } = await import('./gateway/src/sandboxes.js')

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
 * @returns {{manager: object, released: string[]}} the manager and the names it reclaims.
 */
function managerWith({ lastUsedAt, lastActiveAt }) {
  const now = Date.now()
  const released = []
  const manager = new SandboxManager({
    gatewayTunnelUrl: 'ws://10.100.0.1:8090/_tunnel',
    env: async () => ({}),
    lastActiveAt: () => (lastActiveAt === undefined ? undefined : now - lastActiveAt),
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

console.log(failures === 0 ? '\n空闲回收检查全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
