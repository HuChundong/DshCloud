/**
 * Which of the two answers on the status stream has to be current.
 *
 * A subscriber is told two different kinds of thing at once. Whether the
 * sandbox is THERE is a fact this process holds — the tunnel registry knows
 * the moment one connects and the moment it goes. What it is DOING is a
 * measurement that has to travel, and is a few seconds old by the time it
 * lands. Only the first has to be current, and it must never be inferred from
 * the second: a report is evidence that a sandbox was alive when it was sent,
 * not that it is alive now.
 *
 * Driven against the module directly, with liveness under the caller's
 * control, because what is under test is which source each field comes from.
 * Through a deployment the two are hard to tell apart — a sandbox that is up
 * and reporting looks the same either way, and the cases that separate them
 * are the ones where reports and reality disagree.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import process from 'node:process'

// `./` beside the gateway tree at /app in the container; `../` from the
// repository, where this sits one level down.
const stats = await import('./gateway/src/stats.js')
  .catch(() => import('../gateway/src/stats.js'))

const SANDBOX = 'liveness-probe-sandbox'

/** Whether the tunnel holds this sandbox, as the registry would answer. */
let live = false
stats.knowsLiveness((sandboxId) => live && sandboxId === SANDBOX)

/** A reading the sandbox might send, in the shape its agent posts. */
const METRICS = {
  cpu_used_pct: 42, cpu_count: 2,
  mem_used: 1e9, mem_total: 4e9,
  disk_used: 1e9, disk_total: 2e10,
}

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
 * Subscribe to the status stream and collect what it says.
 *
 * Enough of a response to be written to, and no more: the module wants
 * headers, a writable body and a request that reports when the browser goes
 * away. `latest()` reads the newest event rather than the whole transcript,
 * because every case here asks what a subscriber would be showing now.
 *
 * @returns {{latest: () => object|undefined, close: () => void}} the subscription.
 */
function subscribe() {
  const sent = []
  const res = Object.assign(new EventEmitter(), {
    writeHead: () => res,
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk) => { sent.push(String(chunk)); return true },
    end: () => {},
  })
  const req = Object.assign(new EventEmitter(), {
    headers: {},
    socket: { setTimeout: () => {}, setNoDelay: () => {}, setKeepAlive: () => {} },
  })
  stats.serveStats(req, res, async () => ({ handle: 'probe-handle', sandboxId: SANDBOX }))
  return {
    latest: () => {
      const line = sent.flatMap((c) => c.split('\n')).filter((l) => l.startsWith('data:')).pop()
      return line === undefined ? undefined : JSON.parse(line.slice(5))
    },
    close: () => req.emit('close'),
  }
}

/** Let the module's own scheduling run before reading what a subscriber sees. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

// Nothing connected. The honest answer before anything has happened, and the
// one an EventSource must be given rather than a status code.
const first = subscribe()
await settle()
check('with no tunnel, the stream opens and says it is not up', () => {
  assert.deepEqual(first.latest(), { ok: false })
})

// The tunnel connects and nothing has been measured yet. This is the case the
// old inference got wrong in the slow direction: it had to wait out a report
// to say what the registry already knew.
live = true
stats.livenessChanged(SANDBOX)
await settle()
check('a tunnel connecting is news at once, with no report yet', () => {
  assert.deepEqual(first.latest(), { ok: true })
})

// Figures arrive and are carried beside the state.
stats.receiveReport(SANDBOX, { metrics: METRICS })
await settle()
check('a report fills in the figures', () => {
  const reading = first.latest()
  assert.equal(reading.ok, true)
  assert.equal(reading.stats.cores, 2)
  assert.equal(Math.round(reading.stats.cpu * 100), 42)
})

// The sandbox goes. This is the case the old inference got wrong in the
// dangerous direction: the last report was recent, so it went on looking
// healthy until a timer decided otherwise.
live = false
stats.livenessChanged(SANDBOX)
await settle()
check('a tunnel going is news at once, however recent the last report', () => {
  assert.equal(first.latest().ok, false)
})

// A reload while it is gone. Keeping the last figures across a refresh is what
// makes a returning tab useful; carrying the state with them is what made it
// lie, since those figures were taken while it was up.
first.close()
await settle()
const second = subscribe()
await settle()
check('a reload is answered immediately rather than waiting for a report', () => {
  assert.notEqual(second.latest(), undefined)
})
check('and says it is gone, though it still shows the last figures', () => {
  const reading = second.latest()
  assert.equal(reading.ok, false)
  assert.equal(reading.stats.cores, 2)
})
second.close()

console.log(failures === 0 ? '\n状态真实性检查全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
