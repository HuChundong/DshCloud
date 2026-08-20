/**
 * The login page. Inlined rather than served from the web container because it
 * must work before any sandbox exists and must not depend on the frontend
 * bundle loading.
 *
 * It is the landing page's second screen and is dressed as one: the same
 * lattice ground running behind it, the same palette, the same faces, the same
 * capsule-and-pill vocabulary. Before that it was a white form on a white page
 * beside a black-and-grey one, and the seam showed the moment anyone crossed
 * it — someone who pressed "开始使用" arrived somewhere that looked like a
 * different deployment. Everything that decides how the two look now lives in
 * `page-chrome.js`, stated in the landing page's own numbers.
 *
 * The layout is still the product's own sign-in layout — centred wordmark over
 * a form column beside a panel — so the deployment does not hand its users a
 * second, unrelated visual identity before the app they are signing into. Where
 * the hosted product puts a scan-to-sign-in code, this puts the deployment's
 * WeChat account: signing in here is a mailed code rather than a scan, and the
 * panel is the one place on the page worth picking up a phone for.
 *
 * Where the hosted product puts terms of use, so does this: the consent line
 * above the button links the three documents and the box has to be ticked
 * before anything is sent. The durability warning that used to stand in their
 * place — sandboxes reclaimed when idle, reaped on every restart, nothing
 * backed up — is gone from the form and said in the terms being agreed to,
 * where it belongs now that there are terms. A form whose largest block of text
 * is a warning is a form people stop reading before they reach the button.
 *
 * It follows the visitor's system theme and offers a toggle over it. Dark is not
 * a darkened light: `--ink` is the accent as much as the ink — the button fill,
 * the focus ring — so it inverts, because a black button on a black page is not
 * a button.
 */

import { POLICY_VERSION, policyLinks } from './policy-page.js'
import {
  FONT_PRELOAD,
  GROUND_CSS,
  GROUND_HTML,
  GROUND_SCRIPT,
  PALETTE_CSS,
  THEME_TOGGLE,
  langToggle,
  toastEntry,
  TOAST_CSS,
  escapeHtml,
  toast,
} from './page-chrome.js'

import { asset } from './page-assets.js'
/**
 * Render the login page.
 *
 * One page in two states, told apart by whether a code is outstanding. Both are
 * plain form posts to the same endpoint, so signing in needs no JavaScript —
 * which matters because this page is what a visitor sees when the frontend
 * bundle has not loaded and may be why it has not. The ground behind it is the
 * only scripted thing on the page, and it is a canvas nothing depends on.
 *
 * @param {object} [state] - what to show.
 * @param {string} [state.error] - what went wrong with the previous attempt.
 * @param {string} [state.notice] - what went right with it.
 * @param {string} [state.pending] - the address a code was just sent to; switches the form to its second state.
 * @param {string} [state.invite] - the invite code as typed, carried across the two steps.
 * @param {boolean} [state.inviteRequired] - whether registering needs one, which is the only reason to show the field.
 * @param {string} [state.agree] - the policy version the visitor has already agreed to, carried across the two steps.
 * @param {string} [state.version] - the dsh release this deployment runs; omitted when the deployment did not declare one.
 * @returns {string} the HTML document.
 */
