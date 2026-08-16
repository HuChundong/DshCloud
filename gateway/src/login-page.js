/**
 * The login page. Inlined rather than served from the web container because it
 * must work before any sandbox exists and must not depend on the frontend
 * bundle loading.
 *
 * It follows the product's own sign-in layout — centred wordmark over a form
 * column beside a panel — so the deployment does not hand its users a second,
 * unrelated visual identity before the app they are signing into. The accent is
 * black rather than the product blue, and the panel carries a house ad where
 * the hosted product puts a scan-to-log-in code, because neither mechanism
 * exists here.
 *
 * Where the hosted product puts terms of use, this states the durability risk
 * instead, and attributes it to DSH's own pace rather than to this deployment:
 * sandboxes are reclaimed when idle and reaped on every gateway restart, and
 * nothing is backed up. Sign-in is the last moment before someone starts work
 * they could lose, so it is the honest place to say so.
 *
 * It follows the visitor's system theme and offers a toggle over it. Dark is not
 * a darkened light: `--ink` is the accent as much as the ink — the button fill,
 * the badge, the focus ring — so it inverts, because a black button on a black
 * page is not a button.
 */

import { PALETTE_CSS, THEME_TOGGLE, TOAST_CSS, escapeHtml, toast } from './page-chrome.js'

/**
 * Render the login page.
 *
 * One page in two states, told apart by whether a code is outstanding. Both are
 * plain form posts to the same endpoint, so signing in needs no JavaScript —
 * which matters because this page is what a visitor sees when the frontend
 * bundle has not loaded and may be why it has not.
 *
 * @param {object} [state] - what to show.
 * @param {string} [state.error] - what went wrong with the previous attempt.
 * @param {string} [state.notice] - what went right with it.
 * @param {string} [state.pending] - the address a code was just sent to; switches the form to its second state.
 * @param {string} [state.invite] - the invite code as typed, carried across the two steps.
 * @param {boolean} [state.inviteRequired] - whether registering needs one, which is the only reason to show the field.
 * @param {string} [state.version] - the dsh release this deployment runs; omitted when the deployment did not declare one.
 * @returns {string} the HTML document.
 */
