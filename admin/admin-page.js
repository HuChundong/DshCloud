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

import { BRAND_CSS, CONSOLE_NOTICES, FONT_PRELOAD, PALETTE_CSS, THEME_TOGGLE, TOAST_CSS, WORDMARK, escapeHtml, langToggle, toast, toastEntry } from '../gateway/src/page-chrome.js'
import { asset } from '../gateway/src/page-assets.js'
import { cssUrl } from 'dsh-icons'
import { PLANS } from '../gateway/src/plans.js'
import { describeKey } from '../gateway/src/settings.js'

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
 * @param {{enabled: boolean, source: string, recoveryLeft: number, updatedAt: number|undefined, updatedBy: string|undefined, qr: string|undefined, secret: string|undefined, freshCodes: string[]|undefined}} state.security - the second factor: whether one is in force, and any enrolment half-finished.
 * @param {string} state.viewer - the administrator's own address, so the page can refuse to offer them their own delete button.
 * @param {string | {code: string, params?: object}} [state.notice] - the outcome of the action that led here, as a message code rather than a sentence.
 * @param {string} [state.version] - the dsh release this deployment runs.
 * @returns {string} the HTML document.
 */
export function adminPage(state) {
  const { accounts, invites, credential, access, security, viewer, notice, version } = state
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
    ? '<tr><td class="empty" data-t="empty.admins">GATEWAY_ADMINS 里的地址还没有登录过。</td></tr>'
    : admins.map((account) => adminRow(account, viewer)).join('\n')
  const rows = tenants.length === 0
    ? '<tr><td colspan="6" class="empty" data-t="empty.tenants">还没有人注册。</td></tr>'
    : tenants.map((account) => row(account)).join('\n')

  // Which credential is in force is state, not explanation: an operator cannot
  // read it off the form, because the form never shows the key back.
  const credentialHint = credential.source === 'console'
    ? `${describeKey(credential.apiKey)} · ${escapeHtml(credential.updatedBy ?? '')} · ${when(credential.updatedAt)}`
    : `${describeKey(credential.apiKey)} · <span data-t="env">环境变量</span>`
  // Where the gate came from, for the same reason the credential says so: an
  // operator reading a switch needs to know whether the console owns it or the
  // compose file does, because that decides where a change has to be made.
  const accessHint = access.source === 'console'
    ? `${escapeHtml(access.updatedBy ?? '')} · ${when(access.updatedAt)}`
    : '<span data-t="env">环境变量</span>'
  // The ceiling alone, with nothing running counted against it.
  //
  // It used to read `3 / 20`, and the left-hand number came from the gateway,
  // which is where sandboxes are. This console is a separate service now and
  // does not hold a connection to the platform or to the gateway — so that
  // number arrived as `undefined` and the card read `undefined / 20`.
  //
  // Restored as the ceiling rather than refetched, for the reason the accounts
  // table no longer has a sandbox column: a count this page learned from a
  // third party some seconds ago is worse than a count it does not show. How
  // many are running is a question for wherever machines are managed.
  const ceiling = access.sandboxLimit === 0 ? undefined : String(access.sandboxLimit)
  // The ceiling reads as a number or as a word, and the word is a word in
  // each language — so it goes through the table rather than into the sentence
  // as text.
  // Composed here rather than shipped in two pieces: the word is only ever seen
  // inside this sentence, so the sentence is what the table carries.
  const unlimited = { zh: '不限', en: 'no limit' }
  const note = {
    zh: S['access.note'].zh.replace('{0}', ceiling ?? unlimited.zh),
    en: S['access.note'].en.replace('{0}', ceiling ?? unlimited.en),
  }

  // Everything the console says: the static strings the row helpers share, plus
  // the one sentence that has a number in it and whatever the banner is saying.
  // `MESSAGES` as well as this page's own strings, because the toast this page
  // raises after an action is built in the browser rather than rendered here:
  // the server answers an action with a CODE, and the code has to be lookup-able
  // on the page that shows it. Entries nobody names cost a line of JSON each and
  // are what lets a message be added to that table alone.

  // The second factor, in whichever of its three states it is. Enrolling is a
  // state and not a separate page on purpose: the square being scanned and the
  // field that proves it was scanned belong beside each other, and a page that
  // navigated between them would be a page you can be halfway through when the
  // enrolment times out.
  // The remaining-codes count is substituted the way `access.note` is: the
  // string carries a placeholder so both languages keep one sentence.
  const left = String(security.recoveryLeft)
  const tfaOnNote = {
    zh: S['tfa.on.note'].zh.replace('{0}', left),
    en: S['tfa.on.note'].en.replace('{0}', left),
  }

  const tfaHint = security.enabled
    ? security.source === 'environment'
      ? '<span data-t="tfa.env">由环境变量配置</span>'
      : `<span data-t="tfa.on">已开启</span>${security.updatedAt === undefined ? '' : ` · ${when(security.updatedAt)}`}`
    : '<span data-t="tfa.off">未开启</span>'

  const tfaBody = security.freshCodes !== undefined
    // Shown once, and this is the once. They are stored as digests, so this
    // page is the only place they will ever exist in a readable form.
    ? `<p class="note" data-t="tfa.codes.note">备用码。每个只能用一次，用于手机丢失时登录。现在保存好——离开这个页面后无法再看到。</p>
    <ol class="codes">${security.freshCodes.map((code) => `<li>${escapeHtml(code)}</li>`).join('')}</ol>
    <form method="post" action="/security/dismiss"><button type="submit" class="save" data-t="tfa.codes.done">我已保存</button></form>`
    : security.qr !== undefined
      ? `<p class="note" data-t="tfa.scan">用验证器 App 扫描下面的二维码，然后输入它显示的 6 位数字。验证通过后才会真正开启。</p>
      <div class="qr">${security.qr}</div>
      <p class="secret" data-t="tfa.manual">扫不上可以手动输入：</p>
      <p class="secret-value">${escapeHtml(security.secret ?? '')}</p>
      <form method="post" action="/security/activate" class="creds">
        <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code" data-tp="tfa.code" placeholder="6 位验证码" aria-label="6 位验证码">
        <button type="submit" class="save" data-t="tfa.verify">验证并开启</button>
      </form>
      <form method="post" action="/security/cancel"><button type="submit" class="quiet" data-t="tfa.cancel">取消</button></form>`
      : security.enabled
        ? security.source === 'environment'
          ? `<p class="note" data-t="tfa.env.note">密钥来自 ADMIN_TOTP_SECRET，由部署方在环境里管理，这里不能改。删掉那一行并重启，就可以在这里自助开启。</p>`
          : `<p class="note" data-t="tfa.on.note">${escapeHtml(tfaOnNote.zh)}</p>
          <form method="post" action="/security/recovery" class="creds">
            <input name="password" type="password" required autocomplete="current-password" data-tp="tfa.password" placeholder="当前密码" aria-label="当前密码">
            <button type="submit" class="save" data-t="tfa.remint">重新生成备用码</button>
          </form>
          <form method="post" action="/security/disable" class="creds">
            <input name="password" type="password" required autocomplete="current-password" data-tp="tfa.password" placeholder="当前密码" aria-label="当前密码">
            <button type="submit" class="danger" data-t="tfa.disable" data-confirm="tfa.confirm">关闭两步验证</button>
          </form>`
        : `<p class="note" data-t="tfa.off.note">现在只有一个密码挡在这个控制台前面，而这个控制台能改动每一个账户。开启后，登录还需要验证器 App 上的 6 位数字。</p>
        <form method="post" action="/security/begin" class="creds">
          <input name="password" type="password" required autocomplete="current-password" data-tp="tfa.password" placeholder="当前密码" aria-label="当前密码">
          <button type="submit" class="save" data-t="tfa.begin">开启两步验证</button>
        </form>`

  const table = { ...CONSOLE_NOTICES, ...S, 'access.note': note, 'tfa.on.note': tfaOnNote, 'doc.title': { zh: '用户管理 · HamsterHQ', en: 'Console · HamsterHQ' }, ...toastEntry(undefined, notice) }

  const inviteRows = invites.length === 0
    ? '<tr><td colspan="4" class="empty" data-t="empty.invites">还没有邀请码。</td></tr>'
    : invites.map(inviteRow).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>用户管理 · HamsterHQ</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${asset('favicon.svg')}">
${FONT_PRELOAD}
<style>
${PALETTE_CSS}
${BRAND_CSS}
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

  /* The tier picker, sized and coloured as the buttons beside it so the row
     reads as one strip of controls rather than a form dropped into a table.
     appearance:none is what stops the platform from painting its own grey
     box over the theme on the dark page. */
  .plan { display: inline-flex; align-items: center; gap: .4rem; }
  .plan select {
    appearance: none;
    padding: .35rem 1.6rem .35rem .7rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: .8125rem;
    cursor: pointer;
    /* The chevron, drawn rather than fetched: this page reaches no other host.
       Its ink is stated because a data: URI is a document of its own and
       currentColor inside one resolves against nothing; the value is --muted's,
       which reads on both grounds. */
    background-image: ${cssUrl('chevron-down', '#808184', 16)};
    background-repeat: no-repeat;
    background-position: right .45rem center;
    background-size: 14px 14px;
  }
  .plan select:hover { border-color: var(--muted); }
  /* Hidden by the page's script, which submits on change instead. It is here
     for the visit with no scripting, where it is the only way to send this. */
  .plan button[hidden] { display: none; }

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

  /* The enrolment square. A white ground in both themes, and that is not an
     oversight: a scanner reads dark modules on a light one, so inverting it
     for the dark page would make the console tidier and the code unreadable.
     The same reason the tenants' sign-in page keeps its WeChat code white. */
  .qr {
    display: inline-block;
    padding: 10px;
    margin: 0 0 1rem;
    border-radius: 10px;
    background: #fff;
    line-height: 0;
  }
  .qr svg { display: block; width: 168px; height: 168px; }

  /* The secret in readable form, for a phone that cannot use its camera.
     Monospace and spaced out, because it is going to be typed by hand. */
  .secret { margin: 0 0 .25rem; color: var(--muted); font-size: .8125rem; }
  .secret-value {
    margin: 0 0 1rem;
    font-family: var(--mono);
    font-size: .875rem;
    letter-spacing: .08em;
    word-break: break-all;
    user-select: all;
  }

  /* Recovery codes, shown once. Two columns so ten of them are one glance
     rather than one scroll, and tabular figures so they line up. */
  .codes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .375rem 1rem;
    margin: 0 0 1rem;
    padding: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-field);
    background: var(--bg);
    list-style: none;
    counter-reset: code;
    font-family: var(--mono);
    font-size: .875rem;
    font-variant-numeric: tabular-nums;
    user-select: all;
  }
  .codes li::before {
    counter-increment: code;
    content: counter(code) '. ';
    color: var(--faint);
  }

  /* The way out of an enrolment, beside the way through it. Quiet, because
     one of the two is the thing you came here to do. */
  button.quiet { border-color: transparent; color: var(--muted); }
  button.quiet:hover { border-color: var(--line); color: var(--fg); }

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
${langToggle(table)}
<main>
  <div class="brand">
    <img src="${asset('hamster.svg')}" alt="">
    ${WORDMARK}
    <!-- Sign out, not "back to the app". This console has its own hostname,
         where the root is this page — the old link pointed at the page it was
         on. And an operator console with no way out is a session left open on
         whatever machine it was opened from. -->
    <span class="here">${escapeHtml(viewer)} · <a href="/sign-out" data-t="back">退出</a></span>
  </div>

  <h1 data-t="h">管理</h1>

  <section class="card">
    <h2><span data-t="access.h">接入</span> <span class="hint">${accessHint}</span></h2>
    <form method="post" action="/access" class="creds">
      <label class="check">
        <input type="checkbox" name="inviteRequired" value="on"${access.inviteRequired ? ' checked' : ''}>
        <span data-t="access.invite">注册需要邀请码</span>
      </label>
      <label class="check">
        <span data-t="access.limit">沙箱上限</span>
        <input type="number" name="sandboxLimit" min="0" max="10000" step="1" value="${access.sandboxLimit}" data-ta="access.limit" aria-label="沙箱上限">
      </label>
      <button type="submit" class="save" data-t="save">保存</button>
    </form>
    <p class="note" data-t="access.note">${escapeHtml(note.zh)}</p>
  </section>

  <section class="card">
    <h2><span data-t="model.h">模型密钥</span> <span class="hint">${credentialHint}</span></h2>
    <form method="post" action="/model" class="creds">
      <input name="baseUrl" value="${escapeHtml(credential.baseUrl)}" data-tp="model.url" placeholder="接口地址" aria-label="接口地址" autocomplete="off" spellcheck="false">
      <input name="apiKey" type="password" data-tp="model.key" placeholder="新密钥（留空则不改动）" aria-label="新密钥" autocomplete="new-password">
      <button type="submit" class="save" data-t="save">保存</button>
    </form>
  </section>

  <section class="card">
    <h2><span data-t="tfa.h">两步验证</span> <span class="hint">${tfaHint}</span></h2>
