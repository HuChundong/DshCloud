/**
 * What bounds the mail this deployment can be made to send.
 *
 * `verification.js` already holds one code per address per minute, which stops
 * one address being flooded. It does not stop an address being *cycled*: the
 * sign-in form takes any address and the code goes to it, so without a second
 * bound the deployment is a way to send mail from this domain to anyone, at
 * whatever rate the caller likes. The cost lands on the sending domain's
 * reputation before it lands on the mail provider's quota.
 *
 * Two counters, deliberately different in what they count:
 *
 * - **Per caller**, counting *requests*. It bounds one source regardless of how
 *   many addresses it names, and it is checked before anything else so a
 *   flood costs a map lookup rather than a database round trip.
 * - **Deployment-wide**, counting *sends*. It is the backstop: whatever gets
 *   past the first counter, this is the most mail that can leave in an hour.
 *   It fails closed, because a deployment that has already sent its hour's
 *   worth of mail to strangers should stop rather than continue.
 *
 * Held in memory, which is honest about what this gateway is: the live tunnels
 * are sockets dialled to one process, so a second replica could not serve those
 * tenants anyway. A restart forgives everyone, which is the right trade for a
 * counter whose job is to blunt a flood rather than to bill for it.
 */

import process from 'node:process'

/** How long each counter looks back. */
const WINDOW_MS = 60 * 60 * 1000

/** How often expired entries are dropped, so an address-cycling caller cannot grow the map without bound. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000

/**
 * One sliding window of timestamps.
 */
class Window {
  constructor() {
    /** @type {number[]} */
    this.hits = []
  }

  /**
   * Whether one more fits, recording it when it does.
   * @param {number} limit - the most allowed in the window.
   * @returns {boolean} whether this one is allowed.
   */
  admit(limit) {
    const cutoff = Date.now() - WINDOW_MS
    // Timestamps are appended in order, so the expired ones are a prefix.
    let first = 0
    while (first < this.hits.length && this.hits[first] <= cutoff) first += 1
    if (first > 0) this.hits.splice(0, first)
    if (this.hits.length >= limit) return false
    this.hits.push(Date.now())
    return true
  }

  /**
   * Whether this window has nothing left in it.
   * @returns {boolean} whether it can be forgotten.
   */
  get empty() {
    return this.hits.length === 0 || this.hits[this.hits.length - 1] <= Date.now() - WINDOW_MS
  }
}

export class SendLimit {
  /**
   * @param {object} [options] - the ceilings, in an hour.
   * @param {number} [options.perCaller] - code requests one caller may make.
   * @param {number} [options.total] - messages the deployment may send.
   */
  constructor(options = {}) {
    this.perCaller = options.perCaller ?? Number(process.env.LOGIN_REQUESTS_PER_IP_PER_HOUR ?? 20)
    this.total = options.total ?? Number(process.env.LOGIN_SENDS_PER_HOUR ?? 200)
    /** @type {Map<string, Window>} */
    this.callers = new Map()
    this.sends = new Window()
    this.sweep = setInterval(() => { this.forgetIdle() }, SWEEP_INTERVAL_MS)
    this.sweep.unref()
  }

  /**
   * Whether this caller may ask for another code.
   * @param {string} caller - the client address.
   * @returns {boolean} whether the request is within the per-caller ceiling.
   */
  allowRequest(caller) {
    let window = this.callers.get(caller)
    if (window === undefined) {
      window = new Window()
      this.callers.set(caller, window)
    }
    return window.admit(this.perCaller)
  }

  /**
   * Whether the deployment may send another message.
   *
   * Asked immediately before sending rather than when the request arrives, so
   * the budget counts mail that actually left.
   *
   * @returns {boolean} whether the send is within the deployment ceiling.
   */
  allowSend() {
    return this.sends.admit(this.total)
  }

  /** Drop callers whose window has emptied, so the map tracks the last hour rather than every address ever seen. */
  forgetIdle() {
    for (const [caller, window] of this.callers) {
      if (window.empty) this.callers.delete(caller)
    }
  }
}

/**
 * The address to hold a caller to.
 *
 * nginx appends the peer it saw to `X-Forwarded-For`, so the last entry is the
 * one it observed and everything before it is whatever the client chose to
 * claim. Taking the last is what makes the header unforgeable here — and it is
 * only right because exactly one proxy sits in front. A second one would make
 * the second-to-last the real client, and reading this without adjusting it
 * would hold every caller to the same bucket.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {string} the client address, or the socket's peer when the header is absent.
 */
export function callerAddress(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    const hops = forwarded.split(',')
    return hops[hops.length - 1].trim()
  }
  return req.socket.remoteAddress ?? 'unknown'
}
