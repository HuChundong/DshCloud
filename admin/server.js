/**
 * The operator's console, as a deployment of its own.
 *
 * It used to be a route on the gateway — the same process, the same port, the
 * same session as every tenant — reachable to anyone who guessed the path and
 * kept private by answering 404 to everybody else. That is hiding, not
 * isolating, and what was hidden can rotate the model credential every
 * tenant's agent calls with.
 *
 * So it is a service. Its own image, its own port, its own domain, its own
 * credential, and an expectation that it is published somewhere a tenant
 * cannot reach at all.
 *
 * ## What it owns and what it does not
 *
 * It owns accounts, invite codes, tiers and deployment settings: it writes
 * them, and the gateway reads them. That division is what keeps this from
 * being one system split across two processes, and it holds today because the
 * gateway's own writes are to different things — the row it creates when
 * somebody registers, their tokens, their challenges, their sandbox.
 *
 * It does NOT manage sandboxes. Their lifecycle belongs to the platform
 * underneath and to the gateway that talks to it, and two writers to a
 * machine's existence is the coupling this separation exists to avoid. Where
 * an action here has consequences for one — suspending an account, erasing it
 * — this tells the gateway what happened and the gateway acts.
 *
 * @module admin/server
 */

import { createServer } from 'node:http'
import process from 'node:process'

import { Accounts } from '../gateway/src/accounts.js'
import { connect } from '../gateway/src/db.js'
import { Invites } from '../gateway/src/invites.js'
import { ASSET_PREFIX, assetFor } from '../gateway/src/page-assets.js'
import { Settings } from '../gateway/src/settings.js'
import { USERNAME, canSignIn, failed, mayAttempt, succeeded, verify } from './auth.js'
import { canIssue, cookie, issue, signedIn } from './session.js'
import * as challenge from './challenge.js'
import { SecondFactor } from './second-factor.js'
import { handleConsole } from './console.js'
import { signInPage } from './sign-in-page.js'

const PORT = Number(process.env.ADMIN_PORT ?? 8091)

if (!canSignIn()) {
  console.error('admin: ADMIN_PASSWORD_HASH must be set — run `node admin/hash-password.mjs`')
  console.error('admin: refusing to start rather than starting with a default, which is a published password')
  process.exit(1)
}
if (!canIssue()) {
  console.error('admin: ADMIN_SESSION_SECRET must be set and at least 16 characters')
  process.exit(1)
}
const db = await connect()
const accounts = new Accounts(db)
const invites = new Invites(db)
const settings = new Settings(db)
const secondFactor = new SecondFactor(db)

if (!await secondFactor.required()) {
  // Loud, and every start. A console published anywhere a stranger can reach
  // it, behind one password that never changes, is the shape of the breaches
  // this service exists to make less likely — and the address announces
  // itself, since a certificate for a name is published to transparency logs
  // the moment it is issued.
  console.warn('admin: no second factor — a single password is the only thing between the internet and every account')
  console.warn('admin: sign in and turn one on, which takes a phone and about thirty seconds')
}

/**
 * Who is asking, for the attempt limit.
 *
 * The last hop, because exactly one proxy is expected in front and it appends
 * the peer it received the connection from — the same reading the gateway
 * makes, and wrong in the same way if a second proxy is ever added.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {string} the address.
 */
