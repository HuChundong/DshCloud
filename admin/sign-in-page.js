/**
 * The one page an operator sees before they are one.
 *
 * It wears the product's own sign-in clothes — the same ground, the same card
 * over it, the same fields and the same pill button as the page a tenant signs
 * in on. It was deliberately plain once, on the reasoning that an internal page
 * needs no design; what that actually produced was a second, unrelated-looking
 * product in front of the one thing that can change every account.
 *
 * What it does not borrow is the tenant page's content: no WeChat panel, no
 * policy links, no way to register. The wordmark is not a link either — behind
 * it is the console, which would only bounce a caller who is not signed in
 * back to here.
 *
 * Still deliberately silent. It names no deployment, says nothing about what is
 * behind it, and tells a failed attempt nothing about which half was wrong — a
 * console with one account gives away a great deal by distinguishing "no such
 * user" from "wrong password".
 *
 * @module admin/sign-in-page
 */

import {
  BRAND_CSS,
  FONT_PRELOAD,
  GROUND_CSS,
  GROUND_HTML,
  GROUND_SCRIPT,
  PALETTE_CSS,
  THEME_TOGGLE,
  WORDMARK,
  escapeHtml,
  langToggle,
} from '../gateway/src/page-chrome.js'
import { asset } from '../gateway/src/page-assets.js'

/**
 * What a refusal says, which is as little as possible.
 *
 * One sentence for a wrong username and a wrong password alike, and one for
 * having asked too often. Neither says which field, and neither says whether
 * the second factor was the part that failed.
 */
const REASONS = {
  refused: { zh: '用户名或密码不正确。', en: 'That username or password is not correct.' },
  'too-many': { zh: '尝试次数过多，请稍后再试。', en: 'Too many attempts. Try again shortly.' },
}

/** Everything on the page, in both languages the console speaks. */
const TABLE = {
  'doc.title': { zh: '运营控制台', en: 'Operator console' },
  badge: { zh: '运营', en: 'OPS' },
  title: { zh: '运营控制台', en: 'Operator console' },
  lede: {
    zh: '这里管理账户、套餐与部署设置。仅限内部访问。',
    en: 'Accounts, tiers and deployment settings. Internal access only.',
  },
  username: { zh: '用户名', en: 'Username' },
  password: { zh: '密码', en: 'Password' },
  code: { zh: '动态验证码', en: 'Authenticator code' },
  submit: { zh: '进入', en: 'Sign in' },
  footer: { zh: 'HamsterHQ · 运营控制台', en: 'HamsterHQ · Operator console' },
  ...REASONS,
}

/**
 * The sign-in page.
 *
 * @param {{error?: string, totp?: boolean}} state - why they are seeing it again, and whether a second factor is asked for.
 * @returns {string} the page.
 */