export function loginPage(state = {}) {
  const { error, notice, pending, invite, inviteRequired, agree, version } = state
  // Ticked again when the page is re-rendered after a refusal that was not
  // about the consent: a form that quietly unticks it makes the next submit
  // fail for a reason the person already dealt with.
  const agreed = agree !== undefined && agree !== ''

  const banner = toast(error, notice)

  // Shown in both states and never required by the browser: a returning tenant
  // has an account and needs no invite, and only the server knows which of the
  // two this is. Asking one and not the other would make the form a way to ask
  // which addresses are registered.
  const inviteField = inviteRequired !== true ? '' : `<div class="field">
        <input name="invite" data-tp="invite.hint" data-ta="invite.label" aria-label="邀请码" placeholder="邀请码（首次注册需要，老用户留空）" value="${escapeHtml(invite ?? '')}" autocomplete="off" spellcheck="false">
      </div>`

  // The address is resubmitted as a hidden field rather than held in a cookie or
  // a server-side step record: the challenge it belongs to is already keyed by
  // it, so the form carrying it back adds no trust and no state.
  // The invite sits under the address but is present from the first step, which
  // is the point: someone who submits an address, waits for mail, and only then
  // meets a requirement they could not have satisfied has already spent the
  // code they were sent.
  const fields = pending === undefined
    ? `<div class="field">
        <input name="email" type="email" data-tp="email" aria-label="邮箱" autocomplete="email" placeholder="邮箱" autofocus required>
      </div>
      ${inviteField}`
    : `<input type="hidden" name="email" value="${escapeHtml(pending)}">
      <div class="field readonly">
        <input value="${escapeHtml(pending)}" data-ta="email" aria-label="邮箱" readonly tabindex="-1">
      </div>
      <div class="field">
        <input name="code" data-tp="code.hint" data-ta="code.label" aria-label="验证码" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" autofocus required>
      </div>
      ${inviteField}`

  // The heading says which of the two steps this is, because the fields alone
  // do not: an address in a box and a code in a box are the same shape.
  const heading = pending === undefined
    ? '<h1 data-t="step.address.h">登录</h1>\n      <p class="lede" data-t="step.address.lede">输入邮箱，我们会发一封带验证码的邮件。</p>'
    : '<h1 data-t="step.code.h">输入验证码</h1>\n      <p class="lede" data-t="step.code.lede">验证码已发送，请查收邮箱。</p>'

  // Consent, and the reason it is a checkbox on every sign-in rather than a
  // sentence under the button.
  //
  // Registration is what needs agreement, and this form does not know which of
  // the two it is doing — deliberately, because an answer that differed would
  // make it a way to ask who has an account. So everyone ticks it, which is
  // also what every Chinese sign-in form does and therefore what a visitor
  // expects to find. It is `required`, so the browser refuses the submit before
  // the server has to, and the server refuses it again.
  //
  // On the second step it is a hidden field carrying what was already agreed:
  // asking twice for the same consent, once either side of a mailed code, reads
  // as a form that was not paying attention the first time.
  const consent = pending === undefined
    ? `<label class="consent">
        <input type="checkbox" name="agree" value="${POLICY_VERSION}" required${agreed ? ' checked' : ''}>
        <span data-th="consent">我已阅读并同意 ${policyLinks({ separator: '、' })}</span>
      </label>`
    : `<input type="hidden" name="agree" value="${escapeHtml(agreed ? agree : POLICY_VERSION)}">`

  // No "forgot password" in either state, because there is no password: the
  // code that signs someone in is the same code that registers them, and an
  // address that cannot receive mail cannot be recovered by this deployment.
  //
  // Nothing is said about the invite here either. The field says it, and a line
  // repeating what the field above it already asks for is one more thing to
  // read on the way to the same action.
  const alt = pending === undefined
    ? inviteRequired === true ? '' : '<div class="alt"><span data-t="alt.register">首次登录将自动注册</span></div>'
    : '<div class="alt"><a href="/login" data-t="alt.another">换个邮箱</a></div>'
  // The dsh release, not a version of the gateway: it is what a tenant would
  // quote when reporting something, and what the notice above is about.
  const release = version === undefined || version === '' ? '' : ` · v${escapeHtml(version)}`

  // Everything this page says, in both languages. The markup carries the
  // Chinese and this carries the English; `scripts/check-pages.mjs` renders the
  // page in each of its states and refuses any Chinese that has no key here.
  //
  // Built per state rather than once, because the form is two forms: only one
  // step's strings are on screen, and shipping the other's would be a table
  // carrying answers to questions this page never asks.
  const table = {
    email:  { zh: '邮箱', en: 'Email' },
    wechat: { zh: '微信扫码关注公众号', en: 'Scan to follow on WeChat' },
    footer: { zh: 'HamsterHQ · 自建部署', en: 'HamsterHQ · self-hosted' },
    docs: {
      zh: policyLinks({ separator: '', lang: 'zh' }),
      en: policyLinks({ separator: '', lang: 'en' }),
    },
    // Whatever the banner is saying, if it is saying anything.
    ...toastEntry(error, notice),
  }

  if (inviteRequired === true) {
    table['invite.label'] = { zh: '邀请码', en: 'Invite code' }
    table['invite.hint'] = {
      zh: '邀请码（首次注册需要，老用户留空）',
      en: 'Invite code (needed to register; leave empty if you have an account)',
    }
  }

  if (pending === undefined) {
    table['doc.title'] = { zh: '登录 · HamsterHQ', en: 'Sign in · HamsterHQ' }
    table['step.address.h'] = { zh: '登录', en: 'Sign in' }
    table['step.address.lede'] = {
      zh: '输入邮箱，我们会发一封带验证码的邮件。',
      en: 'Enter your email and we will send you a code.',
    }
    table['submit.send'] = { zh: '获取验证码', en: 'Send code' }
    // Rendered with the links inside it, so the sentence reads as a sentence in
    // both languages rather than as a phrase with a list bolted on the end.
    table.consent = {
      zh: `我已阅读并同意 ${policyLinks({ separator: '、', lang: 'zh' })}`,
      en: `I have read and agree to ${policyLinks({ separator: ', ', lang: 'en' })}`,
    }
    if (inviteRequired !== true) {
      table['alt.register'] = { zh: '首次登录将自动注册', en: 'Signing in for the first time registers you' }
    }
  } else {
    table['doc.title'] = { zh: '输入验证码 · HamsterHQ', en: 'Enter the code · HamsterHQ' }
    table['step.code.h'] = { zh: '输入验证码', en: 'Enter the code' }
    table['step.code.lede'] = { zh: '验证码已发送，请查收邮箱。', en: 'The code has been sent. Check your mail.' }
    table['code.label'] = { zh: '验证码', en: 'Code' }
    table['code.hint'] = { zh: '6 位验证码', en: '6-digit code' }
    table['submit.signin'] = { zh: '登录', en: 'Sign in' }
    table['alt.another'] = { zh: '换个邮箱', en: 'Use a different address' }
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HamsterHQ</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${asset('favicon.svg')}">
${FONT_PRELOAD}
<style>
${PALETTE_CSS}
${GROUND_CSS}
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    color: var(--fg);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* Clears the theme button in the corner, which is fixed and would otherwise
       sit on top of the wordmark on a short window. */
    padding: 5rem 1.25rem 2rem;
  }

  /* A link back to the front door: someone who arrived here from a button and
     wanted to keep reading has no other way out, and the wordmark is where
     everyone looks for one. */
  .brand {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin-bottom: 1.75rem;
    text-decoration: none;
    color: inherit;
  }
  /* Height, not width: the mark is a hamster standing rather than a disc,
     so it is wider than it is tall and a square box would letterbox it. */
  .brand img { height: 26px; width: auto; display: block; }
  .brand .word { font-family: var(--display); font-size: 1.5rem; font-weight: 600; letter-spacing: -.03em; color: var(--fg); }
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

  /*
    One card over the lattice, holding both columns, on the landing page's own
    recipe: --panel, a hairline, and lifted off the ground rather than drawn on
    it — the same three values its workspace still is built from.

    Opaque, and that is the point. Translucent, it took the colour of whatever
    was behind it, which is --bg — so the card and the input fields inside it
    were the same white, and the fields had nothing to sit on. The landing page
    nests them the same way round: a raised card with --bg boxes in it.
  */
  .card {
    display: flex;
    align-items: center;
    gap: clamp(20px, 4vw, 32px);
    padding: clamp(22px, 4vw, 32px);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-panel);
    background: var(--panel);
    box-shadow: var(--lift);
  }

  form { width: 336px; }

  h1 { font-family: var(--display); font-size: 1.375rem; font-weight: 600; letter-spacing: -.03em; margin: 0 0 .3rem; }
  .lede { margin: 0 0 1.5rem; color: var(--muted); font-size: .8125rem; line-height: 1.55; }

  /* A rounded rectangle rather than a pill, because that is what the landing
     page's composer is and it is the same act: typing something in. The pills
     on both pages are for the things you press. */
  .field {
    display: flex;
    align-items: center;
    height: 3rem;
    padding: 0 1rem;
    margin-bottom: .625rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-field);
    background: var(--bg);
    transition: border-color .16s, box-shadow .16s;
  }
  .field:hover { border-color: var(--line-strong); }
  .field:focus-within { border-color: var(--line-strong); box-shadow: 0 0 0 4px var(--ring); }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
    color: var(--fg);
    caret-color: var(--accent);
  }
  .field input::placeholder { color: var(--faint); }
  /* An autofilled field is painted by the browser in its own pale blue, and
     background-color does not reach it — an inset shadow is the only way to
     cover it. Without this the one blue on the page appears behind the text of
     whichever field the password manager filled. */
  .field input:-webkit-autofill,
  .field input:-webkit-autofill:hover,
  .field input:-webkit-autofill:focus {
    -webkit-text-fill-color: var(--fg);
    -webkit-box-shadow: 0 0 0 100px var(--bg) inset;
    box-shadow: 0 0 0 100px var(--bg) inset;
    caret-color: var(--fg);
  }

  /* Scoped to the form: the theme toggle in the corner is a button too, and it
     is not this one. */
  form button {
    width: 100%;
    height: 3rem;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--ink);
    color: var(--on-ink);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background .16s;
  }
  form button:hover { background: var(--ink-hover); }

  .alt {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: .75rem;
    margin-top: 1rem;
    color: var(--muted);
    font-size: .8125rem;
  }
  .alt a { color: var(--muted); text-decoration: none; border-bottom: 1px solid var(--line); padding-bottom: 1px; }
  .alt a:hover { color: var(--fg); border-color: var(--line-strong); }

  /* The deployment's WeChat account, where a house ad used to be — and where
     the hosted product puts a scan-to-sign-in code. The one thing on this page
     that is worth a phone being picked up for, so it gets the panel rather than
     a line in the footer.

     A fixed square, vertically centred against the form rather than stretched
     to it: the form is one field taller on the second step, and a panel that
     tracked its height would resize the code between one submit and the next —
     which is the one thing a code must not do while somebody is aiming a camera
     at it.

     The code keeps its white ground in both themes. A scanner reads dark
     modules on a light one, and inverting it would make the page tidier and the
     code unreadable. */
  aside {
    flex: none;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: .875rem;
    width: 240px;
    height: 240px;
    padding: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-panel);
    background: var(--bg);
  }
  aside img { display: block; padding: 5px; border-radius: 8px; background: #fff; }
  aside span { color: var(--muted); font-size: .75rem; }

${TOAST_CSS}

  /* The address, once a code is out, is shown rather than re-typed: it is what
     the code was sent to, and letting it be edited here would silently answer
     one challenge with another address. */
  .field.readonly { background: var(--surface); border-color: var(--line-soft); }
  .field.readonly:hover { border-color: var(--line-soft); }
  .field.readonly input { color: var(--muted); cursor: default; }

  /* Between the durability warning and the button, which is the last thing
     read before the one irreversible click on this page. The box is 1rem so it
     is a target rather than a decoration, and the text beside it wraps under
     itself rather than under the box. */
  .consent {
    display: flex;
    align-items: flex-start;
    gap: .5rem;
    margin: 1rem 0 1.125rem;
    color: var(--muted);
    font-size: .75rem;
    line-height: 1.6;
    cursor: pointer;
  }
  .consent input {
    flex: none;
    width: 1rem;
    height: 1rem;
    margin: .1rem 0 0;
    accent-color: var(--ink);
    cursor: pointer;
  }
  .consent a { color: var(--fg); text-decoration: none; border-bottom: 1px solid var(--line); }
  .consent a:hover { border-color: var(--line-strong); }

  footer {
    display: grid;
    justify-items: center;
    gap: .875rem;
    padding: 1.5rem 1.25rem 2.5rem;
    text-align: center;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--faint);
  }
  footer p { margin: 0; }
  .docs { display: flex; flex-wrap: wrap; justify-content: center; gap: .25rem 0; font-family: var(--sans); font-size: .75rem; }
  .docs a { color: var(--muted); text-decoration: none; }
  .docs a:hover { color: var(--fg); }

  @media (max-width: 720px) {
    .card { flex-direction: column; width: 100%; max-width: 380px; }
    form { width: 100%; }
    aside { width: 100%; height: auto; aspect-ratio: 1; }
  }
</style>
</head>
<body>
${banner}
${THEME_TOGGLE}
${langToggle(table)}
${GROUND_HTML}
<div class="glow" aria-hidden="true"></div>
<main>
  <a class="brand" href="/">
    <img src="${asset('hamster.svg')}" alt="">
    <span class="word">HamsterHQ</span>
  </a>

  <div class="card">
    <form method="post" action="/login">
      ${heading}
      ${fields}
      ${consent}
      <button type="submit" data-t="${pending === undefined ? 'submit.send' : 'submit.signin'}">${pending === undefined ? '获取验证码' : '登录'}</button>
      ${alt}
    </form>

    <aside>
      <img src="${asset('wechat-qr.webp')}" width="168" height="168" alt="">
      <span data-t="wechat">微信扫码关注公众号</span>
    </aside>
  </div>
</main>
<footer>
  <nav class="docs" data-th="docs">${policyLinks({ separator: '' })}</nav>
  <p><span data-t="footer">HamsterHQ · 自建部署</span>${release}</p>
</footer>
${GROUND_SCRIPT}
</body>
</html>
`
}
