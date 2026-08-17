/**
 * The gateway: a backend for the session-bearing surface.
 *
 * nginx is the front door and serves the frontend from disk; it proxies here
 * only what needs a session or a sandbox. The frontend derives its API base and
 * its WebSocket URL from `location.origin`, so everything still has to arrive
 * on one origin — nginx's — which is why nothing here is addressed directly by
 * a browser.
 *
 * Routes:
 *   GET  /login          sign-in form
 *   POST /login          request a code, or answer one and sign in — see sign-in.js
 *   POST /logout         sign out and release the sandbox
 *   GET  /_auth          resolve a session for nginx's auth_request; status only
 *   GET  /whoami         the caller's address, for the account section in Settings
 *   GET  /admin          the administrator's console — see console.js
 *   POST /admin/*        one administrative action, then back to the console
 *   *    /api/*          authenticated; proxied into the caller's sandbox
 *   WS   /api/events.*   authenticated; bridged into the caller's sandbox
 *   WS   /_tunnel        sandbox dial-in
 */

import { readFileSync } from 'node:fs'
import http from 'node:http'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Accounts } from './accounts.js'
import { authenticate, isSecureRequest } from './auth.js'
import { handleConsole } from './console.js'
import { request as cubeRequest } from './cubesandbox.js'
import { connect } from './db.js'
import { canSendEmail } from './email.js'
import { Invites, inviteRequired } from './invites.js'
import { loginPage } from './login-page.js'
import { DIAL_IN_TIMEOUT_MS, SandboxManager } from './sandboxes.js'
import { SendLimit } from './send-limit.js'
import { Settings } from './settings.js'
import { handleSignIn } from './sign-in.js'
import { Tokens, signedOutCookies } from './tokens.js'
import { TunnelServer } from './tunnel-server.js'
import { Verification } from './verification.js'
import { destroyVolume } from './volumes.js'

const PORT = Number(process.env.PORT ?? 8080)
const GATEWAY_TUNNEL_URL = process.env.GATEWAY_TUNNEL_URL ?? `ws://gateway:${PORT}/_tunnel`

/**
 * The harness version shown on the login page — what a tenant is actually
 * running, not a version of the gateway.
 *
 * The images are built from this checkout, so its own version is the honest
 * answer and is used unless the deployment names one explicitly.
 * @returns {string | undefined} the version, or undefined when neither source has one.
 */
function resolveVersion() {
  if (process.env.DSH_VERSION !== undefined && process.env.DSH_VERSION !== '') return process.env.DSH_VERSION
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL('../../repo-package.json', import.meta.url)), 'utf8')).version
  } catch {
    // No checkout metadata in the image; the footer simply omits the version.
    return undefined
  }
}

const DSH_VERSION = resolveVersion()

const sessionSecret = process.env.SESSION_SECRET
if (sessionSecret === undefined || sessionSecret.length < 16) {
  console.error('gateway: SESSION_SECRET must be set and at least 16 characters')
  process.exit(1)
}

// A deployment that cannot send mail cannot sign anybody in, because the code it
// mails is the only credential there is. Said at startup rather than at the
// moment someone asks for a code, when it would look like a bug to them and to
// whoever is on call.
if (!canSendEmail()) {
  console.error('gateway: RESEND_API_KEY is required; without it nobody can sign in')
  process.exit(1)
}
if ((process.env.GATEWAY_ADMINS ?? '') === '') {
  console.warn('gateway: GATEWAY_ADMINS is empty; nobody can reach the user console')
}

// Accounts, invites, refresh tokens, and pending codes live outside the gateway,
// so it keeps no disk state and a restart neither signs everyone out nor forgets
// who registered.
const db = await connect()

const accounts = new Accounts(db)
const invites = new Invites(db)
const settings = new Settings(db)
const tokens = new Tokens(sessionSecret, db)
const verification = new Verification(db)

/**
 * The login page's images, read once at startup. Reading them here rather than
 * per request also means a missing asset fails the boot instead of leaving a
 * broken image on the only page an unauthenticated visitor can reach.
 */