export function signInPage(state = {}) {
  const reason = state.error === undefined ? undefined : REASONS[state.error] === undefined ? 'refused' : state.error
  const message = reason === undefined
    ? ''
    : `<p class="error" role="alert" data-t="${reason}">${escapeHtml(REASONS[reason].zh)}</p>`

  // Only when a secret is configured. Asked for as a field like the others
  // rather than as a second step, because both factors are checked together —
  // a page that asked for the code afterwards would be saying the password was
  // right before it had decided to let anyone in.
  const second = state.totp !== true
    ? ''
    : `<div class="field">
        <input name="code" inputmode="numeric" autocomplete="one-time-code"
               pattern="[0-9]{6}" maxlength="6" required
               placeholder="动态验证码" data-tp="code">
      </div>`

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>运营控制台</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${asset('favicon.svg')}">
${FONT_PRELOAD}
<style>
${PALETTE_CSS}
${BRAND_CSS}
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
    /* Clears the two controls fixed in the corner, which would otherwise sit
       on top of the wordmark on a short window. */
    padding: 5rem 1.25rem 2rem;
  }

  /* Not a link, unlike the tenant page's: what it would point at is the
     console, and a caller who is on this page is by definition not admitted to
     it. A wordmark that bounces you back to where you already are is worse
     than one that does nothing. */
  .brand {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin-bottom: 1.75rem;
  }
  /* Height, not width: the mark is a hamster standing rather than a disc, so it
     is wider than it is tall and a square box would letterbox it. */
  .brand img { height: 26px; width: auto; display: block; }
  /* The one mark that says this is not the tenants' door. Filled rather than
     outlined, so it reads as part of the lockup; --ink inverts with the theme
     alongside everything else. */
  .badge {
    align-self: center;
    padding: .15rem .4rem;
    border-radius: 4px;
    background: var(--ink);
    color: var(--on-ink);
    font-size: .625rem;
    font-weight: 700;
    letter-spacing: .08em;
  }

  /* The landing page's panel recipe, which the tenant sign-in card is also
     built from: --panel, a hairline, and lifted off the ground rather than
     drawn on it. Opaque, so the --bg fields inside have something to sit on. */
  .card {
    width: min(380px, 100%);
    padding: clamp(22px, 4vw, 32px);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-panel);
    background: var(--panel);
    box-shadow: var(--lift);
  }

  h1 { font-family: var(--display); font-size: 1.375rem; font-weight: 600; letter-spacing: -.03em; margin: 0 0 .3rem; }
  .lede { margin: 0 0 1.5rem; color: var(--muted); font-size: .8125rem; line-height: 1.55; }

  /* A rounded rectangle rather than a pill, the same as the tenant form: that
     is what you type into. The pill is for the thing you press. */
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
     cover it. A password manager fills both fields on this page, so without
     this most of the form is blue. */
  .field input:-webkit-autofill,
  .field input:-webkit-autofill:hover,
  .field input:-webkit-autofill:focus {
    -webkit-text-fill-color: var(--fg);
    -webkit-box-shadow: 0 0 0 100px var(--bg) inset;
    box-shadow: 0 0 0 100px var(--bg) inset;
    caret-color: var(--fg);
  }

  /* Scoped to the form: the theme and language controls in the corner are
     buttons too, and they are not this one. */
  form button {
    width: 100%;
    height: 3rem;
    margin-top: .375rem;
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

  /* Above the fields rather than below the button: it is the reason the page
     is being shown again, and it should be read before anything is retyped. */
  .error {
    margin: 0 0 1rem;
    padding: .625rem .875rem;
    border-radius: var(--radius-field);
    /* Mixed from the one danger colour rather than written out, so it
       follows the theme instead of staying a light-mode wash on a dark
       page. */
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger, #a3302a);
    font-size: .8125rem;
    line-height: 1.5;
  }

  footer {
    display: grid;
    justify-items: center;
    padding: 1.5rem 1.25rem 2.5rem;
    text-align: center;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--faint);
  }
  footer p { margin: 0; }
</style>
</head>
<body>
${THEME_TOGGLE}
${langToggle(TABLE)}
${GROUND_HTML}
<div class="glow" aria-hidden="true"></div>
<main>
  <div class="brand">
    <img src="${asset('hamster.svg')}" alt="">
    ${WORDMARK}
    <span class="badge" data-t="badge">运营</span>
  </div>

  <div class="card">
    <form method="post" action="/sign-in">
      <h1 data-t="title">运营控制台</h1>
      <p class="lede" data-t="lede">这里管理账户、套餐与部署设置。仅限内部访问。</p>
      ${message}
      <div class="field">
        <input name="username" autocomplete="username" autofocus required
               placeholder="用户名" data-tp="username">
      </div>
      <div class="field">
        <input name="password" type="password" autocomplete="current-password" required
               placeholder="密码" data-tp="password">
      </div>
      ${second}
      <button type="submit" data-t="submit">进入</button>
    </form>
  </div>
</main>
<footer>
  <p data-t="footer">HamsterHQ · 运营控制台</p>
</footer>
${GROUND_SCRIPT}
</body>
</html>
`
}
