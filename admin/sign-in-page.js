/**
 * The one page an operator sees before they are one.
 *
 * Deliberately plain, and deliberately silent. It says nothing about what is
 * behind it, names no deployment, and tells a failed attempt nothing about
 * which half was wrong — a console with one account gives away a great deal by
 * distinguishing "no such user" from "wrong password".
 *
 * It borrows the brand and the palette from the gateway's own chrome so an
 * operator is not looking at a different product, and nothing else: no theme
 * toggle, no language toggle, no links. There is one thing to do here.
 *
 * @module admin/sign-in-page
 */

import { BRAND_CSS, FONT_PRELOAD, PALETTE_CSS, WORDMARK, escapeHtml } from '../gateway/src/page-chrome.js'

/** What a refusal says, which is as little as possible. */
const REASONS = {
  refused: '用户名或密码不正确。',
  'too-many': '尝试次数过多，请稍后再试。',
}

/**
 * The sign-in page.
 *
 * @param {{error?: string}} state - why they are seeing it again, if they are.
 * @returns {string} the page.
 */
export function signInPage(state = {}) {
  const message = state.error === undefined ? '' : REASONS[state.error] ?? REASONS.refused
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>运营控制台</title>
<meta name="robots" content="noindex, nofollow">
${FONT_PRELOAD}
<style>
${PALETTE_CSS}
${BRAND_CSS}
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: var(--ground); color: var(--fg);
    font-family: var(--sans); font-size: 15px; line-height: 1.6;
  }
  form { width: min(340px, calc(100vw - 48px)); display: grid; gap: 14px; }
  .mark { display: flex; justify-content: center; margin-bottom: 6px; }
  h1 { font-size: 15px; font-weight: 500; margin: 0; text-align: center; color: var(--muted); }
  label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
  input {
    font: inherit; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--field); color: var(--fg);
  }
  input:focus-visible { outline: 2px solid var(--fg); outline-offset: 1px; }
  button {
    font: inherit; font-weight: 500; padding: 10px; border: 0; border-radius: 8px;
    background: var(--fg); color: var(--ground); cursor: pointer;
  }
  .error { font-size: 13px; color: var(--danger, #a3302a); text-align: center; margin: 0; }
  .note { font-size: 12px; color: var(--muted); text-align: center; margin: 4px 0 0; }
</style>
</head>
<body>
<form method="post" action="/sign-in">
  <div class="mark">${WORDMARK}</div>
  <h1>运营控制台</h1>
  ${message === '' ? '' : `<p class="error">${escapeHtml(message)}</p>`}
  <label>用户名
    <input name="username" autocomplete="username" autofocus required>
  </label>
  <label>密码
    <input name="password" type="password" autocomplete="current-password" required>
  </label>
  <button type="submit">进入</button>
  <p class="note">仅限内部访问</p>
</form>
</body>
</html>`
}