const LOGIN_ASSETS = {
  'mark.svg': {
    type: 'image/svg+xml',
    body: readFileSync(fileURLToPath(new URL('../assets/mark.svg', import.meta.url))),
  },
  'ad.webp': {
    type: 'image/webp',
    body: readFileSync(fileURLToPath(new URL('../assets/ad.webp', import.meta.url))),
  },
}
const sandboxes = new SandboxManager({
  gatewayTunnelUrl: GATEWAY_TUNNEL_URL,
  // Model credentials belong to the deployment, not to the tenant, so they are
  // handed to the sandbox rather than to the browser. Resolved per creation:
  // an administrator who rotates the key in the console has it reach the next
  // sandbox started, not the next time the gateway is restarted.
  env: async () => {
    const credential = await settings.modelCredential()
    return { DEEPSEEK_API_KEY: credential.apiKey, DEEPSEEK_BASE_URL: credential.baseUrl }
  },
  // Read through a closure because the two are mutually dependent — the tunnel
  // server authorizes dial-ins against this manager — and the idle sweep that
  // calls it runs on a timer, long after both are built.
  lastActiveAt: (sandboxId) => tunnels.lastActiveAt(sandboxId),
})
/**
 * What the two page modules are handed.
 *
 * Bundled rather than imported by them, so that everything with a lifetime — the
 * database pool, the sandbox manager — is created once here and the modules stay
 * functions of their inputs.
 */
// What bounds the mail this deployment can be made to send. Held here because
// it is per-process state with a lifetime, like the pool and the manager.
const sendLimit = new SendLimit()
const signInDeps = { accounts, invites, tokens, verification, sendLimit, readBody, version: DSH_VERSION }
const consoleDeps = {
  accounts,
  invites,
  tokens,
  settings,
  sandboxes,
  callerOf,
  readBody,
  destroyVolume: async (accountId) => { await destroyVolume(cubeRequest, accountId) },
  version: DSH_VERSION,
}

const tunnels = new TunnelServer((sandboxId, token) => sandboxes.authorize(sandboxId, token))
const browserSockets = new WebSocketServer({ noServer: true })

/**
 * Resolve the caller behind a request, renewing their tokens if that is what it
 * takes, and setting the renewed cookies on the response.
 *
 * Every route reads its caller through this rather than through `authenticate`
 * directly, so that no route can renew a token and forget to hand it back — a
 * request that spends a refresh token without setting the replacement signs the
 * browser out on its next call.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} [res] - the response to set renewed cookies on.
 * @returns {Promise<{email: string, id: string, admin: boolean} | undefined>} the caller, or undefined when unauthenticated.
 */
async function callerOf(req, res, renewedAsHeaders = false) {
  const resolved = await authenticate(req, tokens, accounts)
  if (resolved === undefined) return undefined
  if (resolved.cookies !== undefined && res !== undefined && !res.headersSent) {
    if (renewedAsHeaders) {
      // For nginx's auth_request. It discards a subrequest's own `Set-Cookie`,
      // and the one variable that can carry a header back —
      // `$upstream_http_set_cookie` — holds only the first of several with the
      // same name, so two cookies need two differently named headers.
      res.setHeader('X-Renew-Access', resolved.cookies[0])
      res.setHeader('X-Renew-Refresh', resolved.cookies[1])
    } else {
      res.setHeader('Set-Cookie', resolved.cookies)
    }
  }
  return resolved.account
}

/**
 * Read a request body with a hard cap.
 *
 * The cap sits above dsh's own 160 MiB `maxRequestBodyBytes` default so the
 * gateway never becomes the component that truncates an upload dsh would have
 * accepted; a request beyond it is refused rather than buffered.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {number} limit - maximum bytes to accept.
 * @returns {Promise<Buffer | undefined>} the body, or undefined when it exceeded the cap.
 */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks)) })
  })
}

/**
 * Resolve the caller's live tunnel, starting their sandbox and waiting for it
 * to dial in when necessary.
 * @param {{email: string, id: string}} caller - the authenticated caller.
 * @returns {Promise<object | undefined>} the tunnel, or undefined when the sandbox never dialed in.
 */
async function tunnelFor(caller) {
  const username = caller.email
  const { sandboxId } = await sandboxes.ensure(username, caller.id)
  sandboxes.touch(username)
  const tunnel = await tunnels.waitFor(sandboxId, DIAL_IN_TIMEOUT_MS)
  if (tunnel !== undefined) return tunnel

  // The sandbox never dialed in, which most often means it is no longer there
  // to dial: it crashed, was OOM-killed, or was removed out from under us.
  // Rebuilding once turns that into a slow request instead of a tenant stuck
  // at 503 until the idle sweep notices.
  //
  // Scoped to the sandbox this call waited on. Requests time out together, so
  // an unscoped forget lets the second one discard the replacement the first
  // just built — and then build another, leaving the tenant with an orphan for
  // every concurrent request.
  await sandboxes.forget(username, sandboxId)
  const rebuilt = await sandboxes.ensure(username, caller.id)
  return await tunnels.waitFor(rebuilt.sandboxId, DIAL_IN_TIMEOUT_MS)
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error(`gateway: ${error.message}`)
    if (!res.headersSent) res.writeHead(500)
    res.end('gateway error')
  })
})

/**
 * Route one HTTP request.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 */
