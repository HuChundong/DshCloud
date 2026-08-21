/**
 * The administrator's console, and the actions it offers.
 *
 * Every path here requires an administrator, and an ordinary caller is answered
 * 404 rather than 403: the console is not something a tenant needs to know
 * exists.
 *
 * Every action answers with a redirect rather than a page, so the address bar
 * keeps saying `/admin` after a delete and a refresh reloads the console instead
 * of re-submitting.
 *
 * @module console
 */

import { adminPage } from './admin-page.js'
import { normalizeEmail } from './accounts.js'
import { eraseAccount } from './erase.js'
import { normalizeInvite } from './invites.js'
import { isPlan } from './plans.js'

/**
 * What the console needs from the rest of the gateway.
 * @typedef {object} ConsoleDeps
 * @property {import('./accounts.js').Accounts} accounts - who exists.
 * @property {import('./invites.js').Invites} invites - the codes that admit them.
 * @property {import('./tokens.js').Tokens} tokens - what suspension and deletion revoke.
 * @property {import('./settings.js').Settings} settings - the model credential, and the gate.
 * @property {import('./sandboxes.js').SandboxManager} sandboxes - whose machine is running.
 * @property {(req: import('node:http').IncomingMessage, res?: import('node:http').ServerResponse) => Promise<object | undefined>} callerOf - resolves the caller, renewing tokens.
 * @property {(req: import('node:http').IncomingMessage, limit: number) => Promise<Buffer | undefined>} readBody - the capped body reader.
 * @property {(accountId: string) => Promise<void>} destroyVolume - takes a deleted tenant's volume with them.
 * @property {string | undefined} version - the release shown on the page.
 */

/**
 * Serve the administrator's console and its actions.
 *
 * Every path here requires an administrator, and an ordinary caller is answered
 * 404 rather than 403: the console is not something a tenant needs to know
 * exists.
 *
 * @param {string} path - the request path.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @returns {Promise<void>} resolves once the response is complete.
 */
