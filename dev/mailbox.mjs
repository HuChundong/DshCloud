/**
 * The development mailbox: somewhere for a sign-in code to actually arrive.
 *
 * Locally there is no mail. `RESEND_API_KEY` holds whatever was typed to get
 * the gateway to start, Resend answers 401, and the person signing in is told
 * the send failed — which is true, and leaves them with no way in. Reading the
 * code out of the database works and teaches the wrong habit: the flow that
 * gets exercised should be the flow that ships.
 *
 * So this is a postman, not a bypass. It speaks the one request Resend speaks —
 * `POST /emails` with a JSON message — and the gateway reaches it by having
 * `EMAIL_API_URL` point here. Everything else about signing in is untouched:
 * the code is minted the same way, expires the same way, cools down the same
 * way, and has to be typed in.
 *
 * Nothing is stored on disk and nothing survives a restart. Mail here is worth
 * exactly as long as the code inside it.
 *
 * Never run beside real people. It prints verification codes to anyone who
 * opens it, which is the one thing the address in them is meant to prove.
 *
 * Usage: node dev/mailbox.mjs   (PORT, default 8025)
 */

import { createServer } from 'node:http'
import process from 'node:process'

/** How many messages are kept. A code outlives its usefulness long before this. */
const KEEP = 50

/** Messages, newest first. */
const inbox = []

/** Six digits standing alone, which is what this deployment's codes look like. */
const CODE = /\b(\d{6})\b/

/**
 * Escape text for HTML.
 * @param {string} value - the text.
 * @returns {string} the escaped text.
 */
const escape = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * Read a request body, with a ceiling.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<string>} the body as text.
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    // A sign-in code is a few hundred bytes of markup. Anything approaching
    // this is not one of ours, and this process has no reason to hold it.
    if (size > 1_000_000) throw new Error('message too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * The inbox page.
 *
 * Refreshes itself, because the reason anyone has it open is that a code is
 * about to arrive — and a mailbox you have to reload is one more thing to do
 * while signing in.
 *
 * @returns {string} the page.
 */
function page() {
  const messages = inbox.map((mail) => `
    <article>
      <header>
        <b>${escape(mail.code ?? '—')}</b>
        <span>${escape(mail.to)}</span>
        <time>${escape(mail.at)}</time>
      </header>
      <p class="subject">${escape(mail.subject)}</p>
      <pre>${escape(mail.text)}</pre>
    </article>`).join('')

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>开发收件箱</title>
<meta http-equiv="refresh" content="3">
<style>
  :root { color-scheme: light dark; --line: color-mix(in srgb, currentColor 14%, transparent); }
  body { margin: 0; padding: 28px 20px 60px; font: 15px/1.6 system-ui, -apple-system, "PingFang SC", sans-serif;
         max-width: 720px; margin-inline: auto; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .lede { margin: 0 0 26px; opacity: .6; font-size: 13px; }
  .empty { padding: 40px 0; text-align: center; opacity: .5; font-size: 14px; }
  article { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  header b { font-size: 26px; letter-spacing: .12em; font-variant-numeric: tabular-nums; }
  header span { font-size: 13px; opacity: .75; }
  header time { margin-left: auto; font-size: 12px; opacity: .5; }
  .subject { margin: 8px 0 6px; font-size: 13px; opacity: .8; }
  pre { margin: 0; padding: 10px 12px; border-radius: 7px; font-size: 12px; line-height: 1.55;
        white-space: pre-wrap; word-break: break-word; background: color-mix(in srgb, currentColor 6%, transparent); }
</style></head><body>
<h1>开发收件箱</h1>
<p class="lede">本机部署发出的验证码落在这里，每 3 秒自动刷新。这里没有真实投递，也不该跑在有真实用户的地方。</p>
${messages === '' ? '<p class="empty">还没有邮件。去登录页要一个验证码。</p>' : messages}
</body></html>`
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]

  // The one request Resend takes, answered the way Resend answers it: the
  // gateway checks the status and reads nothing else, but a shape it does not
  // recognise would be a difference between here and production.
  if (req.method === 'POST' && path === '/emails') {
    readBody(req).then((body) => {
      let message
      try { message = JSON.parse(body) } catch { message = {} }
      const text = String(message.text ?? '')
      const mail = {
        to: Array.isArray(message.to) ? message.to.join(', ') : String(message.to ?? '(未指定)'),
        subject: String(message.subject ?? ''),
        text,
        // Pulled out and shown large, because it is the only part anyone here
        // is reading. Taken from the subject too, since that is where this
        // deployment puts it.
        code: (CODE.exec(`${String(message.subject ?? '')} ${text}`) ?? [])[1],
        at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      }
      inbox.unshift(mail)
      inbox.length = Math.min(inbox.length, KEEP)
      console.log(`mailbox: ${mail.to} — ${mail.code ?? '(没找到验证码)'}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: `local-${String(inbox.length)}` }))
    }).catch((error) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: error.message }))
    })
    return
  }

  // The newest code as plain text, for a script that would otherwise read the
  // database to find out what was just sent.
  if (path === '/latest') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`${inbox[0]?.code ?? ''}\n`)
    return
  }

  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(page())
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('no such path\n')
})

const port = Number(process.env.PORT ?? 8025)
server.listen(port, '0.0.0.0', () => {
  console.log(`mailbox: development inbox on http://0.0.0.0:${String(port)} — never run this beside real users`)
})
