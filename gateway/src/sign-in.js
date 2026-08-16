/**
 * Signing in, which is also registering.
 *
 * One endpoint because it is one form, and one form because a visitor should not
 * have to know which of the two they are doing. Which half a request is depends
 * on whether a code came with the address, which is exactly what the page's two
 * states post.
 *
 * @module sign-in
 */

import { isAdminEmail, isEmailAddress, normalizeEmail } from './accounts.js'
import { isSecureRequest } from './auth.js'
import { sendVerificationCode } from './email.js'
import { inviteRequired, normalizeInvite } from './invites.js'
import { loginPage } from './login-page.js'
import { signedInCookies } from './tokens.js'
import { CODE_TTL_SECONDS } from './verification.js'

/**
 * What signing in needs from the rest of the gateway.
 * @typedef {object} SignInDeps
 * @property {import('./accounts.js').Accounts} accounts - who exists.
 * @property {import('./invites.js').Invites} invites - what admits a new address.
 * @property {import('./tokens.js').Tokens} tokens - what a session is made of.
 * @property {import('./verification.js').Verification} verification - the code challenge.
 * @property {(req: import('node:http').IncomingMessage, limit: number) => Promise<Buffer | undefined>} readBody - the capped body reader.
 * @property {string | undefined} version - the release shown on the page.
 */

/**
 * Handle both halves of signing in: asking for a code, and answering one.
 *
 * One endpoint because it is one form. Which half this is depends on whether a
 * code came with the address, which is exactly what the page's two states post.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {SignInDeps} deps - the stores this reads and writes.
 * @returns {Promise<void>} resolves once the response is complete.
 */
export async function handleSignIn(req, res, deps) {
  const form = new URLSearchParams((await deps.readBody(req, 4096))?.toString('utf8') ?? '')
  const email = normalizeEmail(form.get('email') ?? '')
  const code = form.get('code')
  const invite = normalizeInvite(form.get('invite') ?? '')

  /**
   * @param {number} status - the status to answer with.
   * @param {object} state - what the page should show.
   */
  const page = (status, state) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(loginPage({ invite, inviteRequired: inviteRequired(), ...state, version: deps.version }))
  }

  if (!isEmailAddress(email)) {
    page(400, { error: '请填写一个有效的邮箱地址。' })
    return
  }

  if (code === null) {
    // A wrong invite is said so now rather than after a round trip through
    // someone's mail. Only one that was actually typed is checked: an empty
    // field cannot be judged here, because whether it is needed depends on
    // whether the address is registered, and answering that is what the whole
    // two-step shape exists to avoid.
    if (invite !== '' && !await deps.invites.usable(invite)) {
      page(403, { error: '邀请码无效或已被使用。' })
      return
    }
    const challenge = await deps.verification.open(email)
    if ('retryAfterSeconds' in challenge) {
      // Answered 200, not 429. Nothing went wrong from where the person is
      // standing: they asked for a code and one is already on its way to them,
      // and the page shows the same code field it would have. A 4xx here is the
      // browser's cue to log a failed navigation, which is what it means to it.
      page(200, {
        pending: email,
        notice: `验证码已发送，请查收邮件。${challenge.retryAfterSeconds} 秒后可重新获取。`,
      })
      return
    }
    try {
      await sendVerificationCode(email, challenge.code, Math.round(CODE_TTL_SECONDS / 60))
    } catch (error) {
      // The address is not told whether the failure was about it. Delivery
      // problems are the operator's, and the log is where they can be acted on.
      console.error(`gateway: sending a code to ${email} failed: ${error.message}`)
      page(502, { error: '验证码发送失败，请稍后再试。' })
      return
    }
    page(200, { pending: email, notice: '验证码已发送，请查收邮件。' })
    return
  }

  const answer = await deps.verification.answer(email, code.trim())
  if (answer === 'wrong') {
    page(401, { pending: email, error: '验证码不正确。' })
    return
  }
  if (answer === 'expired') {
    page(401, { error: '验证码已失效，请重新获取。' })
    return
  }

  // The invite is checked here rather than before the code was mailed, so that
  // the first step answers identically for every address. Asking a stranger for
  // an invite and a returning tenant for nothing would make this form a way to
  // ask which addresses are registered.
  if (inviteRequired() && !isAdminEmail(email) && !await deps.accounts.exists(email)) {
    if (invite === '' || !await deps.invites.redeem(invite, email)) {
      page(403, {
        pending: email,
        error: invite === '' ? '注册需要邀请码。' : '邀请码无效或已被使用。',
      })
      return
    }
  }

  const account = await deps.accounts.admit(email)
  if (account.disabled) {
    // Checked after the code, not before: refusing earlier would make the
    // sign-in form a way to ask which addresses are suspended.
    page(403, { error: '该账号已被停用，请联系管理员。' })
    return
  }
  // Nothing can refuse the sign-in from here, so the code is spent now. Spending
  // it earlier would have made a wrong invite cost the code as well.
  await deps.verification.consume(email)
  const access = await deps.tokens.issueAccess(account)
  const refresh = await deps.tokens.issueRefresh(account)
  console.log(`gateway: ${account.email} signed in`)
  res.writeHead(303, { Location: '/', 'Set-Cookie': signedInCookies(access, refresh, isSecureRequest(req)) })
  res.end()
}