const callerAddress = (req) => {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    return forwarded.split(',').at(-1).trim()
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Whether the request arrived over TLS, as the proxy in front reports it. */
const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https'

/**
 * Read a form body, with a ceiling.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {number} limit - the most bytes to accept.
 * @returns {Promise<Buffer|undefined>} the body, or nothing when it was too big.
 */
const readBody = async (req, limit) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Ask the gateway to do the part of an account change that only it can.
 *
 * Sandboxes and volumes belong to the runtime plane: this service holds no
 * connection to a platform and should not grow one. So it says what happened
 * and the gateway acts.
 *
 * Whether that is allowed to fail depends on what was said, and the caller
 * decides — which is why this returns an answer rather than swallowing one.
 * A suspension may fail here: the tokens are already gone, so nothing reaches
 * the machine, and the idle sweep collects it. A deletion may not: a volume
 * holds a tenant's files, and reporting a deletion that left them behind is
 * the one promise the console must not break.
 *
 * @param {string} event - `suspended` or `deleted`.
 * @param {string} email - whose account.
 * @param {object} [extra] - anything the event needs beyond the address.
 * @returns {Promise<boolean>} whether the gateway acknowledged it.
 */
const tellGateway = async (event, email, extra = {}) => {
  const url = process.env.GATEWAY_INTERNAL_URL ?? ''
  const secret = process.env.INTERNAL_SHARED_SECRET ?? ''
  if (url === '' || secret === '') {
    console.error(`admin: no internal channel configured, so the gateway was not told about ${email}`)
    return false
  }
  try {
    const response = await fetch(`${url}/_internal/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
      body: JSON.stringify({ event, email, ...extra }),
    })
    if (!response.ok) {
      console.error(`admin: the gateway refused ${event} for ${email}: HTTP ${String(response.status)}`)
      return false
    }
    return true
  } catch (error) {
    console.error(`admin: could not tell the gateway about ${email}: ${error.message}`)
    return false
  }
}

const deps = { accounts, invites, settings, secondFactor, db, readBody, tellGateway, version: process.env.DSH_VERSION }

/**
 * The headers every response here carries.
 *
 * Set by this service and not only by whatever proxies it, because a header
 * that only exists in the proxy is a header that is missing the moment
 * somebody reaches the container directly — which is exactly the situation
 * they are for.
 *
 * `frame-ancestors 'none'` and `X-Frame-Options` say the same thing twice on
 * purpose: clickjacking a console that suspends accounts is worth the
 * duplication, and the two are read by different vintages of browser.
 */
const HARDENING = {
  // `connect-src 'self'` is not a loosening: without it `default-src 'none'`
  // refuses every fetch this page makes, which is every action it takes in
  // place and every section it navigates to without reloading. Both fell back
  // to a full page load and neither said why — the console worked, slowly, and
  // the reason was in the browser's console rather than in any log here.
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; "
    + "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Nothing here needs a camera, a microphone or a location, and saying so is
  // cheaper than auditing what a future page might ask for.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  // Never indexed, and said in a header as well as in a meta tag: a crawler
  // that only fetches headers still learns to stay away.
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Cache-Control': 'no-store',
}

const server = createServer((req, res) => {
  void (async () => {
    for (const [name, value] of Object.entries(HARDENING)) res.setHeader(name, value)
    // Told only over TLS, because a browser must not be taught to insist on
    // https by something it reached over http.
    if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')

    const path = (req.url ?? '/').split('?')[0]

    // The brand files, served before anyone is admitted: the sign-in page shows
    // the wordmark and the mark, so a gate in front of these would put a broken
    // image on the only page an operator sees before they are one. Nothing here
    // is a secret — the landing page serves the same two files to the public.
    //
    // Answered here rather than by the proxy in front, because this service is
    // the thing that knows the hashes.
    if (path.startsWith(ASSET_PREFIX)) {
      const file = assetFor(path)
      if (file === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
        return
      }
      // The name carries the content hash, so it can be cached hard. This is
      // the one thing here that overrides the no-store the hardening sets.
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=31536000, immutable' })
      res.end(file.body)
      return
    }

    if (path === '/sign-in' && req.method === 'POST') {
      const address = callerAddress(req)
      if (!mayAttempt(address)) {
        res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(signInPage({ error: 'too-many' }))
        return
      }
      const form = new URLSearchParams((await readBody(req, 4096))?.toString('utf8') ?? '')
      const open = await challenge.read(req)

      // ---- second step: the code, from somebody who cleared the first ----
      if (open !== undefined) {
        if (!await secondFactor.accepts(form.get('code') ?? '')) {
          // Two counters, and they answer different questions. The address
          // limiter asks how hard this caller is trying; the challenge counter
          // asks how many guesses one correct password is worth.
          failed(address)
          const stillOpen = challenge.failed(open)
          console.warn(`admin: wrong code from ${address}${stillOpen ? '' : ' — challenge burned'}`)
          res.writeHead(401, {
            'Content-Type': 'text/html; charset=utf-8',
            ...stillOpen ? {} : { 'Set-Cookie': challenge.cookie(undefined, isSecure(req)) },
          })
          res.end(signInPage(stillOpen ? { step: 'code', error: 'code' } : { error: 'spent' }))
          return
        }
        // Spent whether or not anything else goes wrong from here: a challenge
        // is worth exactly one successful code.
        challenge.spend(open)
        succeeded(address)
        console.log(`admin: ${USERNAME} signed in from ${address}`)
        res.writeHead(303, {
          Location: '/',
          'Set-Cookie': [cookie(await issue(), isSecure(req)), challenge.cookie(undefined, isSecure(req))],
        })
        res.end()
        return
      }

      // ---- first step: the password ----
      if (!await verify(form.get('username') ?? '', form.get('password') ?? '')) {
        failed(address)
        console.warn(`admin: refused a sign-in from ${address}`)
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(signInPage({ error: 'refused' }))
        return
      }

      // Nothing to ask for. `succeeded` only here and at the end of the second
      // step — resetting the address counter after the password would make one
      // correct password buy a fresh budget of code guesses.
      if (!await secondFactor.required()) {
        succeeded(address)
        console.log(`admin: ${USERNAME} signed in from ${address} (no second factor configured)`)
        res.writeHead(303, { Location: '/', 'Set-Cookie': cookie(await issue(), isSecure(req)) })
        res.end()
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': challenge.cookie(await challenge.issue(), isSecure(req)),
      })
      res.end(signInPage({ step: 'code' }))
      return
    }

    if (path === '/sign-out') {
      // Both cookies. This is also the way back from the code step for
      // somebody who started signing in and changed their mind, so it has to
      // clear a half-finished sign-in as well as a finished one.
      res.writeHead(303, {
        Location: '/sign-in',
        'Set-Cookie': [cookie(undefined, isSecure(req)), challenge.cookie(undefined, isSecure(req))],
      })
      res.end()
      return
    }

    if (!await signedIn(req)) {
      // The sign-in form, whatever was asked for. There is nothing here to
      // show an operator who is not one, and no reason to say what exists.
      //
      // Shown at whichever step the caller has reached, so a reload during the
      // second step does not silently drop them back to the first with a
      // challenge cookie still open.
      const open = await challenge.read(req)
      res.writeHead(path === '/sign-in' ? 200 : 401, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(signInPage(open === undefined ? {} : { step: 'code' }))
      return
    }

    await handleConsole(path, req, res, deps)
  })().catch((error) => {
    console.error(`admin: ${req.method} ${req.url} failed: ${error.message}`)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('something went wrong')
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`admin: listening on http://0.0.0.0:${String(PORT)} as ${USERNAME}`)
  console.log('admin: publish this where tenants cannot reach it — one credential here opens every account')
})