export function loginPage(state = {}) {
  const { error, notice, pending, invite, inviteRequired, version } = state

  const banner = toast(error, notice)

  // Shown in both states and never required by the browser: a returning tenant
  // has an account and needs no invite, and only the server knows which of the
  // two this is. Asking one and not the other would make the form a way to ask
  // which addresses are registered.
  const inviteField = inviteRequired !== true ? '' : `<div class="field">
        <input name="invite" aria-label="邀请码" placeholder="邀请码（首次注册需要，老用户留空）" value="${escapeHtml(invite ?? '')}" autocomplete="off" spellcheck="false">
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
        <input name="email" type="email" aria-label="邮箱" autocomplete="email" placeholder="邮箱" autofocus required>
      </div>
      ${inviteField}`
    : `<input type="hidden" name="email" value="${escapeHtml(pending)}">
      <div class="field readonly">
        <input value="${escapeHtml(pending)}" aria-label="邮箱" readonly tabindex="-1">
      </div>
      <div class="field">
        <input name="code" aria-label="验证码" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" autofocus required>
      </div>
      ${inviteField}`

  // No "forgot password" in either state, because there is no password: the
  // code that signs someone in is the same code that registers them, and an
  // address that cannot receive mail cannot be recovered by this deployment.
  //
  // Nothing is said about the invite here either. The field says it, and a line
  // repeating what the field above it already asks for is one more thing to
  // read on the way to the same action.
  const alt = pending === undefined
    ? inviteRequired === true ? '' : '<div class="alt"><span>首次登录将自动注册</span></div>'
    : '<div class="alt"><a href="/login">换个邮箱</a></div>'
  // The dsh release, not a version of the gateway: it is what a tenant would
  // quote when reporting something, and what the notice above is about.
  const release = version === undefined || version === '' ? '' : ` · v${escapeHtml(version)}`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepSeek Harness</title>
<link rel="icon" href="/favicon.svg">
<style>
${PALETTE_CSS}
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "PingFang SC",
          "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 1.25rem;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin-bottom: 2.75rem;
  }
  .brand img { width: 34px; height: 34px; display: block; }
  /* The mark is a single-colour black glyph served as an image, so it cannot
     inherit --ink the way the wordmark beside it does — and in dark it was
     black on black. Inverting is exact rather than approximate here: the only
     colour in the file is #000, so this is the same swap the palette makes. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .brand img { filter: invert(1); }
  }
  :root[data-theme="dark"] .brand img { filter: invert(1); }
  :root[data-theme="light"] .brand img { filter: none; }
  .brand .word { font-size: 1.75rem; font-weight: 600; letter-spacing: -.02em; color: var(--ink); }
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

  .cols { display: flex; gap: 2rem; align-items: center; }

  form { width: 336px; }

  .field {
    display: flex;
    align-items: center;
    height: 3rem;
    padding: 0 1.25rem;
    margin-bottom: 1rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg);
    transition: border-color .15s, box-shadow .15s;
  }
  .field:focus-within { border-color: var(--ink); box-shadow: 0 0 0 3px var(--ring); }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
    color: var(--fg);
  }
  .field input::placeholder { color: var(--muted); }
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
  ::selection { background: rgb(10 10 10 / 14%); color: var(--fg); }

  .legal { margin: 0 0 1.5rem; color: var(--muted); font-size: .8125rem; line-height: 1.6; }
  .legal b { color: var(--fg); font-weight: 500; border-bottom: 1px solid var(--fg); }

  button {
    width: 100%;
    height: 3rem;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font: inherit;
    font-weight: 550;
    cursor: pointer;
    transition: opacity .15s;
  }
  button:hover { opacity: .85; }

  .alt {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: .75rem;
    margin-top: 1.25rem;
    color: var(--muted);
    font-size: .8125rem;
  }
  .alt span, .alt a { color: var(--fg); border-bottom: 1px solid var(--line); padding-bottom: 1px; }
  .alt a { text-decoration: none; }
  .alt i { font-style: normal; color: var(--line); }

  /* The image is the whole panel: it already carries its own wording, so a
     caption beneath it would only repeat what the artwork says. Square,
     because the source is — any other ratio would crop its lettering.
     A white inset keeps the artwork off the card's edge — its lettering and the
     character's fins run close to the image bounds, and flush against a rounded
     corner they read as clipped. The border and shadow draw the card's edge,
     which the artwork's own white background would otherwise dissolve into. */
  /* A fixed square, vertically centred against the form rather than stretched
     to it. The form is one field taller on the second step, and a panel that
     tracked its height would change the artwork's size between one submit and
     the next.

     No inset: the artwork carries its own margin, so padding here would frame
     it twice. Hiding the overflow is what keeps the image inside the rounded
     corners once it reaches the edge. */
  aside {
    flex: none;
    width: 240px;
    height: 240px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg);
    box-shadow: 0 1px 2px var(--shadow), 0 10px 28px var(--shadow);
  }
  aside img { width: 100%; height: 100%; object-fit: cover; display: block; }

${TOAST_CSS}

  /* The address, once a code is out, is shown rather than re-typed: it is what
     the code was sent to, and letting it be edited here would silently answer
     one challenge with another address. */
  .field.readonly input { color: var(--muted); background: var(--panel); cursor: default; }

  footer { padding: 1.5rem; text-align: center; color: var(--muted); font-size: .8125rem; }

  @media (max-width: 720px) {
    .cols { flex-direction: column; align-items: center; }
    aside { width: 336px; }
  }
</style>
</head>
<body>
${banner}
${THEME_TOGGLE}
<main>
  <div class="brand">
    <img src="/login-assets/mark.svg" alt="">
    <span class="word">deepseek</span>
    <span class="badge">HARNESS</span>
  </div>

  <div class="cols">
    <form method="post" action="/login">
      ${fields}
      <p class="legal">
        DSH 正在高速迭代，服务随时可能重启或重建：会话、工作区与文件<b>随时可能丢失</b>，且不做备份。请勿存放任何重要数据。
      </p>
      <button type="submit">${pending === undefined ? '获取验证码' : '登录'}</button>
      ${alt}
    </form>

    <aside><img src="/login-assets/ad.webp" alt="广告位招租"></aside>
  </div>
</main>
<footer>DeepSeek Harness · 自建部署${release}</footer>
</body>
</html>
`
}
