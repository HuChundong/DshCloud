/**
 * The administrator's console, and the actions it offers.
 *
 * Reached only through the service in `server.js`, which admits an operator
 * before any path here runs. Nothing in this file checks a caller: it is not
 * reachable without having been let in, and a second check here would be a
 * second place for the two to disagree.
 *
 * The paths are the domain's own roots — `/`, `/invites`, `/plan` — because
 * this console owns a hostname now. It used to live under the gateway's
 * `/admin`, and carrying that prefix onto its own domain would only stutter.
 *
 * Every action answers with a redirect rather than a page, so the address bar
 * keeps saying `/` after a delete and a refresh reloads the console instead
 * of re-submitting.
 *
 * @module console
 */

import { USERNAME as OPERATOR, verify } from './auth.js'
import { toString as qrSvg } from 'qrcode'
import { enrolmentUri } from './totp.js'
import { consolePage } from './console-shell.js'
import { SECTIONS, sectionFor } from './sections/index.js'
import { PAGE_SIZE, pageFrom, windowFor } from './sections/paging.js'
import { record, recent } from '../gateway/src/audit.js'
import { normalizeEmail } from '../gateway/src/accounts.js'
import { normalizeInvite } from '../gateway/src/invites.js'
import { revokeAllFor } from '../gateway/src/revoke.js'
import { isPlan } from '../gateway/src/plans.js'

/**
 * What the console needs.
 *
 * Shorter than it was, and the omissions are the design. This service holds the
 * database, so it can change an account and end its sessions. It holds no
 * connection to a sandbox platform and no key to mint a token — so releasing a
 * machine and destroying a volume are asked of the gateway rather than done
 * here, and a session can be ended here but never started.
 *
 * @typedef {object} ConsoleDeps
 * @property {import('../gateway/src/accounts.js').Accounts} accounts - who exists.
 * @property {import('../gateway/src/invites.js').Invites} invites - the codes that admit them.
 * @property {import('../gateway/src/settings.js').Settings} settings - the model credential, and the gate.
 * @property {import('./second-factor.js').SecondFactor} secondFactor - the operator's own enrolment.
 * @property {import('pg').Pool} db - the pool, for the one thing that is a fact about rows rather than about a store: ending sessions.
 * @property {(req: import('node:http').IncomingMessage, limit: number) => Promise<Buffer | undefined>} readBody - the capped body reader.
 * @property {(event: string, email: string, extra?: object) => Promise<boolean>} tellGateway - hands the runtime plane what only it can do, and says whether it arrived.
 * @property {string | undefined} version - the release shown on the page.
 */

/**
 * Serve the operator's console and its actions.
 *
 * Nothing here checks a caller. It is not reachable without `server.js` having
 * admitted one, and a second check would be a second place for the two to
 * disagree.
 *
 * @param {string} path - the request path.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @returns {Promise<void>} resolves once the response is complete.
 */
/**
 * Recovery codes waiting to be read, once.
 *
 * They are stored as digests, so the only moment they exist in a readable form
 * is between being minted and being rendered. That is a moment, not a place —
 * it is deliberately in memory and deliberately cleared by the next render, so
 * a refresh does not show them again and a restart does not keep them.
 */
let unread

/**
 * Hold codes for the next render, or clear what is held.
 *
 * @param {string[]|undefined} codes - the codes, or nothing to forget them.
 */
function showCodes(codes) {
  unread = codes
}

