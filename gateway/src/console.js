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
import { inviteRequired, normalizeInvite } from './invites.js'
import { volumesEnabled } from './volumes.js'

/**
 * What the console needs from the rest of the gateway.
 * @typedef {object} ConsoleDeps
 * @property {import('./accounts.js').Accounts} accounts - who exists.
 * @property {import('./invites.js').Invites} invites - the codes that admit them.
 * @property {import('./tokens.js').Tokens} tokens - what suspension and deletion revoke.
 * @property {import('./settings.js').Settings} settings - the model credential.
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
    await renderConsole(account, res, done, deps)
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
    backToConsole(res, `已生成 ${minted.length} 个邀请码。`, req)
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
      backToConsole(res, '接口地址和密钥都不能为空。', req)
      return
    }
    await deps.settings.setModelCredential(baseUrl, apiKey, account.email)
    console.log(`gateway: ${account.email} updated the model credential`)
    backToConsole(res, '已保存。已在运行的沙箱不受影响，新建的会用它。', req)
    return
  }
  if (path === '/admin/invites/discard') {
    const code = normalizeInvite(form.get('code') ?? '')
    const discarded = await deps.invites.discard(code)
    backToConsole(res, discarded ? `邀请码 ${code} 已删除。` : '该邀请码不存在。', req)
    return
  }

  const email = normalizeEmail(form.get('email') ?? '')
  // An administrator acting on their own account can lock the deployment out of
  // its own console, so the page does not offer it and this refuses it.
  if (email === account.email) {
    backToConsole(res, '不能对当前登录的账号执行该操作。', req)
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
      notice = `${email} 已${updated?.disabled === true ? '停用' : '恢复'}。`
      break
    }
    case '/admin/release': {
      await deps.sandboxes.release(email).catch((error) => {
        console.error(`gateway: releasing ${email} failed: ${error.message}`)
      })
      notice = `${email} 的沙箱已回收，下次请求会重建一个。`
      break
    }
    case '/admin/delete': {
      const doomed = await deps.accounts.read(email)
      await deps.tokens.revokeAll(email)
      await deps.sandboxes.release(email).catch((error) => {
        console.error(`gateway: releasing ${email} failed: ${error.message}`)
      })
      // The volume outlives every sandbox that used it, so deleting the account
      // is the only moment it is right to take it — and the only moment its
      // space is returned to the deployment's ceiling.
      if (doomed !== undefined && volumesEnabled()) {
        await deps.destroyVolume(doomed.id).catch((error) => {
          console.error(`gateway: destroying ${email}'s volume failed: ${error.message}`)
        })
      }
      await deps.accounts.erase(email)
      notice = `${email} 已删除。`
      break
    }
    default: {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
  }
  console.log(`gateway: ${account.email} — ${notice ?? `no such account ${email}`}`)
  backToConsole(res, notice, req)
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
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {string} [notice] - what happened, to show once on arrival.
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
  const query = notice === undefined ? '' : `?done=${encodeURIComponent(notice)}`
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
  const [listed, invited, credential] = await Promise.all([
    deps.accounts.list(),
    deps.invites.list(),
    deps.settings.modelCredential(),
  ])
  const html = adminPage({
    accounts: listed.map((account) => ({ ...account, sandbox: deps.sandboxes.stateOf(account.email) })),
    invites: invited,
    inviteRequired: inviteRequired(),
    credential,
    viewer: caller.email,
    notice,
    version: deps.version,
  })
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(html)
}
