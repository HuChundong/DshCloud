/**
 * The administrator's console: who has registered, and what can be done about
 * it.
 *
 * Served from the gateway rather than the web container, like the login page and
 * for the same reasons — it must work when no sandbox exists, must not depend on
 * the frontend bundle, and is about the deployment rather than about any
 * tenant's session. It follows the login page's visual language so the
 * deployment presents one identity rather than two.
 *
 * Every action is a form post that reloads the page. There is no client-side
 * state to go stale, no JSON surface to keep in step with the markup, and the
 * page works with scripting off — which is worth more here than anywhere else,
 * because this is the page an operator reaches for when something is wrong.
 *
 * The destructive actions confirm in the browser and are irreversible on the
 * server, so they are placed and worded to be told apart at a glance: suspending
 * keeps everything and can be undone, deleting takes the account, its sessions,
 * and its sandbox with it.
 */

import { FONT_PRELOAD, PALETTE_CSS, THEME_TOGGLE, TOAST_CSS, escapeHtml, toast } from './page-chrome.js'
import { describeKey } from './settings.js'

/**
 * Render an epoch timestamp the way an operator reads one.
 * @param {number} at - epoch milliseconds.
 * @returns {string} the rendered time.
 */
function when(at) {
  // The deployment's clock, not the reader's: rendered on the server, where
  // `TZ` says which one that is. Node carries its own zone data, so the
  // variable is enough — the image needs no `tzdata` for this to be right.
  const date = new Date(at)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Render the console.
 *
 * @param {object} state - what to show.
 * @param {Array<import('./accounts.js').Account & {sandbox: string}>} state.accounts - the accounts, each with the state of its sandbox.
 * @param {Array<{code: string, createdAt: number, redeemedAt: number | undefined, redeemedBy: string | undefined}>} state.invites - the invite codes, unredeemed first.
 * @param {{baseUrl: string, apiKey: string, source: string, updatedAt: number | undefined, updatedBy: string | undefined}} state.credential - the model credential in force, described rather than shown.
 * @param {{inviteRequired: boolean, sandboxLimit: number, source: string, updatedAt: number | undefined, updatedBy: string | undefined}} state.access - the gate in force: who may register, and how many sandboxes may run.
 * @param {number} state.live - how many sandboxes are running right now, which is what the ceiling is measured against.
 * @param {string} state.viewer - the administrator's own address, so the page can refuse to offer them their own delete button.
 * @param {string} [state.notice] - the outcome of the action that led here.
 * @param {string} [state.version] - the dsh release this deployment runs.
 * @returns {string} the HTML document.
 */
export function adminPage(state) {
  const { accounts, invites, credential, access, live, viewer, notice, version } = state
  const release = version === undefined || version === '' ? '' : ` · v${escapeHtml(version)}`
  // A toast rather than a block in the page. It reports an action that has
  // already happened, so it dismisses itself — and being out of the layout, it
  // does not push the table down and move the row an operator was aiming at.
  const banner = toast(undefined, notice)

  // Administrators are listed apart because they are a different kind of row:
  // named by the deployment's own configuration, and not something this page
  // can add to or take away from.
  const admins = accounts.filter((account) => account.admin)
  const tenants = accounts.filter((account) => !account.admin)

  const adminRows = admins.length === 0
    ? '<tr><td class="empty">GATEWAY_ADMINS 里的地址还没有登录过。</td></tr>'
    : admins.map((account) => adminRow(account, viewer)).join('\n')
  const rows = tenants.length === 0
    ? '<tr><td colspan="5" class="empty">还没有人注册。</td></tr>'
    : tenants.map((account) => row(account, viewer)).join('\n')

  // Which credential is in force is state, not explanation: an operator cannot
  // read it off the form, because the form never shows the key back.
  const credentialHint = credential.source === 'console'
    ? `${describeKey(credential.apiKey)} · ${escapeHtml(credential.updatedBy ?? '')} · ${when(credential.updatedAt)}`
    : `${describeKey(credential.apiKey)} · 环境变量`
  // Where the gate came from, for the same reason the credential says so: an
  // operator reading a switch needs to know whether the console owns it or the
  // compose file does, because that decides where a change has to be made.
  const accessHint = access.source === 'console'
    ? `${escapeHtml(access.updatedBy ?? '')} · ${when(access.updatedAt)}`
    : '环境变量'
  const ceiling = access.sandboxLimit === 0 ? '不限' : `${live} / ${access.sandboxLimit}`
  const inviteRows = invites.length === 0
    ? '<tr><td colspan="4" class="empty">还没有邀请码。</td></tr>'
    : invites.map(inviteRow).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>用户管理 · HamsterHQ</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/login-assets/favicon.svg">
${FONT_PRELOAD}
<style>
${PALETTE_CSS}
${TOAST_CSS}
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  main { flex: 1; width: 100%; max-width: 960px; margin: 0 auto; padding: 2.5rem 1.25rem; }

  .brand { display: flex; align-items: center; gap: .5rem; margin-bottom: 2rem; }
  .brand img { height: 26px; width: auto; display: block; }
  .brand .word { font-family: var(--display); font-size: 1.375rem; font-weight: 600; letter-spacing: -.03em; color: var(--fg); }
  /* Filled, not outlined: the wordmark reads as one lockup — the name and the
     product beside it — and a hairline chip there is a second thing to read
     rather than the other half of the first. --ink inverts with the theme, so
     the block is black on the light page and white on the dark one; the mark
     beside it inverts with it. */
  .brand .badge {
    align-self: center;
    padding: .15rem .4rem;
    border-radius: 4px;
    background: var(--ink);
    color: var(--on-ink);
    font-size: .625rem;
    font-weight: 700;
    letter-spacing: .08em;
  }
  .brand .here { margin-left: auto; color: var(--muted); font-size: .8125rem; }
  .brand .here a { color: var(--fg); }

  h1 { margin: 0 0 .35rem; font-size: 1.125rem; font-weight: 600; }

  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th {
    text-align: left;
    padding: 0 .75rem .6rem;
    color: var(--muted);
    font-weight: 500;
    font-size: .8125rem;
    border-bottom: 1px solid var(--line);
  }
  td { padding: .85rem .75rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
  td.empty { padding: 2.5rem; text-align: center; color: var(--muted); }
  .email { font-weight: 500; color: var(--ink); }
  .sub { color: var(--muted); font-size: .8125rem; }
  .actions { text-align: right; white-space: nowrap; }

  .tag {
    display: inline-block;
    padding: .1rem .4rem;
    border-radius: 4px;
    font-size: .6875rem;
    font-weight: 600;
    letter-spacing: .02em;
  }
  .tag.admin { background: var(--ink); color: var(--on-ink); }
  /* Mixed from the tokens rather than written out, so both survive the theme:
     the fixed tints these carried were a light-page grey and a light-page red,
     and on the dark ground the running tag disappeared into the row. */
  .tag.off { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
  .tag.live { background: var(--surface); color: var(--fg); }

  form { display: inline; }
  button {
    padding: .35rem .7rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
    cursor: pointer;
  }
  button:hover { border-color: var(--muted); }
  button.danger { color: var(--danger); }
  button.danger:hover { border-color: var(--danger); }

  /* One card per subject. Administrators and tenants are different kinds of
     row — one is named by the deployment's configuration and cannot be
     un-named from here, the other is whoever signed up — and a single table
     invited reading a suspend button next to an account that has none. */
  .card {
    margin-bottom: 1.5rem;
    padding: 1.25rem 1.25rem .5rem;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg);
    box-shadow: 0 1px 2px var(--shadow);
  }
  .card > h2 { margin: 0 0 1rem; font-size: 1rem; font-weight: 600; }
  .hint { margin-left: .5rem; color: var(--muted); font-size: .8125rem; font-weight: 400; }
  .card table { margin-bottom: .75rem; }
  .card table tr:last-child td { border-bottom: 0; }

  h2 { margin: 2.5rem 0 .35rem; font-size: 1.125rem; font-weight: 600; }

  .creds { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-bottom: 1rem; }
  .creds input {
    flex: 1 1 14rem;
    height: 2.15rem;
    padding: 0 .7rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
  }
  .creds .save { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
  .creds .save:hover { opacity: .85; border-color: var(--ink); }
  /* One form, because they are one decision — who may come in, and how many
     may be here — and saving them separately would let an operator close
     registration and forget the ceiling. But a line each: both are sentences,
     and side by side they run together into one long row that pushes the save
     button up against the number field. */
  .creds .check { display: flex; align-items: center; gap: .45rem; flex: 0 0 100%; white-space: nowrap; font-size: .8125rem; color: var(--fg); }
  /* The checkbox ONLY. The rule above gives every input in this row a 14rem
     basis and a checkbox that took one would push its own label off the line —
     but the ceiling's number field is nested in a .check label too, and an
     unqualified input here handed it a 16px box: a number field one character
     wide, at a third the height of every other field on the page. That is the
     mismatch, so the selector names the type it means. */
  .creds .check input[type="checkbox"] { flex: none; width: 1rem; height: 1rem; accent-color: var(--ink); margin: 0; }
  /* Wide enough for four digits and the browser's spinner; the height comes
     from the .creds input rule, like every other field. */
  .creds input[type="number"] { flex: 0 0 6rem; }
  .card .note { margin: 0 0 1rem; color: var(--muted); font-size: .8125rem; line-height: 1.6; }

  .mint { display: flex; align-items: center; gap: .5rem; margin-bottom: 1.25rem; }
  .mint input {
    width: 5rem;
    height: 2.15rem;
    padding: 0 .7rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
  }
  .mint button { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
  .mint button:hover { opacity: .85; border-color: var(--ink); }

  /* Monospaced and selectable in one gesture: these are copied out and pasted
     into a chat window, which is the only thing anyone does with them. */
  .code { font-family: var(--mono); letter-spacing: .02em; user-select: all; }
  .code.spent { color: var(--muted); text-decoration: line-through; }

  /* A native dialog element rather than a hand-rolled overlay: the browser
     owns the focus trap, the escape key, inertness of the page behind, and the
     top layer, and it does all four better than this page would. */
  dialog {
    max-width: min(90vw, 26rem);
    padding: 1.25rem;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 1px 2px var(--shadow), 0 24px 48px var(--shadow);
  }
  dialog::backdrop { background: rgb(0 0 0 / 35%); }
  dialog h3 { margin: 0 0 .5rem; font-size: 1rem; font-weight: 600; }
  dialog p { margin: 0 0 1.25rem; color: var(--muted); font-size: .875rem; line-height: 1.6; }
  dialog .buttons { display: flex; justify-content: flex-end; gap: .5rem; }
  dialog button.go { border-color: var(--danger); background: var(--danger); color: #fff; }
  dialog button.go:hover { opacity: .9; border-color: var(--danger); }

  footer { padding: 1.5rem; text-align: center; color: var(--muted); font-size: .8125rem; }

  @media (max-width: 640px) {
    .hide-narrow { display: none; }
  }
</style>
</head>
<body>
${banner}
${THEME_TOGGLE}
<main>
  <div class="brand">
    <img src="/login-assets/hamster.svg" alt="">
    <span class="word">HamsterHQ</span>
    <span class="here">${escapeHtml(viewer)} · <a href="/">返回应用</a></span>
  </div>

  <h1>管理</h1>

  <section class="card">
    <h2>接入 <span class="hint">${accessHint}</span></h2>
    <form method="post" action="/admin/access" class="creds">
      <label class="check">
        <input type="checkbox" name="inviteRequired" value="on"${access.inviteRequired ? ' checked' : ''}>
        注册需要邀请码
      </label>
      <label class="check">
        沙箱上限
        <input type="number" name="sandboxLimit" min="0" max="10000" step="1" value="${access.sandboxLimit}" aria-label="沙箱上限">
      </label>
      <button type="submit" class="save">保存</button>
    </form>
    <p class="note">
      在线沙箱 ${escapeHtml(ceiling)}。上限填 0 表示不限；达到上限后，手上没有沙箱的账号既不能注册也不能登录，已在运行的租户不受影响。
    </p>
  </section>

  <section class="card">
    <h2>模型密钥 <span class="hint">${credentialHint}</span></h2>
    <form method="post" action="/admin/model" class="creds">
      <input name="baseUrl" value="${escapeHtml(credential.baseUrl)}" placeholder="接口地址" aria-label="接口地址" autocomplete="off" spellcheck="false">
      <input name="apiKey" type="password" placeholder="新密钥（留空则不改动）" aria-label="新密钥" autocomplete="new-password">
      <button type="submit" class="save">保存</button>
    </form>
  </section>

  <section class="card">
    <h2>管理员</h2>
    <table><tbody>
${adminRows}
    </tbody></table>
  </section>

  <section class="card">
    <h2>用户</h2>
    <table>
      <thead>
        <tr>
          <th>邮箱</th>
          <th class="hide-narrow">注册于</th>
          <th class="hide-narrow">最近登录</th>
          <th>沙箱</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>邀请码</h2>
    <form method="post" action="/admin/invites" class="mint">
      <input type="number" name="count" value="5" min="1" max="200" aria-label="生成数量">
      <button type="submit">生成</button>
    </form>
    <table>
      <thead>
        <tr>
          <th>邀请码</th>
          <th class="hide-narrow">生成于</th>
          <th>状态</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
${inviteRows}
      </tbody>
    </table>
  </section>
</main>

<dialog id="confirm">
  <h3 id="confirm-title">确认</h3>
  <p id="confirm-text"></p>
  <div class="buttons">
    <button type="button" value="cancel">取消</button>
    <button type="button" class="go" value="go">确认删除</button>
  </div>
</dialog>
<script>
  // Progressive: a form carrying data-confirm asks first when scripting is
  // on, and submits directly when it is off. The confirmation is a guard
  // against a misplaced click, not an authorisation step — the server decides
  // that — so losing it without JavaScript costs nothing that matters.
  (function () {
    var dialog = document.getElementById('confirm')
    var text = document.getElementById('confirm-text')

    document.addEventListener('submit', function (event) {
      var form = event.target
      if (!form.action || form.method.toLowerCase() !== 'post') return
      event.preventDefault()
      var message = form.dataset && form.dataset.confirm
      if (!message) { run(form); return }
      text.textContent = message
      dialog.returnValue = 'cancel'
      dialog.showModal()
      dialog.dataset.form = form.id
    })

    dialog.addEventListener('click', function (event) {
      var value = event.target.value
      if (value === undefined) return
      dialog.close()
      if (value !== 'go') return
      var form = document.getElementById(dialog.dataset.form)
      if (form) run(form)
    })

    // An action is a request, not a destination. Posting the form navigates,
    // which puts the outcome in the address bar and replays it on refresh; this
    // sends the same request without leaving the page, then reloads the console
    // into the same URL it was already on.
    function run(form) {
      fetch(form.action, {
        method: 'POST',
        headers: { 'X-Console-Action': 'fetch' },
        body: new URLSearchParams(new FormData(form)),
      }).then(function (response) {
        // A session that expired mid-visit answers with the login page rather
        // than an outcome. Submitting normally is what gets the person there.
        if (!response.ok) { form.submit(); return }
        return response.json().then(function (body) { return refresh(body.notice) })
      }).catch(function () { form.submit() })
    }

    // The console re-read from the server rather than patched here, so what is
    // on screen is what it would serve — one description of the page, not two.
    function refresh(notice) {
      return fetch('/admin', { headers: { Accept: 'text/html' } })
        .then(function (response) { return response.text() })
        .then(function (html) {
          var fresh = new DOMParser().parseFromString(html, 'text/html')
          var main = fresh.querySelector('main')
          if (main) document.querySelector('main').replaceWith(main)
          announce(notice)
        })
    }

    // The toast the server would have rendered, raised here because the page
    // never reloaded to receive one.
    function announce(notice) {
      if (!notice) return
      var existing = document.querySelector('.toast')
      if (existing) existing.remove()
      var node = document.createElement('div')
      node.className = 'toast'
      node.textContent = notice
      document.body.appendChild(node)
      setTimeout(function () { node.remove() }, 4000)
    }
  })()
</script>
<footer>HamsterHQ · 自建部署${release}</footer>
</body>
</html>
`
}

/**
 * One administrator's row.
 *
 * No suspend and no delete. Suspending an administrator would leave them able
 * to sign in again — their admission comes from the environment, which this
 * page cannot edit — and deleting the account only makes them register it once
 * more. Offering either would be offering an action that does not do what it
 * says.
 *
 * @param {import('./accounts.js').Account & {sandbox: string}} account - the account and the state of its sandbox.
 * @param {string} viewer - the administrator's own address.
 * @returns {string} the row markup.
 */
function adminRow(account, viewer) {
  const sandbox = account.sandbox === 'running'
    ? `<span class="tag live">运行中</span> ${action('/admin/release', account.email, '回收沙箱')}`
    : '<span class="sub">未运行</span>'
  return `      <tr>
        <td><div class="email">${escapeHtml(account.email)}</div></td>
        <td class="hide-narrow sub">最近登录 ${when(account.lastSeenAt)}</td>
        <td class="actions">${account.email === viewer ? '<span class="sub">当前登录 · </span>' : ''}${sandbox}</td>
      </tr>`
}

/**
 * One invite's row.
 * @param {{code: string, createdAt: number, redeemedAt: number | undefined, redeemedBy: string | undefined}} invite - the invite.
 * @returns {string} the row markup.
 */
function inviteRow(invite) {
  const spent = invite.redeemedAt !== undefined
  const status = spent
    ? `<span class="sub">${escapeHtml(invite.redeemedBy ?? '')} · ${when(invite.redeemedAt)}</span>`
    : '<span class="tag live">未使用</span>'
  // A redeemed invite is the record of how an account came to exist, so deleting
  // one erases that record rather than revoking anything — hence a confirmation
  // on that side and none on the other, where there is nothing to lose.
  const actions = spent
    ? action('/admin/invites/discard', invite.code, '删除', 'code',
        `删除 ${invite.code} 吗？它是 ${invite.redeemedBy ?? ''} 注册来源的记录，删除后无法恢复。`)
    : action('/admin/invites/discard', invite.code, '删除', 'code')
  return `      <tr>
        <td><span class="code${spent ? ' spent' : ''}">${escapeHtml(invite.code)}</span></td>
        <td class="hide-narrow sub">${when(invite.createdAt)}</td>
        <td>${status}</td>
        <td class="actions">${actions}</td>
      </tr>`
}

/**
 * One account's row.
 * @param {import('./accounts.js').Account & {sandbox: string}} account - the account and the state of its sandbox.
 * @param {string} viewer - the administrator's own address.
 * @returns {string} the row markup.
 */
function row(account, viewer) {
  const self = account.email === viewer
  const email = escapeHtml(account.email)
  const tags = [
    account.admin ? '<span class="tag admin">管理员</span>' : '',
    account.disabled ? '<span class="tag off">已停用</span>' : '',
  ].filter((tag) => tag !== '').join(' ')

  const sandbox = account.sandbox === 'running'
    ? '<span class="tag live">运行中</span>'
    : '<span class="sub">未运行</span>'

  // An administrator is not offered their own suspend or delete button. Both
  // would work, and the second would take away the account that is the only way
  // back in — the failure mode is a deployment nobody can administer.
  const actions = self
    ? '<span class="sub">当前登录</span>'
    : `${action('/admin/toggle', account.email, account.disabled ? '恢复' : '停用')}
      ${account.sandbox === 'running' ? action('/admin/release', account.email, '回收沙箱') : ''}
      ${action('/admin/delete', account.email, '删除', 'email', '删除 ' + account.email + ' 吗？其会话、工作区与沙箱都会一并消失，且无法恢复。')}`

  return `      <tr>
        <td><div class="email">${email}</div>${tags === '' ? '' : `<div>${tags}</div>`}</td>
        <td class="hide-narrow sub">${when(account.createdAt)}</td>
        <td class="hide-narrow sub">${when(account.lastSeenAt)}</td>
        <td>${sandbox}</td>
        <td class="actions">${actions}</td>
      </tr>`
}

/**
 * One action button, as its own form.
 * @param {string} action - the endpoint to post to.
 * @param {string} subject - what it acts on: an address, or an invite code.
 * @param {string} label - the button text.
 * @param {string} [field] - the form field naming the subject.
 * @param {string} [confirm] - text to confirm with before submitting; omitted for reversible actions.
 * @returns {string} the form markup.
 */
function action(action, subject, label, field = 'email', confirm) {
  // The message rides on the form rather than in an inline handler, so the
  // page's one dialog can ask it and no markup carries executable script.
  const id = `f${(formSequence += 1)}`
  const guard = confirm === undefined ? '' : ` data-confirm="${escapeHtml(confirm)}"`
  return `<form method="post" action="${action}" id="${id}"${guard}>
        <input type="hidden" name="${field}" value="${escapeHtml(subject)}">
        <button type="submit"${confirm === undefined ? '' : ' class="danger"'}>${escapeHtml(label)}</button>
      </form>`
}

/** Distinguishes the forms on one page, so the dialog can submit the right one. */
let formSequence = 0