${tfaBody}
  </section>

  <section class="card">
    <h2 data-t="admins.h">管理员</h2>
    <table><tbody>
${adminRows}
    </tbody></table>
  </section>

  <section class="card">
    <h2 data-t="users.h">用户</h2>
    <table>
      <thead>
        <tr>
          <th data-t="th.email">邮箱</th>
          <th class="hide-narrow" data-t="th.created">注册于</th>
          <th class="hide-narrow" data-t="th.seen">最近登录</th>
          <th data-t="th.plan">套餐</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2 data-t="invites.h">邀请码</h2>
    <form method="post" action="/invites" class="mint">
      <input type="number" name="count" value="5" min="1" max="200" data-ta="invites.count" aria-label="生成数量">
      <button type="submit" data-t="invites.mint">生成</button>
    </form>
    <table>
      <thead>
        <tr>
          <th data-t="th.code">邀请码</th>
          <th class="hide-narrow" data-t="th.minted">生成于</th>
          <th data-t="th.status">状态</th>
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
  <h3 id="confirm-title" data-t="confirm.title">确认</h3>
  <p id="confirm-text"></p>
  <div class="buttons">
    <button type="button" value="cancel" data-t="cancel">取消</button>
    <button type="button" class="go" value="go" data-t="confirm.go">确认删除</button>
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
      var key = form.dataset && form.dataset.confirm
      if (!key) { run(form); return }
      // Looked up now rather than rendered earlier: the dialog opens long after
      // the page did, and by then the reader may have changed language.
      var message = window.dshText(key)
      var args = JSON.parse(form.dataset.confirmArgs || '[]')
      for (var i = 0; i < args.length; i += 1) message = message.replace('{' + i + '}', args[i])
      text.textContent = message
      dialog.returnValue = 'cancel'
      dialog.showModal()
      dialog.dataset.form = form.id
    })

    // The tier picker sends itself, through requestSubmit rather than submit:
    // only the former fires the submit event, and form.submit() would
    // navigate straight past the handler above and put the outcome in the
    // address bar, which is the thing that handler exists to prevent.
    //
    // Delegated on the document, not bound per form: the refresh below replaces
    // the whole of main after every action, so anything bound to a row is bound
    // to a row that is about to be thrown away.
    document.addEventListener('change', function (event) {
      var select = event.target
      if (!select.matches || !select.matches('.plan select')) return
      select.form.requestSubmit()
    })

    // Scripting is on, so the picker's own button is the second way to do what
    // the change above already did. Hidden here rather than left out of the
    // markup, because the server cannot know whether this ever runs.
    function hidePlanButtons(root) {
      var buttons = root.querySelectorAll('.plan button')
      for (var i = 0; i < buttons.length; i += 1) buttons[i].hidden = true
    }
    hidePlanButtons(document)

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
      return fetch('/', { headers: { Accept: 'text/html' } })
        .then(function (response) { return response.text() })
        .then(function (html) {
          var fresh = new DOMParser().parseFromString(html, 'text/html')
          var main = fresh.querySelector('main')
          if (main) {
            document.querySelector('main').replaceWith(main)
            // The replacement arrived as the server writes it: Chinese, with
            // every picker's button visible. Neither is what this visit is in.
            window.dshApply()
            hidePlanButtons(main)
          }
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
      // A code and its subjects, looked up now. The server sends what happened
      // rather than a sentence about it, so this is where it becomes one — in
      // the language this reader is in, which is the whole reason the server
      // does not word it.
      node.textContent = typeof notice === 'string'
        ? window.dshText(notice)
        : window.dshText(notice.code, notice.params)
      document.body.appendChild(node)
      setTimeout(function () { node.remove() }, 4000)
    }
  })()