export async function handleConsole(path, req, res, deps) {
  // No caller to resolve. Whoever reaches this function has already been
  // admitted by the service around it, with a credential that belongs to this
  // deployment rather than to any account — which is what stopped an operator
  // from having to be a tenant, and stopped a tenant from being one path
  // traversal away from being an operator.

  const section = req.method === 'GET' ? sectionFor(path) : undefined
  if (section !== undefined) {
    const asked = new URL(req.url ?? '/', 'http://console').searchParams
    await renderSection(section, res, readNotice(asked.get('done') ?? undefined), deps, pageFrom(asked.get('page')))
    return
  }

  if (req.method !== 'POST') {
    // 404, not 405. This service answers five GET routes and a handful of
    // POSTs, and everything else is a path it does not have — a 405 says the
    // path exists and the method is wrong, which sent three font requests
    // looking like a routing bug rather than like the missing files they were.
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  const form = new URLSearchParams((await deps.readBody(req, 4096))?.toString('utf8') ?? '')

  // The invite actions act on a code rather than on an account, so they are
  // taken before the self-protection below, which has no account to protect.
  if (path === '/invites') {
    const minted = await deps.invites.mint(Number(form.get('count') ?? 1), OPERATOR)
    console.log(`admin: ${OPERATOR} minted ${minted.length} invite(s)`)
    await record(deps.db, { actor: OPERATOR, action: 'invites.minted', detail: { count: minted.length } })
    backToConsole(res, { code: 'invites.minted', params: { count: minted.length } }, req, path)
    return
  }
  if (path === '/model') {
    const baseUrl = (form.get('baseUrl') ?? '').trim()
    const current = await deps.settings.modelCredential()
    // An empty key field means "leave it alone", not "clear it": the field is
    // blank on every load because the console never renders the key back, so
    // treating blank as a value would erase the credential every time someone
    // corrected the endpoint beside it.
    const apiKey = (form.get('apiKey') ?? '').trim() === '' ? current.apiKey : form.get('apiKey').trim()
    if (baseUrl === '' || apiKey === '') {
      backToConsole(res, 'model.incomplete', req, path)
      return
    }
    await deps.settings.setModelCredential(baseUrl, apiKey, OPERATOR)
    console.log(`admin: ${OPERATOR} updated the model credential`)
    // The endpoint, and never the key — not even its last four. This table
    // outlives the credential and is read by whoever can read the database.
    await record(deps.db, { actor: OPERATOR, action: 'model.saved', detail: { endpoint: baseUrl } })
    backToConsole(res, 'model.saved', req, path)
    return
  }
  // ---- the second factor ------------------------------------------------
  //
  // Everything that turns it on, off, or reissues its recovery codes asks for
  // the password again first. A signed-in session is not enough: the whole
  // point of a second factor is what happens when a session or a password has
  // been taken, and a stolen session that can quietly re-enrol its own phone
  // is that protection removed by the thing that was supposed to provide it.
  if (path.startsWith('/security/')) {
    const reauthorised = path === '/security/activate' || path === '/security/cancel' || path === '/security/dismiss'
      ? true
      : await verify(OPERATOR, form.get('password') ?? '')
    if (!reauthorised) {
      console.warn(`admin: ${OPERATOR} failed to confirm the password for ${path}`)
      backToConsole(res, 'tfa.badpassword', req, path)
      return
    }

    if (path === '/security/begin') {
      deps.secondFactor.begin(OPERATOR, 'HamsterHQ')
      console.log(`admin: ${OPERATOR} started enrolling a second factor`)
      backToConsole(res, undefined, req, path)
      return
    }

    if (path === '/security/cancel') {
      deps.secondFactor.abandon()
      backToConsole(res, undefined, req, path)
      return
    }

    if (path === '/security/activate') {
      const codes = await deps.secondFactor.activate(form.get('code') ?? '', OPERATOR)
      if (codes === undefined) {
        // Wrong code, or the enrolment timed out while the phone was being
        // found. Either way nothing was turned on, which is the entire reason
        // this step exists.
        backToConsole(res, 'tfa.badcode', req, path)
        return
      }
      showCodes(codes)
      console.log(`admin: ${OPERATOR} turned on a second factor`)
      await record(deps.db, { actor: OPERATOR, action: 'tfa.enabled' })
      backToConsole(res, 'tfa.on', req, path)
      return
    }

    if (path === '/security/recovery') {
      const codes = await deps.secondFactor.remintRecovery(OPERATOR)
      if (codes === undefined) {
        backToConsole(res, 'tfa.notenrolled', req, path)
        return
      }
      showCodes(codes)
      console.log(`admin: ${OPERATOR} replaced the recovery codes`)
      await record(deps.db, { actor: OPERATOR, action: 'tfa.recovery', detail: { codes: codes.length } })
      backToConsole(res, 'tfa.reminted', req, path)
      return
    }

    if (path === '/security/dismiss') {
      showCodes(undefined)
      backToConsole(res, undefined, req, path)
      return
    }

    if (path === '/security/disable') {
      await deps.secondFactor.forget()
      console.warn(`admin: ${OPERATOR} turned the second factor off`)
      await record(deps.db, { actor: OPERATOR, action: 'tfa.disabled' })
      backToConsole(res, 'tfa.off', req, path)
      return
    }
  }

  if (path === '/access') {
    // A checkbox absent from the body is a checkbox that was unticked, which is
    // how HTML says "off" and the only reason this reads presence rather than
    // value.
    const wantsInvite = form.get('inviteRequired') !== null
    const typed = Number.parseInt(form.get('sandboxLimit') ?? '', 10)
    if (form.get('sandboxLimit') !== null && form.get('sandboxLimit').trim() !== '' && (!Number.isInteger(typed) || typed < 0)) {
      backToConsole(res, 'access.bad.limit', req, path)
      return
    }
    const limit = Number.isInteger(typed) && typed > 0 ? typed : 0
    await deps.settings.setAccess(wantsInvite, limit, OPERATOR)
    console.log(`admin: ${OPERATOR} set registration to ${wantsInvite ? 'invite-only' : 'open'}, sandbox limit ${limit === 0 ? 'unlimited' : limit}`)
    await record(deps.db, {
      actor: OPERATOR,
      action: 'access.saved',
      detail: { registration: wantsInvite ? 'invite' : 'open', ceiling: limit },
    })
    // Four codes rather than one sentence with two holes: both of the parts
    // that vary are words, and a word chosen here would be a word in whichever
    // language this process picked rather than the one the reader is in.
    backToConsole(res, {
      code: `access.${wantsInvite ? 'invite' : 'open'}.${limit === 0 ? 'uncapped' : 'capped'}`,
      params: { limit },
    }, req, path)
    return
  }
  if (path === '/invites/discard') {
    const code = normalizeInvite(form.get('code') ?? '')
    const discarded = await deps.invites.discard(code)
    if (discarded) await record(deps.db, { actor: OPERATOR, action: 'invite.discarded', subject: code })
    backToConsole(res, discarded ? { code: 'invite.discarded', params: { code } } : 'invite.unknown', req, path)
    return
  }

  const email = normalizeEmail(form.get('email') ?? '')
  // An administrator acting on their own account can lock the deployment out of
  // its own console, so the page does not offer it and this refuses it.
  if (email === OPERATOR) {
    backToConsole(res, 'self.refused', req, path)
    return
  }

  let notice
  switch (path) {
    case '/toggle': {
      const account = await deps.accounts.read(email)
      if (account === undefined) break
      const updated = await deps.accounts.setDisabled(email, !account.disabled)
      // Suspension has to take away what is already granted, or it only stops
      // the next sign-in while the open tab keeps working.
      if (updated?.disabled === true) {
        await revokeAllFor(deps.db, email)
        // Said, not done. Whether a suspended tenant's machine keeps running
        // for a moment is the runtime plane's to decide; what this service
        // owns is the account's state, and it has already changed. The
        // gateway reaches the same place on its own if this never arrives —
        // the tokens are gone, so nothing reaches the machine, and the idle
        // sweep takes it.
        await deps.tellGateway('suspended', email)
      }
      const state = updated?.disabled === true ? 'account.suspended' : 'account.restored'
      await record(deps.db, { actor: OPERATOR, action: state, subject: email })
      notice = { code: state, params: { email } }
      break
    }
    case '/plan': {
      const wanted = form.get('plan') ?? ''
      // Refused rather than normalized. Everywhere else a tier that is not a
      // tier becomes the default, because everywhere else something has to be
      // shown; here somebody is asking for a specific one, and silently giving
      // them a different one is the failure mode that makes an administrator
      // trust a console they should not.
      if (!isPlan(wanted)) {
        backToConsole(res, 'plan.unknown', req, path)
        return
      }
      const moved = await deps.accounts.setPlan(email, wanted)
      if (moved === undefined) break
      await record(deps.db, { actor: OPERATOR, action: 'plan.moved', subject: email, detail: { to: wanted } })
      // The tier is not named in the sentence. Its id is not a word in either
      // language, and the picker in the row the reader is looking at already
      // shows the new one — the page is re-read after every action.
      notice = { code: 'plan.moved', params: { email } }
      break
    }
    case '/delete': {
      const doomed = await deps.accounts.read(email)
      if (doomed === undefined) break

      // Asked of the gateway, whole. Deleting an account revokes its sessions,
      // releases its machine and destroys its volume, and that sequence lives
      // in one place because a tenant deleting themselves must take away the
      // same things — so this asks for it rather than performing a second
      // version of it here.
      //
      // The row is the gateway's to remove too, at the end of that sequence.
      // If the request never arrives, nothing has happened at all: the account
      // is still listed, still signed in, still running, and the operator can
      // try again. A half-deleted tenant is the state worth not having.
      if (!await deps.tellGateway('deleted', email)) {
        notice = 'account.erase.stuck'
        break
      }
      await record(deps.db, { actor: OPERATOR, action: 'account.erased', subject: email })
      notice = { code: 'account.erased', params: { email } }
      break
    }
    default: {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
  }
  // The code, not the sentence: the sentence has a language now, and a log line
  // that picked one would be picking it for whoever reads the logs.
  // A notice is either a bare code or a code with parameters, and this line
  // printed `undefined` for every bare one — which is most of the failures,
  // the only ones worth reading a log for.
  const said = notice === undefined ? `no such account ${email}` : `${typeof notice === 'string' ? notice : notice.code} ${email}`
  console.log(`admin: ${OPERATOR} — ${said}`)
  backToConsole(res, notice, req, path)
}

/**
 * Read back what `backToConsole` put in the query.
 *
 * Anything that is not the JSON this wrote is passed through as a plain code,
 * which is what a bare one looks like and also what someone typing in the
 * address bar produces. Neither reaches the reader as itself: an unknown code
 * falls through `MESSAGES` to be shown verbatim, and it is escaped on the way
 * out — so the worst a hand-edited query can do is put its own text on the
 * page, which is what it could already do by editing the page.
 *
 * @param {string} [done] - the query parameter as it arrived.
 * @returns {string | {code: string, params?: object} | undefined} the notice.
 */
function readNotice(done) {
  if (done === undefined || !done.startsWith('{')) return done
  try {
    const parsed = JSON.parse(done)
    return typeof parsed?.code === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Answer an administrative action by sending the browser back to the console.
 *
 * A redirect rather than the page itself, so the address bar keeps saying
 * the console's own root after a delete instead of `/delete` — and so a refresh reloads
 * the console rather than re-submitting the action. The outcome rides along as
 * a query parameter, which is the only part of it that has to survive a
 * redirect; it is rendered as escaped text by the page that reads it.
 *
 * What rides is a MESSAGE CODE and not a sentence. It used to be a finished
 * Chinese sentence, which put prose in the address bar and — more to the
 * point — reached a reader who had chosen English as Chinese, because a
 * notice that is already worded has nothing left for the language toggle to
 * do. One with holes in it travels as JSON, which is not pretty in a URL and
 * is only ever seen there by a visit with no scripting.
 *
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {string | {code: string, params?: object}} [notice] - what happened, to show once on arrival.
 */
/**
 * Which section an action belongs to.
 *
 * Only a browser with no scripting reads this: everything else posts in place
 * and re-reads the path it is already on. But that browser has to land
 * somewhere, and landing on the tenants page after minting an invite would be
 * answering a question with a different page.
 */
const HOME = {
  '/invites': '/invites',
  '/invites/discard': '/invites',
  '/access': '/settings',
  '/model': '/settings',
  '/toggle': '/',
  '/plan': '/',
  '/delete': '/',
}

/**
 * Where an action's outcome is shown.
 *
 * @param {string} path - the action's path.
 * @returns {string} the section to return to.
 */
function homeFor(path) {
  return path.startsWith('/security/') ? '/security' : HOME[path] ?? '/'
}

function backToConsole(res, notice, req, path) {
  // Answered in place when the page asked in place. An action is a request,
  // not a destination, so navigating to one puts its outcome in the address
  // bar — where a refresh replays the notice for something that happened once
  // and is already done.
  //
  // The redirect stays for a form posted without scripting, which has nowhere
  // else to put the answer.
  if (req?.headers['x-console-action'] === 'fetch') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ notice: notice ?? null }))
    return
  }
  const said = typeof notice === 'object' ? JSON.stringify(notice) : notice
  const query = said === undefined ? '' : `?done=${encodeURIComponent(said)}`
  res.writeHead(303, { Location: `${homeFor(path)}${query}` })
  res.end()
}