async function handleRequest(req, res) {
  const path = new URL(req.url ?? '/', 'http://gateway').pathname

  if (path === '/login' && req.method === 'GET') {
    // Never cached: the page carries its own styles inline, so a cached copy
    // survives a redeploy and shows the previous design to anyone who has been
    // here before.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(loginPage({ inviteRequired: inviteRequired(), version: DSH_VERSION }))
    return
  }

  // The login page's own images. They are served from the gateway, not the web
  // container, for the same reason the page is: sign-in has to work before any
  // sandbox exists and without the frontend bundle. Anonymous by necessity —
  // they are what an unauthenticated visitor is looking at.
  if (path.startsWith('/login-assets/')) {
    const asset = LOGIN_ASSETS[path.slice('/login-assets/'.length)]
    if (asset === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=3600' })
    res.end(asset.body)
    return
  }

  if (path === '/login' && req.method === 'POST') {
    await handleSignIn(req, res, signInDeps)
    return
  }

  if (path === '/logout' && req.method === 'POST') {
    const caller = await callerOf(req)
    if (caller !== undefined) {
      // Every browser this account has open, not merely the one asking. Signing
      // out on a shared or lost machine is one of the two reasons anyone clicks
      // this, and revoking only the token in hand would leave the other one.
      await tokens.revokeAll(caller.email)
      await sandboxes.release(caller.email).catch((error) => {
        console.error(`gateway: releasing ${caller.email} failed: ${error.message}`)
      })
    }
    res.writeHead(303, { Location: '/login', 'Set-Cookie': signedOutCookies(isSecureRequest(req)) })
    res.end()
    return
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    await handleConsole(path, req, res, consoleDeps)
    return
  }

  // Answers nginx's auth_request for the application shell: a status, no body.
  // The shell needs a session because an unauthenticated visitor who loaded it
  // would watch it retry a 401 forever — the frontend knows nothing about this
  // login page.
  if (path === '/_auth') {
    // Renewed cookies are set on this subrequest's response and nginx copies
    // them onto the page's, which is how a tab whose access token expired while
    // it sat open gets a new one from the reload rather than a login page.
    const caller = await callerOf(req, res, true)
    res.writeHead(caller === undefined ? 401 : 204)
    res.end()
    return
  }

  // Who the caller is. The sandbox cannot answer this — it has no notion of the
  // gateway's tenants — so the account section in Settings reads it from here.
  if (path === '/whoami') {
    const caller = await callerOf(req, res)
    if (caller === undefined) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end('{}')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    // `username` stays the field name: it is what the account section in
    // Settings reads, and the address is what it should show either way.
    res.end(JSON.stringify({ username: caller.email, admin: caller.admin }))
    return
  }

  if (path.startsWith('/api')) {
    const caller = await callerOf(req, res)
    if (caller === undefined) {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('unauthenticated')
      return
    }
    await serveFromSandbox(caller, req, res)
    return
  }

  // The frontend never reaches here: nginx answers it from disk and proxies
  // only the session-bearing surface. Anything else is a path nginx forwarded
  // by mistake, and saying so beats inventing a response for it.
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
}

/**
 * Answer one request from the caller's sandbox.
 * @param {{email: string, id: string}} caller - the authenticated caller.
 * @param {import('node:http').IncomingMessage} req - the browser request.
 * @param {import('node:http').ServerResponse} res - the response to fill.
 */
async function serveFromSandbox(caller, req, res) {
  const tunnel = await tunnelFor(caller)
  if (tunnel === undefined) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('sandbox unavailable')
    return
  }
  tunnel.proxyHttp(req, res)
}

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://gateway').pathname

  if (path === '/_tunnel') {
    tunnels.handleUpgrade(req, socket, head)
    return
  }

  if (!path.startsWith('/api/')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }

  void (async () => {
    // No response object to renew cookies on, so an upgrade whose access token
    // has expired is refused rather than renewed. The browser reopens these
    // downlinks on failure, and by then an ordinary request will have renewed
    // the token — a handshake cannot carry a `Set-Cookie` the page would keep.
    const caller = await callerOf(req)
    if (caller === undefined) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const tunnel = await tunnelFor(caller)
    if (tunnel === undefined) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n')
      socket.destroy()
      return
    }
    const stream = await tunnel.openWebSocket(path, req.headers)
    if (stream === undefined) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      socket.destroy()
      return
    }
    browserSockets.handleUpgrade(req, socket, head, (ws) => { stream.attach(ws) })
  })().catch((error) => {
    console.error(`gateway: upgrade failed: ${error.message}`)
    socket.destroy()
  })
})

await sandboxes.reapOrphans()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`gateway: listening on http://0.0.0.0:${PORT}; anyone with an email address can register`)
})
