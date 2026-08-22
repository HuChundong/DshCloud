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
 *   GET  /whoami         the caller's address and profile, for the account section in Settings
 *   GET  /profile        the tenant's name and picture — see profile.js
 *   *    /secrets        the tenant's own sandbox environment — see secrets.js
 *   POST /sandbox/restart  throw this tenant's sandbox away; the next request rebuilds it
 *   POST /profile        set them, then into the application
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
import { Accounts, hasProfile } from './accounts.js'
import { authenticate, isSecureRequest } from './auth.js'
import { entitlementsOf } from './entitlements.js'
import { request as cubeRequest } from './e2b.js'
import { connect } from './db.js'
import { canSendEmail } from './email.js'
import { Invites } from './invites.js'
import { loginPage } from './login-page.js'
import { ASSET_PREFIX, assetFor } from './page-assets.js'
import { POLICY_SLUGS, policyPage } from './policy-page.js'
import { handlePanel } from './panel.js'
import { DEFAULT_PLAN } from './plans.js'
import { TERMINAL_PATH, serveTerminal } from './terminal.js'
import { handleProfile } from './profile.js'
import { DIAL_IN_TIMEOUT_MS, SandboxManager } from './sandboxes.js'
import { Secrets, nameProblem } from './secrets.js'
import { SendLimit } from './send-limit.js'
import { Settings } from './settings.js'
import { REPORT_PATH, knowsLiveness, livenessChanged, receiveReport } from './stats.js'
import { handleSignIn } from './sign-in.js'
import { Tokens, signedOutCookies } from './tokens.js'
import { TunnelServer } from './tunnel-server.js'
import { Verification } from './verification.js'
import { destroyVolume, volumesEnabled } from './volumes.js'

/**
 * The addresses that are the application itself, as the browser asks for them.
 *
 * The profile gate in `/_auth` applies to these and to nothing else: they are
 * the requests a person makes by arriving, where being sent somewhere first is
 * a redirect rather than a broken asset.
 */
const SHELL_DOCUMENTS = new Set(['/app'])

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
  // Not about the console any more. The operator's console is a separate
  // service with its own credential, and nobody reaches it by being named
  // here. What this list still does is mark accounts, and stand in for
  // POLICY_CONTACT when that is unset — so an empty one means the policy pages
  // name nobody to write to.
  console.warn('gateway: GATEWAY_ADMINS is empty; the policy pages will name no contact unless POLICY_CONTACT is set')
}

/**
 * The first of these that was actually given.
 *
 * Not `??`, which asks whether a variable EXISTS. What matters for a
 * deployment's configuration is whether it was FILLED IN, and compose hands
 * every optional variable over as an empty string either way.
 *
 * @param {...(string|undefined)} values - candidates, in order of preference.
 * @returns {string} the first non-empty one, or an empty string.
 */