/**
 * Render the console with the current accounts.
 * @param {{email: string}} caller - the administrator viewing it.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {string} [notice] - the outcome of the action that led here.
 * @returns {Promise<void>} resolves once the response is complete.
 */
async function renderSection(section, res, notice, deps, page) {
  // Only what this section asks for. The console used to read every store on
  // every render because everything was on one page; a section that shows
  // invite codes has no reason to list accounts, and reading them anyway is a
  // query per visit that nothing looks at.
  //
  // And only one page of it. Every list here is paged in SQL — see
  // `sections/paging.js` for why that is a rule rather than a nicety.
  const state = { page }
  const needs = new Set(section.needs)
  const rows = windowFor(page)

  if (needs.has('accounts')) {
    // No sandbox state. Whether a tenant's machine is up is the platform's to
    // answer and the gateway's to ask — this service holds a connection to
    // neither, and a column showing what it learned from a third party some
    // seconds ago is worse than a column that is not there.
    const listed = await deps.accounts.tenants(rows)
    state.admins = await deps.accounts.admins()
    state.tenants = listed.rows
    state.total = listed.total
  }
  if (needs.has('invites')) {
    const listed = await deps.invites.list(rows)
    state.invites = listed.rows
    state.total = listed.total
  }
  if (needs.has('access')) state.access = await deps.settings.access()
  if (needs.has('credential')) state.credential = await deps.settings.modelCredential()
  if (needs.has('audit')) {
    const listed = await recent(deps.db, rows)
    state.audit = listed.rows
    state.total = listed.total
  }

  if (needs.has('security')) {
    const factor = await deps.secondFactor.state()

    // An enrolment in progress becomes a square to scan. Drawn here rather
    // than fetched: this service's CSP allows nothing from anywhere else, and
    // handing a TOTP secret to a public QR service to be drawn would be giving
    // away the very thing being enrolled.
    const enrolling = deps.secondFactor.inProgress()
    const qr = enrolling === undefined
      ? undefined
      : await qrSvg(enrolmentUri(enrolling, OPERATOR, 'HamsterHQ'), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })

    // Read once. The next render of this page has nothing to show.
    const freshCodes = unread
    unread = undefined

    state.security = { ...factor, qr, secret: enrolling, freshCodes }
  }

  // A page past the end is answered with the last one there is, rather than
  // with an empty table and a control offering to go back to page 98. Asking
  // for it is a hand-edited URL or a bookmark to a list that has since been
  // trimmed; either way the honest answer is the end of the list.
  if (state.total !== undefined && page > 1 && (page - 1) * PAGE_SIZE >= state.total) {
    const last = Math.max(1, Math.ceil(state.total / PAGE_SIZE))
    res.writeHead(303, { Location: `${section.path}?page=${String(last)}` })
    res.end()
    return
  }

  const drawn = section.render(state)
  const html = consolePage({
    section,
    sections: SECTIONS,
    body: drawn.html,
    table: drawn.table,
    viewer: OPERATOR,
    notice,
    version: deps.version,
  })
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
}
