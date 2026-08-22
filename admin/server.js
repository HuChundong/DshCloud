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
import { accepts, required as totpRequired } from './totp.js'
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
if (!totpRequired()) {
  // Loud, and every start. A console published anywhere a stranger can reach
  // it, behind one password that never changes, is the shape of the breaches
  // this service exists to make less likely — and the address announces
  // itself, since a certificate for a name is published to transparency logs
  // the moment it is issued.
  console.warn('admin: ADMIN_TOTP_SECRET is not set — a single password is the only thing between the internet and every account')
  console.warn('admin: run `node admin/totp-secret.mjs` and set it')
}

const db = await connect()
const accounts = new Accounts(db)
const invites = new Invites(db)
const settings = new Settings(db)

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
 * Tell the gateway an account is gone or suspended, so it can act on the
 * machine that belongs to it.
 *
 * One direction only: this says what happened, and the gateway decides what
 * that means for a sandbox. It is allowed to fail — an operator's action must
 * not be refused because another service is restarting — and the gateway
 * reaches the same state on its own eventually, through the idle sweep and
 * through refusing a suspended account at sign-in.
 *
 * @param {string} event - `suspended` or `erased`.
 * @param {string} email - whose account.
 * @returns {Promise<void>} resolves whether or not it was delivered.
 */
const tellGateway = async (event, email) => {
  const url = process.env.GATEWAY_INTERNAL_URL ?? ''
  const secret = process.env.INTERNAL_SHARED_SECRET ?? ''
  if (url === '' || secret === '') return
  try {
    await fetch(`${url}/_internal/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
      body: JSON.stringify({ event, email }),
    })
  } catch (error) {
    console.error(`admin: could not tell the gateway about ${email}: ${error.message}`)
  }
}

const deps = { accounts, invites, settings, readBody, tellGateway, version: process.env.DSH_VERSION }

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
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self' 'unsafe-inline'; font-src 'self' data:; form-action 'self'; "
    + "base-uri 'none'; frame-ancestors 'none'",
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
        res.end(signInPage({ error: 'too-many', totp: totpRequired() }))
        return
      }
      const form = new URLSearchParams((await readBody(req, 4096))?.toString('utf8') ?? '')
      // Both factors checked before either verdict is acted on, so the time
      // this takes says nothing about which one was wrong — and a wrong
      // password costs an attacker a code as well.
      const passwordOk = await verify(form.get('username') ?? '', form.get('password') ?? '')
      const codeOk = accepts(form.get('code') ?? '')
      const admitted = passwordOk && codeOk
      if (!admitted) {
        failed(address)
        console.warn(`admin: refused a sign-in from ${address}`)
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(signInPage({ error: 'refused', totp: totpRequired() }))
        return
      }
      succeeded(address)
      console.log(`admin: ${USERNAME} signed in from ${address}`)
      res.writeHead(303, { Location: '/', 'Set-Cookie': cookie(await issue(), isSecure(req)) })
      res.end()
      return
    }

    if (path === '/sign-out') {
      res.writeHead(303, { Location: '/sign-in', 'Set-Cookie': cookie(undefined, isSecure(req)) })
      res.end()
      return
    }

    if (!await signedIn(req)) {
      // The sign-in form, whatever was asked for. There is nothing here to
      // show an operator who is not one, and no reason to say what exists.
      res.writeHead(path === '/sign-in' ? 200 : 401, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(signInPage({ totp: totpRequired() }))
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