function firstOf(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

/**
 * Where a tenant reaches whoever runs this deployment.
 *
 * The policy pages have to name somebody: a data notice that grants rights and
 * gives no way to exercise them grants nothing. It defaults to the first
 * administrator, because that address is already the deployment's owner and is
 * already in its configuration — naming it twice would be one more thing to
 * keep in step. `POLICY_CONTACT` overrides it for a deployment that would
 * rather publish a role address than a person's.
 *
 * An empty override is not an override. Compose passes this through as
 * `${POLICY_CONTACT:-}`, so a deployment that never set it still has it as an
 * empty string — and `??` falls back only on `undefined`, so that empty string
 * would be taken as the answer and the document would name nobody.
 */
const POLICY_CONTACT = firstOf(process.env.POLICY_CONTACT, process.env.GATEWAY_ADMINS)
  .split(',')[0]
  .trim()

// Accounts, invites, refresh tokens, and pending codes live outside the gateway,
// so it keeps no disk state and a restart neither signs everyone out nor forgets
// who registered.
const db = await connect()

const accounts = new Accounts(db)
const invites = new Invites(db)
const settings = new Settings(db)
const tokens = new Tokens(sessionSecret, db)
const secrets = new Secrets(db)
const verification = new Verification(db)

/**
 * The login page's images, read once at startup. Reading them here rather than
 * per request also means a missing asset fails the boot instead of leaving a
 * broken image on the only page an unauthenticated visitor can reach.
 */
const sandboxes = new SandboxManager({
  db,
  gatewayTunnelUrl: GATEWAY_TUNNEL_URL,
  // What this tenant is allowed, resolved here because this is the one place
  // that knows both an account and a sandbox. The manager stays ignorant of
  // plans, the way it is already ignorant of credentials.
  //
  // This is the seam the deployment will be split along: today the answer
  // comes from a table compiled into the process, and when a commerce plane
  // exists it comes from there instead, with nothing else changing. An account
  // that cannot be read resolves to the default tier rather than to nothing —
  // a tenant whose row is briefly unreadable gets the deployment's own
  // behaviour, not a sandbox with no entitlements at all.
  entitlementsFor: async (username) => entitlementsOf(await accounts.read(username).catch(() => undefined)),
  // Model credentials belong to the deployment, not to the tenant, so they are
  // handed to the sandbox rather than to the browser. Resolved per creation:
  // an administrator who rotates the key in the console has it reach the next
  // sandbox started, not the next time the gateway is restarted.
  env: async () => {
    const credential = await settings.modelCredential()
    return {
      DEEPSEEK_API_KEY: credential.apiKey,
      DEEPSEEK_BASE_URL: credential.baseUrl,
      // Deployment shape rather than a credential, which is why it comes from
      // the environment and not from the console: rotating a key is an
      // operational act, while changing which provider serves the deployment
      // changes what models exist and what they are called.
      MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? '',
    }
  },
  // The tenant's own environment, read at creation like the credential above:
  // a secret added in Settings reaches the next sandbox, not the one already
  // running, because an environment is fixed when a process starts.
  secrets: async (username) => await secrets.environment(username),
  // Read through a closure because the two are mutually dependent — the tunnel
  // server authorizes dial-ins against this manager — and the idle sweep that
  // calls it runs on a timer, long after both are built.
  lastActiveAt: (sandboxId) => tunnels.lastActiveAt(sandboxId),
  presenceOf: (sandboxId) => tunnels.presenceOf(sandboxId),
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
const signInDeps = { accounts, invites, settings, sandboxes, tokens, verification, sendLimit, readBody, version: DSH_VERSION }
const profileDeps = {
  accounts,
  callerOf,
  readBody,
  // What closing an account takes with it. The same four the console's own
  // delete uses, because both hand them to `eraseAccount`.
  tokens,
  sandboxes,
  destroyVolume: async (accountId) => { await destroyVolume(cubeRequest, accountId) },
  version: DSH_VERSION,
}

const tunnels = new TunnelServer(
  (sandboxId, token) => sandboxes.authorize(sandboxId, token),
  // Whether a sandbox is up is known here the instant it changes, so the
  // status bar is told from here rather than left to infer it from how
  // recently the sandbox last reported.
  (sandboxId) => { livenessChanged(sandboxId) },
)
knowsLiveness((sandboxId) => tunnels.has(sandboxId))
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

  // What a sandbox has to say about itself.
  //
  // First, because it carries no session — it is answered by the credentials
  // the sandbox dials the tunnel with, and those are the only thing this route
  // trusts. It trusts them about IDENTITY and nothing else: a tenant is root
  // inside their own sandbox, so the token is not a secret from them, and
  // everything past this point is written on the assumption that the sender
  // may be hostile. See `receiveReport` for the three guards that follow from
  // that, and for why a refusal here answers rather than hangs up.
  if (path === REPORT_PATH && req.method === 'POST') {
    const sandboxId = req.headers['x-sandbox-id']
    const token = req.headers['x-sandbox-token']
    if (typeof sandboxId !== 'string' || typeof token !== 'string' || !sandboxes.authorize(sandboxId, token)) {
      res.writeHead(401)
      res.end()
      return
    }
    // Read whatever was sent even when it will be ignored: leaving a body
    // unread is what breaks the connection this wants kept.
    const body = await readBody(req, 256 * 1024)
    let report = {}
    try {
      report = JSON.parse(body?.toString('utf8') ?? '{}')
    } catch {
      // A malformed report is one report lost, not a reason to say anything:
      // the answer below still tells a healthy sandbox how often to speak.
    }
    const answer = receiveReport(sandboxId, report)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(answer))
    return
  }

  if (path === '/login' && req.method === 'GET') {
    // Never cached: the page carries its own styles inline, so a cached copy
    // survives a redeploy and shows the previous design to anyone who has been
    // here before.
    //
    // `done` is how something that redirected here says what it did — closing
    // an account is the one thing that does, and it has nowhere else to say it,
    // the page it was on having ceased to belong to anyone. It is rendered as
    // escaped text by the toast, and carried in the URL rather than in a
    // session, there no longer being one.
    const done = new URL(req.url ?? '/', 'http://gateway').searchParams.get('done') ?? undefined
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(loginPage({
      notice: done,
      inviteRequired: (await settings.access()).inviteRequired,
      version: DSH_VERSION,
    }))
    return
  }

  // The deployment's terms, data notice and safe-use policy. Anonymous by
  // necessity: they are what someone reads before agreeing to them, which is
  // before they have an account. Served from the gateway like the sign-in page
  // they are linked from, so that a deployment whose frontend is not up still
  // shows the documents its sign-in form asks people to accept.
  if (path.startsWith('/policy') && req.method === 'GET') {
    const slug = path.slice('/policy/'.length)
    if (!POLICY_SLUGS.includes(slug)) {
      res.writeHead(303, { Location: `/policy/${POLICY_SLUGS[0]}` })
      res.end()
      return
    }
    // Cacheable, briefly. These are the same bytes for everyone and change a
    // few times a year, but a stale copy of a document someone is agreeing to
    // is worth less than the request it saves.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
    res.end(policyPage(slug, { contact: POLICY_CONTACT, version: DSH_VERSION }))
    return
  }

  // The login page's own images. They are served from the gateway, not the web
  // container, for the same reason the page is: sign-in has to work before any
  // sandbox exists and without the frontend bundle. Anonymous by necessity —
  // they are what an unauthenticated visitor is looking at.
  if (path.startsWith(ASSET_PREFIX)) {
    const file = assetFor(path)
    if (file === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    // Forever, because the name carries the bytes' hash: a different file is a
    // different URL, so this one can never go stale. It was an hour under a
    // fixed name, which is the arrangement where replacing the mark reached
    // the front door at once and this page whenever the hour happened to be up.
    res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=31536000, immutable' })
    res.end(file.body)
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

  // What the operator's console tells this process about an account it
  // changed.
  //
  // The console is a service of its own now, on its own port and its own
  // credential, and it owns accounts, tiers, invites and settings. What it
  // does not own is a machine: whether a suspended tenant's sandbox keeps
  // running for another minute is this plane's decision, taken with a
  // registry the console has no connection to. So the console says what
  // happened and this acts on it.
  //
  // Guarded by a shared secret and expected to be unreachable from outside —
  // it is not on the tenant surface by accident, and a deployment that leaves
  // `INTERNAL_SHARED_SECRET` unset refuses every call rather than trusting
  // whoever asks.
  if (path === '/_internal/account' && req.method === 'POST') {
    const expected = process.env.INTERNAL_SHARED_SECRET ?? ''
    if (expected === '' || req.headers['x-internal-secret'] !== expected) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    const body = await readBody(req, 4096)
    let told
    try { told = JSON.parse(body?.toString('utf8') ?? '{}') } catch { told = {} }
    const email = typeof told.email === 'string' ? told.email : ''
    if (email === '') {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('no address')
      return
    }

    console.log(`gateway: the console reports ${email} ${String(told.event)}`)

    // The machine, for either event. Best effort: a sandbox that outlives this
    // by a few minutes is collected by the idle sweep, and nothing reaches it
    // in the meantime because the console has already ended the sessions.
    await sandboxes.release(email).catch((error) => {
      console.error(`gateway: releasing ${email} after ${String(told.event)} failed: ${error.message}`)
    })

    // The volume, for a deletion only, and not best effort. It holds the
    // tenant's files; the console keeps the account row until this answers, so
    // a failure here leaves something to retry rather than a deleted row and
    // an orphaned disk nobody is looking for.
    if (told.event === 'deleted' && volumesEnabled()) {
      const id = typeof told.id === 'string' ? told.id : ''
      if (id === '') {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('no account id')
        return
      }
      try {
        await destroyVolume(cubeRequest, id)
      } catch (error) {
        console.error(`gateway: destroying ${email}'s volume failed: ${error.message}`)
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('the volume is still there')
        return
      }
    }

    res.writeHead(204)
    res.end()
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
    if (caller === undefined) {
      res.writeHead(401)
      res.end()
      return
    }
    // 403 is "signed in, but not finished signing up", which nginx turns into a
    // redirect to /profile the same way it turns 401 into one to /login. It is
    // what makes the page unskippable: the shell is the only thing a tenant can
    // be trying to reach, and it is not served until they have answered.
    //
    // Only for the shell document, which is why nginx passes the address the
    // browser actually asked for. This costs a read of the account, and the
    // same gate guards the three dozen plugin bundles a cold load fetches —
    // charging each of them for it would be three dozen queries per page.
    if (SHELL_DOCUMENTS.has(String(req.headers['x-original-uri'] ?? '').split('?')[0])) {
      const account = await accounts.read(caller.email)
      if (account !== undefined && !hasProfile(account)) {
        res.writeHead(403)
        res.end()
        return
      }
    }
    res.writeHead(204)
    res.end()
    return
  }

  if ((path === '/profile' && (req.method === 'GET' || req.method === 'POST'))
    || (path === '/profile/delete' && req.method === 'POST')) {
    await handleProfile(path, req, res, profileDeps)
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
    // Read rather than taken from the token: the token carries what a session
    // is, and a name changed in another tab must not wait out an access token
    // to take effect here.
    const account = await accounts.read(caller.email)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    // `username` stays the field name: it is what the account section in
    // Settings reads, and the address is what it should show either way.
    //
    // The avatar travels inline rather than as a URL to fetch. It is a few tens
    // of kilobytes and the row was read anyway, and a second request would mean
    // the sidebar rendering a letter first and replacing it a moment later.
    res.end(JSON.stringify({
      username: caller.email,
      admin: caller.admin,
      displayName: account?.displayName ?? null,
      avatar: account?.avatar ?? null,
      // The tier's id, and only its id. What it is CALLED is a question with a
      // language in it, and the language is a preference in the browser asking
      // — the same division this response already draws for error codes.
      //
      // `DEFAULT_PLAN` rather than null for the account that could not be read:
      // the shell has to render something in that seat either way, and the
      // truthful answer for a tenant whose row is momentarily unavailable is
      // the tier almost everyone is on, not an empty badge.
      plan: account?.plan ?? DEFAULT_PLAN,
    }))
    return
  }

  // Throw this tenant's machine away, so the next request builds a new one.
  //
  // Release rather than restart: nothing here restarts a sandbox, and nothing
  // needs to. The manager forgets it and the runtime removes it, and the very
  // next `/api` call finds no record and creates one — which is also how idle
  // reclamation already works, so this is a gesture the deployment can already
  // survive rather than a new lifecycle.
  //
  // It is the only way a tenant applies a change to their own environment, and
  // the only way out of a sandbox that has wedged.
  // The right-hand panel's file plane. Ahead of the `/api|/files` branch below
  // because that one is a catch-all, and on its own prefix because `/files` is
  // already the tunnel's channel.
  if (await handlePanel(req, res, { callerOf, sandboxes, sessionSecret, accountById: async (id) => await accounts.readById(id) })) return

  if (path === '/sandbox/restart' && req.method === 'POST') {
    const caller = await callerOf(req, res)
    if (caller === undefined) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end('{}')
      return
    }
    try {
      await sandboxes.release(caller.email)
    } catch (error) {
      // The record is gone from the manager either way; a runtime that could
      // not remove the container leaves an orphan for the sweep, and the
      // tenant still gets a new machine.
      console.error(`gateway: restarting ${caller.email}'s sandbox failed: ${error.message}`)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'restart.failed' } }))
      return
    }
    console.log(`gateway: ${caller.email} restarted their sandbox`)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end('{"ok":true}')
    return
  }

  // What a tenant asks to be in their own sandbox's environment. Read, written
  // and deleted here rather than in the sandbox, because the sandbox is the
  // thing being configured and is recreated without warning — and because a
  // value must survive one being reclaimed.
  if (path === '/secrets' || path === '/secrets/delete') {
    const caller = await callerOf(req, res)
    if (caller === undefined) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end('{}')
      return
    }
    /**
     * @param {number} status - the status to answer with.
     * @param {object} body - the JSON to send.
     */
    const answer = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }

    if (path === '/secrets' && req.method === 'GET') {
      answer(200, { secrets: await secrets.list(caller.email) })
      return
    }

    if (req.method !== 'POST') {
      answer(405, { error: 'method not allowed' })
      return
    }

    // Small on purpose: a name and a value, and the value is capped again in
    // the store. Nothing here should ever approach this.
    const body = await readBody(req, 64 * 1024)
    if (body === undefined) {
      answer(413, { error: { code: 'body.too_long' } })
      return
    }
    /** @type {{name?: unknown, value?: unknown}} */
    let payload
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      answer(400, { error: { code: 'body.malformed' } })
      return
    }
    const name = String(payload?.name ?? '')

    if (path === '/secrets/delete') {
      await secrets.remove(caller.email, name)
      answer(200, { secrets: await secrets.list(caller.email) })
      return
    }

    const problem = nameProblem(name)
    if (problem !== undefined) {
      answer(400, { error: problem })
      return
    }
    const outcome = await secrets.set(caller.email, name, String(payload?.value ?? ''))
    if (outcome === 'full') {
      answer(409, { error: { code: 'secrets.full' } })
      return
    }
    if (outcome === 'too-long') {
      answer(413, { error: { code: 'secrets.value_too_long' } })
      return
    }
    console.log(`gateway: ${caller.email} set sandbox secret ${name}`)
    answer(200, { secrets: await secrets.list(caller.email) })
    return
  }

  // The two planes a tenant's browser talks to their own backend over. `/api`
  // is dsh's own; `/files` is the channel `dsh-sandbox-host` registers for
  // uploads, because `/api` accepts exactly one interceptor and dsh already
  // holds it. Both are the same thing to the gateway — a request that means
  // nothing without knowing whose sandbox it belongs in — so they authenticate
  // and route identically, and only the sandbox knows what is on them.
  if (path.startsWith('/api') || path.startsWith('/files')) {
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

/**
 * The terminal plane's accepted sockets.
 *
 * `noServer`, because this process already owns the upgrade path and decides
 * per route what a socket is for — the tunnel's own dial-ins, dsh's downlinks,
 * and now a shell.
 */
const terminalSockets = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://gateway').pathname

  if (path === '/_tunnel') {
    tunnels.handleUpgrade(req, socket, head)
    return
  }

  // The panel's terminal. Accepted here rather than forwarded down the tunnel:
  // it is answered from outside the sandbox through envd, like the rest of the
  // panel, so there is nothing for the tunnel to carry.
  if (path === TERMINAL_PATH) {
    void (async () => {
      const caller = await callerOf(req)
      if (caller === undefined) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      terminalSockets.handleUpgrade(req, socket, head, (accepted) => {
        void serveTerminal(accepted, caller, sandboxes)
      })
    })()
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

await sandboxes.adopt()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`gateway: listening on http://0.0.0.0:${PORT}; anyone with an email address can register`)
})