</script>
<footer><span data-t="footer">HamsterHQ · 自建部署</span>${release}</footer>
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
 * @param {import('../gateway/src/accounts.js').Account} account - the account.
 * @param {string} viewer - the administrator's own address.
 * @returns {string} the row markup.
 */
function adminRow(account, viewer) {
  return `      <tr>
        <td><div class="email">${escapeHtml(account.email)}</div></td>
        <td class="hide-narrow sub"><span data-t="seen">最近登录</span> ${when(account.lastSeenAt)}</td>
        <td class="actions">${account.email === viewer ? '<span class="sub" data-t="self.sep">当前登录</span>' : ''}</td>
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
    : '<span class="tag live" data-t="tag.unused">未使用</span>'
  // A redeemed invite is the record of how an account came to exist, so deleting
  // one erases that record rather than revoking anything — hence a confirmation
  // on that side and none on the other, where there is nothing to lose.
  const actions = spent
    ? action('/invites/discard', invite.code, 'act.delete', 'code',
        'confirm.invite', [invite.code, invite.redeemedBy ?? ''])
    : action('/invites/discard', invite.code, 'act.delete', 'code')
  return `      <tr>
        <td><span class="code${spent ? ' spent' : ''}">${escapeHtml(invite.code)}</span></td>
        <td class="hide-narrow sub">${when(invite.createdAt)}</td>
        <td>${status}</td>
        <td class="actions">${actions}</td>
      </tr>`
}

/**
 * One tenant's row.
 *
 * Takes no viewer, because it cannot be one: this renders the accounts that are
 * NOT administrators, and the only person reading this page is.
 *
 * @param {import('../gateway/src/accounts.js').Account} account - the account.
 * @returns {string} the row markup.
 */
function row(account) {
  const email = escapeHtml(account.email)
  // Only the suspension tag. An administrator's tag cannot appear here: this
  // renders tenants, and `accounts.filter((account) => !account.admin)` is what
  // decides who is one — the administrators went to `adminRow`.
  const tags = account.disabled ? '<span class="tag off" data-t="tag.off">已停用</span>' : ''

  // No guard for the viewer's own row here, and none needed: an administrator
  // looking at this page is not in this table. `adminRow` is where their row is
  // drawn, and that is where the refusal to offer a self-delete lives.
  const actions = `${action('/toggle', account.email, account.disabled ? 'act.enable' : 'act.disable')}
      ${action('/delete', account.email, 'act.delete', 'email', 'confirm.account', [account.email])}`

  return `      <tr>
        <td><div class="email">${email}</div>${tags === '' ? '' : `<div>${tags}</div>`}</td>
        <td class="hide-narrow sub">${when(account.createdAt)}</td>
        <td class="hide-narrow sub">${when(account.lastSeenAt)}</td>
        <td>${planPicker(account)}</td>
        <td class="actions">${actions}</td>
      </tr>`
}

/**
 * The control that moves one tenant between tiers.
 *
 * A select rather than a button per tier, which is what the rest of this
 * column is: three tiers beside the three actions already there would be six
 * things to aim at in one row, and the list is meant to grow.
 *
 * Its own form, like every other action here, and the current tier is the
 * selected option rather than a separate label — the control states the fact
 * and changes it, which is one thing to read instead of two that can disagree.
 *
 * The submit button is real markup and not decoration: without scripting it is
 * the only way to send the change, and the page's script hides it and submits
 * on change instead. That order matters — rendering the button only when
 * scripting is on is not something server-rendered HTML can know.
 *
 * @param {import('./accounts.js').Account} account - the tenant.
 * @returns {string} the form markup.
 */
function planPicker(account) {
  const id = `f${(formSequence += 1)}`
  const options = PLANS.map((plan) => {
    const chosen = plan === account.plan ? ' selected' : ''
    return `<option value="${plan}"${chosen} data-t="plan.${plan}">${escapeHtml(S[`plan.${plan}`].zh)}</option>`
  }).join('')
  return `<form method="post" action="/plan" id="${id}" class="plan">
        <input type="hidden" name="email" value="${escapeHtml(account.email)}">
        <select name="plan" data-ta="th.plan" aria-label="套餐">${options}</select>
        <button type="submit" data-t="save">保存</button>
      </form>`
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
function action(action, subject, label, field = 'email', confirm, args = []) {
  // The message rides on the form rather than in an inline handler, so the
  // page's one dialog can ask it and no markup carries executable script. It is
  // a KEY and its subjects, not a sentence: the dialog opens long after the
  // page was rendered, and by then the reader may have changed language.
  const id = `f${(formSequence += 1)}`
  const guard = confirm === undefined
    ? ''
    : ` data-confirm="${confirm}" data-confirm-args="${escapeHtml(JSON.stringify(args))}"`
  return `<form method="post" action="${action}" id="${id}"${guard}>
        <input type="hidden" name="${field}" value="${escapeHtml(subject)}">
        <button type="submit"${confirm === undefined ? '' : ' class="danger"'} data-t="${label}">${escapeHtml(S[label].zh)}</button>
      </form>`
}

/**
 * Everything this console says, in both languages.
 *
 * At module scope because the row helpers say most of it, and they are
 * functions of one account rather than of the page. They render the Chinese
 * from here and name the key beside it; `adminPage` sends the whole table to
 * the browser, which is what lets the toggle rewrite a row a helper built.
 *
 * `{0}` is substituted at the point of use — the confirm sentences name a
 * subject, and one entry with a hole in it is a table that does not grow with
 * the number of rows.
 */
const S = {
  h:      { zh: '管理', en: 'Console' },
  back:   { zh: '退出', en: 'Sign out' },
  save:   { zh: '保存', en: 'Save' },
  cancel: { zh: '取消', en: 'Cancel' },
  env:    { zh: '环境变量', en: 'environment' },

  // `describeKey` renders these; the credential itself is never shown back.
  'key.unset': { zh: '未设置', en: 'not set' },
  'key.set':   { zh: '已设置', en: 'set' },
  'key.tail':  { zh: '末四位', en: 'last four' },
  footer: { zh: 'HamsterHQ · 自建部署', en: 'HamsterHQ · self-hosted' },

  'access.h':      { zh: '接入', en: 'Access' },
  'access.invite': { zh: '注册需要邀请码', en: 'Registration needs an invite code' },
  'access.limit':  { zh: '沙箱上限', en: 'Sandbox ceiling' },
  'access.note':   {
    zh: '沙箱上限 {0}。填 0 表示不限；达到上限后，手上没有沙箱的账号既不能注册也不能登录，已在运行的租户不受影响。当前在线数由平台侧统计，这里不显示。',
    en: 'Sandbox ceiling: {0}. A ceiling of 0 means no limit. Once it is reached, an account without a sandbox can neither register nor sign in; tenants already running are unaffected. How many are running is counted where machines are managed, not here.',
  },

  'model.h':   { zh: '模型密钥', en: 'Model credential' },
  'model.url': { zh: '接口地址', en: 'Endpoint' },
  'model.key': { zh: '新密钥（留空则不改动）', en: 'New key (leave empty to keep the current one)' },

  'tfa.h':   { zh: '两步验证', en: 'Two-step verification' },
  'tfa.on':  { zh: '已开启', en: 'on' },
  'tfa.off': { zh: '未开启', en: 'off' },
  'tfa.env': { zh: '由环境变量配置', en: 'set in the environment' },
  'tfa.off.note': {
    zh: '现在只有一个密码挡在这个控制台前面，而这个控制台能改动每一个账户。开启后，登录还需要验证器 App 上的 6 位数字。',
    en: 'One password is all that stands in front of this console, and this console can change every account. With this on, signing in also takes the six digits from an authenticator app.',
  },
  'tfa.on.note': {
    zh: '登录时会要求输入验证器上的 6 位数字。剩余备用码：{0}。',
    en: 'Signing in asks for the six digits from your authenticator. Recovery codes left: {0}.',
  },
  'tfa.env.note': {
    zh: '密钥来自 ADMIN_TOTP_SECRET，由部署方在环境里管理，这里不能改。删掉那一行并重启，就可以在这里自助开启。',
    en: 'The secret comes from ADMIN_TOTP_SECRET, managed by the deployment rather than here. Remove that line and restart to enrol from this page instead.',
  },
  'tfa.begin':    { zh: '开启两步验证', en: 'Turn on two-step verification' },
  'tfa.password': { zh: '当前密码', en: 'Current password' },
  'tfa.scan': {
    zh: '用验证器 App 扫描下面的二维码，然后输入它显示的 6 位数字。验证通过后才会真正开启。',
    en: 'Scan this with an authenticator app, then type the six digits it shows. Nothing is turned on until those digits check out.',
  },
  'tfa.manual': { zh: '扫不上可以手动输入：', en: 'Or type the secret in by hand:' },
  'tfa.code':   { zh: '6 位验证码', en: 'Six-digit code' },
  'tfa.verify': { zh: '验证并开启', en: 'Verify and turn on' },
  'tfa.cancel': { zh: '取消', en: 'Cancel' },
  'tfa.remint': { zh: '重新生成备用码', en: 'Replace recovery codes' },
  'tfa.disable': { zh: '关闭两步验证', en: 'Turn two-step verification off' },
  'tfa.confirm': {
    zh: '关闭后，只要有密码就能进入这个控制台。确定关闭？',
    en: 'With this off, the password alone opens this console. Turn it off?',
  },
  'tfa.codes.note': {
    zh: '备用码。每个只能用一次，用于手机丢失时登录。现在保存好——离开这个页面后无法再看到。',
    en: 'Recovery codes. Each works once, for signing in when the phone is not to hand. Save them now — they are stored hashed and this page is the only place they are readable.',
  },
  'tfa.codes.done': { zh: '我已保存', en: 'Saved them' },

  'admins.h': { zh: '管理员', en: 'Administrators' },
  'users.h':  { zh: '用户', en: 'Tenants' },

  'th.email':    { zh: '邮箱', en: 'Email' },
  'th.created':  { zh: '注册于', en: 'Registered' },
  'th.seen':     { zh: '最近登录', en: 'Last seen' },
  'th.plan':     { zh: '套餐', en: 'Plan' },
  'th.code':     { zh: '邀请码', en: 'Code' },
  'th.minted':   { zh: '生成于', en: 'Created' },
  'th.status':   { zh: '状态', en: 'Status' },

  // The tiers, worded. `plans.js` holds the ids and refuses to hold these:
  // a name has a language, and which language this page is in is a choice its
  // reader makes in the browser. The account plugin carries its own copy of the
  // same three words for the same reason the palette is written out twice — two
  // documents, no build step between them, and the only thing that can keep
  // them saying the same thing is that the words here are the words there.
  'plan.free': { zh: '免费', en: 'Free' },
  'plan.pro':  { zh: '专业', en: 'Pro' },
  'plan.team': { zh: '团队', en: 'Team' },

  'invites.h':     { zh: '邀请码', en: 'Invite codes' },
  'invites.count': { zh: '生成数量', en: 'How many' },
  'invites.mint':  { zh: '生成', en: 'Generate' },

  'empty.admins':  { zh: 'GATEWAY_ADMINS 里的地址还没有登录过。', en: 'No address in GATEWAY_ADMINS has signed in yet.' },
  'empty.tenants': { zh: '还没有人注册。', en: 'Nobody has registered yet.' },
  'empty.invites': { zh: '还没有邀请码。', en: 'No invite codes yet.' },

  // Sentence case, like every other standalone string in this deployment. These
  // were lowercase as a set — internally consistent, and disagreeing with the
  // rest of the product on the one word it says most: a tenant reads `Running`
  // in their own sidebar and an operator read `running` for the same sandbox.
  // The lowercase fragments below (`env`, `key.set`, `self.sep`) stay lowercase
  // because they are read INSIDE a sentence rather than as a label of their own.
  'tag.off':    { zh: '已停用', en: 'Disabled' },
  'tag.unused': { zh: '未使用', en: 'Unused' },
  'act.delete':  { zh: '删除', en: 'Delete' },
  'act.enable':  { zh: '恢复', en: 'Enable' },
  'act.disable': { zh: '停用', en: 'Disable' },

  'self.sep': { zh: '当前登录 · ', en: 'signed in now · ' },
  seen:      { zh: '最近登录', en: 'Last seen' },

  'confirm.title': { zh: '确认', en: 'Confirm' },
  'confirm.go':    { zh: '确认删除', en: 'Delete it' },
  'confirm.account': {
    zh: '删除 {0} 吗？其会话、工作区与沙箱都会一并消失，且无法恢复。',
    en: 'Delete {0}? Their sessions, workspace and sandbox go with the account, and cannot be recovered.',
  },
  'confirm.invite': {
    zh: '删除 {0} 吗？它是 {1} 注册来源的记录，删除后无法恢复。',
    en: 'Delete {0}? It is the record of how {1} came to register, and cannot be recovered.',
  },
}

/** Distinguishes the forms on one page, so the dialog can submit the right one. */
let formSequence = 0