export async function handleConsole(path, req, res, deps) {
  const caller = await deps.callerOf(req, res)
  // Re-read the account rather than trusting the access token's own claim. The
  // claim is fixed when the token is minted, so an address added to
  // `GATEWAY_ADMINS` would not reach this console until its token expired —
  // and one removed from it would keep reaching it for as long.
  const account = caller === undefined ? undefined : await deps.accounts.read(caller.email)
  if (account === undefined || !account.admin) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  if (path === '/admin' && req.method === 'GET') {
    const done = new URL(req.url ?? '/', 'http://gateway').searchParams.get('done') ?? undefined
    await renderConsole(account, res, readNotice(done), deps)
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' })
    res.end('method not allowed')
    return
  }

  const form = new URLSearchParams((await deps.readBody(req, 4096))?.toString('utf8') ?? '')

  // The invite actions act on a code rather than on an account, so they are
  // taken before the self-protection below, which has no account to protect.
  if (path === '/admin/invites') {
    const minted = await deps.invites.mint(Number(form.get('count') ?? 1), account.email)
    console.log(`gateway: ${account.email} minted ${minted.length} invite(s)`)
    backToConsole(res, { code: 'invites.minted', params: { count: minted.length } }, req)
    return
  }
  if (path === '/admin/model') {
    const baseUrl = (form.get('baseUrl') ?? '').trim()
    const current = await deps.settings.modelCredential()
    // An empty key field means "leave it alone", not "clear it": the field is
    // blank on every load because the console never renders the key back, so
    // treating blank as a value would erase the credential every time someone
    // corrected the endpoint beside it.
    const apiKey = (form.get('apiKey') ?? '').trim() === '' ? current.apiKey : form.get('apiKey').trim()
    if (baseUrl === '' || apiKey === '') {
      backToConsole(res, 'model.incomplete', req)
      return
    }
    await deps.settings.setModelCredential(baseUrl, apiKey, account.email)
    console.log(`gateway: ${account.email} updated the model credential`)
    backToConsole(res, 'model.saved', req)
    return
  }
  if (path === '/admin/access') {
    // A checkbox absent from the body is a checkbox that was unticked, which is
    // how HTML says "off" and the only reason this reads presence rather than
    // value.
    const wantsInvite = form.get('inviteRequired') !== null
    const typed = Number.parseInt(form.get('sandboxLimit') ?? '', 10)
    if (form.get('sandboxLimit') !== null && form.get('sandboxLimit').trim() !== '' && (!Number.isInteger(typed) || typed < 0)) {
      backToConsole(res, 'access.bad.limit', req)
      return
    }
    const limit = Number.isInteger(typed) && typed > 0 ? typed : 0
    await deps.settings.setAccess(wantsInvite, limit, account.email)
    console.log(`gateway: ${account.email} set registration to ${wantsInvite ? 'invite-only' : 'open'}, sandbox limit ${limit === 0 ? 'unlimited' : limit}`)
    // Four codes rather than one sentence with two holes: both of the parts
    // that vary are words, and a word chosen here would be a word in whichever
    // language this process picked rather than the one the reader is in.
    backToConsole(res, {
      code: `access.${wantsInvite ? 'invite' : 'open'}.${limit === 0 ? 'uncapped' : 'capped'}`,
      params: { limit },
    }, req)
    return
  }
  if (path === '/admin/invites/discard') {
    const code = normalizeInvite(form.get('code') ?? '')
    const discarded = await deps.invites.discard(code)
    backToConsole(res, discarded ? { code: 'invite.discarded', params: { code } } : 'invite.unknown', req)
    return
  }

  const email = normalizeEmail(form.get('email') ?? '')
  // An administrator acting on their own account can lock the deployment out of
  // its own console, so the page does not offer it and this refuses it.
  if (email === account.email) {
    backToConsole(res, 'self.refused', req)
    return
  }

  let notice
  switch (path) {
    case '/admin/toggle': {
      const account = await deps.accounts.read(email)
      if (account === undefined) break
      const updated = await deps.accounts.setDisabled(email, !account.disabled)
      // Suspension has to take away what is already granted, or it only stops
      // the next sign-in while the open tab keeps working.
      if (updated?.disabled === true) {
        await deps.tokens.revokeAll(email)
        await deps.sandboxes.release(email).catch(() => {})
      }
      notice = { code: updated?.disabled === true ? 'account.suspended' : 'account.restored', params: { email } }
      break
    }
    case '/admin/plan': {
      const wanted = form.get('plan') ?? ''
      // Refused rather than normalized. Everywhere else a tier that is not a
      // tier becomes the default, because everywhere else something has to be
      // shown; here somebody is asking for a specific one, and silently giving
      // them a different one is the failure mode that makes an administrator
      // trust a console they should not.
      if (!isPlan(wanted)) {
        backToConsole(res, 'plan.unknown', req)
        return
      }
      const moved = await deps.accounts.setPlan(email, wanted)
      if (moved === undefined) break
      // The tier is not named in the sentence. Its id is not a word in either
      // language, and the picker in the row the reader is looking at already
      // shows the new one — the page is re-read after every action.
      notice = { code: 'plan.moved', params: { email } }
      break
    }
    case '/admin/release': {
      await deps.sandboxes.release(email).catch((error) => {
        console.error(`gateway: releasing ${email} failed: ${error.message}`)
      })
      notice = { code: 'sandbox.reclaimed', params: { email } }
      break
    }
    case '/admin/delete': {
      const doomed = await deps.accounts.read(email)
      // The same sequence a tenant's own deletion runs, from the same place:
      // two ways to delete an account that took different things away would be
      // two different promises about what deletion means.
      if (doomed !== undefined) await eraseAccount(deps, doomed)
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
  console.log(`gateway: ${account.email} — ${notice === undefined ? `no such account ${email}` : `${notice.code} ${email}`}`)
  backToConsole(res, notice, req)
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
 * `/admin` after a delete instead of `/admin/delete` — and so a refresh reloads
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
function backToConsole(res, notice, req) {
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
  res.writeHead(303, { Location: `/admin${query}` })
  res.end()
}

/**
 * Render the console with the current accounts.
 * @param {{email: string}} caller - the administrator viewing it.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {string} [notice] - the outcome of the action that led here.
 * @returns {Promise<void>} resolves once the response is complete.
 */
async function renderConsole(caller, res, notice, deps) {
  const [listed, invited, credential, access, live] = await Promise.all([
    deps.accounts.list(),
    deps.invites.list(),
    deps.settings.modelCredential(),
    deps.settings.access(),
    deps.sandboxes.live(),
  ])
  const html = adminPage({
    accounts: listed.map((account) => ({ ...account, sandbox: deps.sandboxes.stateOf(account.email) })),
    invites: invited,
    credential,
    access,
    live,
    viewer: caller.email,
    notice,
    version: deps.version,
  })
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
}
