/**
 * Sending the one thing this deployment mails: a sign-in code.
 *
 * Resend over its HTTP API rather than SMTP, because SMTP from a residential or
 * cloud address is delivered erratically and the failure — mail that silently
 * lands in spam — looks to a user exactly like a deployment that is broken.
 *
 * `EMAIL_FROM` must be an address at a domain verified with Resend. Resend's
 * shared sender works without verification but only delivers to the account
 * owner's own address, which is enough to try the flow and not enough to run it.
 */

import process from 'node:process'

/** Where Resend takes messages. */
const API_URL = 'https://api.resend.com/emails'

/** The API credential. Absent, the deployment cannot sign anybody in. */
const API_KEY = process.env.RESEND_API_KEY ?? ''

/** The sender. Resend refuses a domain it has not verified. */
const FROM = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

/** What the deployment calls itself in the mail it sends. */
const PRODUCT = process.env.EMAIL_PRODUCT_NAME ?? 'DSH'

/**
 * Whether mail can be sent at all.
 *
 * Checked at startup so a deployment with no credential says so on the console
 * rather than at the moment its first user asks for a code.
 *
 * @returns {boolean} whether a credential is configured.
 */
export function canSendEmail() {
  return API_KEY !== ''
}

/**
 * Mail one sign-in code.
 *
 * @param {string} to - the recipient address.
 * @param {string} code - the code to send.
 * @param {number} ttlMinutes - how long the code stays valid, for the message body.
 * @returns {Promise<void>} resolves once Resend has accepted the message.
 * @throws {Error} when there is no credential, or Resend refuses the message.
 */
export async function sendVerificationCode(to, code, ttlMinutes) {
  if (!canSendEmail()) throw new Error('email: RESEND_API_KEY is required to send a sign-in code')
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: `${code} 是你的 ${PRODUCT} 登录验证码`,
      text: `你的验证码是 ${code}，${ttlMinutes} 分钟内有效。\n\n如果这不是你本人的操作，忽略这封邮件即可，没有人能仅凭这封邮件登录。`,
      html: body(code, ttlMinutes),
    }),
  })
  if (!response.ok) {
    // Resend's message names the cause — an unverified sender domain, a
    // malformed address, a spent quota — and every one of them is something an
    // operator has to act on, so none of it is worth flattening.
    throw new Error(`email: Resend refused the message (${response.status}): ${(await response.text()).trim()}`)
  }
}

/**
 * The message body.
 *
 * Inline styles and a table-free layout: mail clients strip stylesheets, and
 * the code has to stay legible in the ones that strip more than that.
 *
 * @param {string} code - the code to show.
 * @param {number} ttlMinutes - how long it stays valid.
 * @returns {string} the HTML body.
 */
function body(code, ttlMinutes) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;color:#111">
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6">你正在登录 <strong>${PRODUCT}</strong>，验证码是：</p>
  <p style="margin:0 0 24px;font-size:32px;font-weight:600;letter-spacing:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</p>
  <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#555">${ttlMinutes} 分钟内有效。</p>
  <p style="margin:0;font-size:14px;line-height:1.6;color:#555">如果这不是你本人的操作，忽略这封邮件即可，没有人能仅凭这封邮件登录。</p>
</div>`
}
