/**
 * What the gateway's two pages have in common.
 *
 * Sign-in and the user console are separate pages with separate jobs, but a
 * person meets them one after the other and they have to look like one product.
 * The palette, the wordmark, the toast, and the theme toggle were written twice
 * before this existed, which is exactly as long as it took for a fix to land in
 * one of them and not the other.
 *
 * Everything here is a string. Both pages are server-rendered documents with no
 * build step — that is what lets them work when the frontend bundle has not
 * loaded and may be why it has not — so composition is concatenation.
 */

/**
 * Escape text for interpolation into HTML element content or a quoted attribute.
 * @param {string} text - untrusted text.
 * @returns {string} the escaped text.
 */
export function escapeHtml(text) {
  return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

/**
 * The faces the whole deployment is set in.
 *
 * The landing page's own three files, at the landing page's own URLs. They are
 * static bytes under `/welcome/`, served by the same nginx that proxies this
 * page from the gateway — so a visitor who came through the front door already
 * has them and pays nothing to see this one, which a second copy under
 * `/login-assets/` would have cost them twice. Where the gateway is reached
 * without that nginx — the tunnel port a CubeSandbox deployment publishes — the
 * faces do not arrive at all, and that is what `font-display: optional` is for:
 * the page is read in the system sans rather than repainted around a face that
 * turned up late.
 *
 * Latin subsets, as on the landing page. The Chinese is set by the system faces
 * named in --sans; a CJK webfont would weigh more than everything else here
 * together, for glyphs the reader already has.
 */
const FONT_CSS = `
  @font-face {
    font-family: "Host Grotesk"; font-style: normal; font-weight: 500 700;
    font-display: optional; src: url("/welcome/fonts/host-grotesk-latin.woff2") format("woff2");
  }
  @font-face {
    font-family: "DM Sans"; font-style: normal; font-weight: 400 500;
    font-display: optional; src: url("/welcome/fonts/dm-sans-latin.woff2") format("woff2");
  }
  @font-face {
    font-family: "Fragment Mono"; font-style: normal; font-weight: 400;
    font-display: optional; src: url("/welcome/fonts/fragment-mono-latin.woff2") format("woff2");
  }
`

/**
 * The preloads those faces need, for the head of a page that uses them.
 *
 * `optional` gives the browser a short window and then gives up for the visit,
 * so without these the first load of a cold cache is set in the system sans and
 * the second is not — the same page looking different on consecutive visits.
 * The landing page preloads the same three URLs, which is what makes this free
 * for anyone arriving from it.
 */
export const FONT_PRELOAD = [
  'host-grotesk-latin',
  'dm-sans-latin',
  'fragment-mono-latin',
].map((face) => `<link rel="preload" href="/welcome/fonts/${face}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')

/**
 * The dark half of the palette, stated once and emitted twice.
 *
 * --ink is the accent as well as the ink: the button fill, the badge, and the
 * focus ring. Dark therefore inverts it rather than darkening it — a black
 * button on a black page is not a button — while --fg stays the reading colour,
 * so the two swap roles rather than both getting darker.
 *
 * --accent does not invert, it brightens: it is the green a running sandbox
 * wears in the product's own sidebar, and it has to stay that green on both
 * grounds while carrying enough contrast on each.
 */
const DARK_TOKENS = `
    color-scheme: dark;
    --ink: #ffffff;
    --on-ink: #0a0a0a;
    --ink-hover: hsla(0, 0%, 100%, .86);
    --fg: #ffffff;
    --muted: hsla(0, 0%, 100%, .48);
    --faint: hsla(0, 0%, 100%, .28);
    --line: hsla(0, 0%, 100%, .10);
    --line-soft: hsla(0, 0%, 100%, .07);
    --line-strong: hsla(0, 0%, 100%, .20);
    --surface: hsla(0, 0%, 100%, .055);
    --panel: #121213;
    --sunken: #0e0e0f;
    --bg: #0a0a0a;
    --accent: #40d99b;
    --accent-rgb: 64 217 155;
    --on-accent: #05231a;
    --danger: #e07a63;
    --ring: rgb(64 217 155 / 14%);
    --shadow: rgb(0 0 0 / 40%);
    --lift: 0 30px 90px -30px rgb(0 0 0 / 80%);
    --grid-line: hsla(0, 0%, 100%, .06);
    --grid-dot: hsla(0, 0%, 100%, .13);
    --glow: hsla(157, 68%, 55%, .10);`

/**
 * The palette, in all three states a visitor can be in.
 *
 * The values are the landing page's, token for token. The front door and the
 * sign-in form are two documents with no build step between them and no way to
 * share a stylesheet — one is a file in the web image, the other a string in
 * this process — so the only thing that can keep them one product is that the
 * numbers here are the numbers there. They were not, and the seam showed the
 * moment anyone crossed it: a different white, a different black, a different
 * idea of what a border is.
 *
 * The media query is the visitor who has expressed no choice; the attribute is
 * the one who has. Neither can be folded into the other — a page that only
 * followed the system would ignore the toggle, and one that only followed the
 * toggle would ignore the system.
 */
export const PALETTE_CSS = `${FONT_CSS}
  :root {
    color-scheme: light;
    --ink: #101113;
    --on-ink: #ffffff;
    --ink-hover: rgb(16 17 19 / 84%);
    --fg: #101113;
    --muted: rgb(16 17 19 / 56%);
    --faint: rgb(16 17 19 / 40%);
    --line: rgb(16 17 19 / 13%);
    --line-soft: rgb(16 17 19 / 8.5%);
    --line-strong: rgb(16 17 19 / 30%);
    --surface: rgb(16 17 19 / 6%);
    --panel: #fbfbfa;
    --sunken: #f4f4f2;
    --bg: #ffffff;
    /* The green a running sandbox already wears in the product's sidebar, not
       the upstream blue: the layout may say "same world", the colour must not
       say "same publisher". */
    --accent: #0a7d55;
    --accent-rgb: 10 125 85;
    --on-accent: #ffffff;
    --danger: #b4341f;
    --ring: rgb(10 125 85 / 10%);
    --shadow: rgb(16 17 19 / 6%);
    --lift: 0 30px 80px -32px rgb(16 17 19 / 28%);
    --grid-line: rgb(16 17 19 / 5.5%);
    --grid-dot: rgb(16 17 19 / 10%);
    --glow: rgb(10 125 85 / 7%);

    --radius-card: 24px;
    --radius-panel: 16px;
    --radius-field: 12px;
    --radius-pill: 100px;

    --display: "Host Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
    --sans: "DM Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    --mono: "Fragment Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK SC", "PingFang SC", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {${DARK_TOKENS}
    }
  }
  :root[data-theme="dark"] {${DARK_TOKENS}
  }

  ::selection { background: var(--accent); color: var(--on-accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
`

/**
 * The toast: what a page says about something that already happened.
 *
 * Fixed, so the toast is outside the layout entirely: it appears between one
 * submit and the next, and anything that took up room would move whatever is
 * under it at the moment someone is reaching for it.
 *
 * A confirmation dismisses itself; an error does not. The first says something
 * already happened and is finished being useful a few seconds later, while the
 * second is the reason the thing a person asked for did not happen, and taking
 * it away on a timer means they have to reproduce the failure to read it again.
 * Both are CSS animations rather than a script, so they behave the same on a
 * page whose scripting is off.
 */
export const TOAST_CSS = `
  .toast {
    position: fixed;
    top: 1.25rem;
    left: 50%;
    z-index: 10;
    max-width: min(90vw, 26rem);
    padding: .65rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-field);
    /* The capsule's own recipe, from the landing page's header: translucent
       over whatever it covers, blurred so the lattice behind it stays a
       texture rather than becoming text to read through. */
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    color: var(--fg);
    font-size: .8125rem;
    box-shadow: 0 1px 2px var(--shadow), 0 10px 28px var(--shadow);
    animation: toast-in .18s ease-out both, toast-out .3s ease-in 4s both;
  }
  .toast.error {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
    color: var(--danger);
    animation: toast-in .18s ease-out both;
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translate(-50%, -.5rem); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes toast-out {
    from { opacity: 1; transform: translate(-50%, 0); visibility: visible; }
    to   { opacity: 0; transform: translate(-50%, -.5rem); visibility: hidden; }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast { animation: none; transform: translateX(-50%); }
  }

`

/**
 * Everything the gateway's pages say back to a person, in both languages.
 *
 * Here rather than at the place that decides to say it, because these are page
 * copy and the pages are translated: a handler that returned a finished
 * sentence would be a handler that had picked a language, and the language is
 * not decided until the browser applies its own choice. So handlers name a
 * message and this holds what it says.
 *
 * Only what a PAGE shows. The JSON the panel answers with is read by the
 * application shell, not by these pages, and is not translated here.
 */
export const MESSAGES = {
  'email.invalid':    { zh: '请填写一个有效的邮箱地址。', en: 'Enter a valid email address.' },
  'invite.rejected':  { zh: '邀请码无效或已被使用。', en: 'That invite code is not valid, or has already been used.' },
  'code.unsent':      { zh: '验证码发送失败，请稍后再试。', en: 'The code could not be sent. Try again shortly.' },
  'code.wrong':       { zh: '验证码不正确。', en: 'That code is not correct.' },
  'code.expired':     { zh: '验证码已失效，请重新获取。', en: 'That code has expired. Ask for another.' },
  'capacity.full':    { zh: '当前在线沙箱已达上限，请稍后再试。', en: 'Every sandbox is in use right now. Try again shortly.' },
  'account.disabled': { zh: '该账号已被停用，请联系管理员。', en: 'This account has been disabled. Contact the operator.' },
  'delete.confirm':   { zh: '请输入你的完整邮箱地址以确认注销。', en: 'Type your full email address to confirm closing the account.' },
  'avatar.large':     { zh: '头像太大了，请换一张。', en: 'That picture is too large. Choose a smaller one.' },
  'avatar.format':    { zh: '头像格式不受支持，请重新选择图片。', en: 'That image format is not supported. Choose another picture.' },
}

/**
 * One message, or nothing.
 *
 * The argument is a key from `MESSAGES`, not a sentence. Anything that is not a
 * key is shown as itself, so a message added in a hurry still reaches the
 * reader — in one language, which `scripts/check-pages.mjs` then objects to.
 *
 * @param {string} [error] - what went wrong; shown in the danger colour and not dismissed on a timer.
 * @param {string} [notice] - what went right; dismisses itself.
 * @returns {string} the markup, empty when there is nothing to say.
 */
export function toast(error, notice) {
  const said = (key) => escapeHtml(MESSAGES[key]?.zh ?? key)
  if (error !== undefined) return `<div class="toast error" role="alert" data-t="msg">${said(error)}</div>`
  if (notice !== undefined) return `<div class="toast" role="status" data-t="msg">${said(notice)}</div>`
  return ''
}

/**
 * The table entry a rendered banner needs, if there is one.
 *
 * One key, because one banner: a page shows the error or the notice, never
 * both, so the message on screen is always `msg`.
 *
 * @param {string} [error] - the key passed to `toast`.
 * @param {string} [notice] - the other key passed to `toast`.
 * @returns {Record<string, {en: string, zh: string}>} the entry, or nothing.
 */
export function toastEntry(error, notice) {
  const key = error ?? notice
  if (key === undefined) return {}
  return { msg: MESSAGES[key] ?? { zh: key, en: key } }
}

/**
 * The theme toggle: its own styles, its own scripts, and the button between
 * them.
 *
 * Self-contained because it was not, and the seam showed the moment a fourth
 * page used it. Its CSS lived in `TOAST_CSS` — a page that had a toast and a
 * toggle needed one import, and the policy pages, which have only a toggle,
 * rendered it as an unstyled button with both of its icons showing, in a strip
 * across the top of the document. A widget whose markup and appearance can be
 * imported separately will eventually be imported separately.
 *
 * A `<style>` in the body rather than in the head, which is legal and is the
 * price of that: the alternative is a second export that every page has to
 * remember, which is the arrangement that just failed.
 *
 * The choice is applied before first paint, from an inline script rather than a
 * deferred one, because anything later means a light flash on a dark page.
 * `data-theme` is set only when a choice exists, so a visitor who has made none
 * keeps following their system.
 */
export const THEME_TOGGLE = `<style>
  /* Square and quiet: on the sign-in page it is the only control that is not
     the form, and it must not read as a second submit button. */
  .theme {
    position: fixed;
    top: 1.25rem;
    right: 1.25rem;
    z-index: 10;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--line-soft);
    /* A circle, because every other free-standing control in this design is a
       pill and a square one would be the only rounded rectangle on the page. */
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    color: var(--muted);
    cursor: pointer;
    transition: color .16s, border-color .16s;
  }
  .theme:hover { color: var(--fg); border-color: var(--line-strong); }
  /* One button, two icons: which one shows is a question about the theme in
     force, which only CSS knows — the button itself never has to be told. */
  .theme .moon { display: none; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .theme .sun { display: none; }
    :root:not([data-theme="light"]) .theme .moon { display: block; }
  }
  :root[data-theme="dark"] .theme .sun { display: none; }
  :root[data-theme="dark"] .theme .moon { display: block; }
  :root[data-theme="light"] .theme .sun { display: block; }
  :root[data-theme="light"] .theme .moon { display: none; }
</style>
<script>
  (function () {
    try {
      var saved = localStorage.getItem('dsh-theme')
      if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved
    } catch (error) {
      // Storage can be denied outright — private windows, blocked third-party
      // storage — and a theme is not worth failing the page over.
    }
  })()
</script>
<button type="button" class="theme" id="theme" data-ta="theme.label" aria-label="切换深色/浅色">
  <svg class="sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  <svg class="moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
</button>
<script>
  document.getElementById('theme').addEventListener('click', function () {
    // Reads what is rendered rather than what was stored, so the first click
    // from a system-dark page goes to light rather than to dark again.
    var dark = matchMedia('(prefers-color-scheme: dark)').matches
    var current = document.documentElement.dataset.theme || (dark ? 'dark' : 'light')
    var next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('dsh-theme', next) } catch (error) { /* as above */ }
  })
</script>`

/**
 * The language control, and the machinery that applies a choice.
 *
 * One export carrying style, markup and script together, for the reason
 * `THEME_TOGGLE` gives above it: a widget whose parts can be imported
 * separately will eventually be imported separately, and half of one is worse
 * than none.
 *
 * The contract is the landing page's, deliberately — `data-t` writes
 * textContent, `data-th` writes innerHTML, `data-tp` a placeholder and its
 * aria-label, `data-ta` an aria-label alone — so there is one way to say this
 * across the deployment rather than one per surface. `dsh-lang` is the same key
 * the landing page stores under, so a visitor who chose English there does not
 * meet a Chinese form one link later.
 *
 * These pages are WRITTEN in Chinese, which is the difference from the landing
 * page: there the markup is English and a choice only rewrites it. So the table
 * is applied on load whichever language wins, and a string with no key of its
 * own simply stays as written — which is why `scripts/check-pages.mjs` renders
 * each page and refuses any Chinese it finds outside this table.
 *
 * @param {Record<string, {en: string, zh: string}>} table - every string the page shows, in both languages.
 * @returns {string} the control and its script.
 */
export function langToggle(table) {
  // `<` escaped, because this JSON is embedded in a script element and a `</`
  // inside any string would close it early — ending the script in the middle of
  // a sentence, which browsers do not treat as an error, only as the end.
  // The chrome's own strings, which belong to the controls rather than to any
  // page. Merged underneath, so a page that wants to say one of them
  // differently still can.
  const withChrome = { 'theme.label': { zh: '切换深色/浅色', en: 'Switch between light and dark' }, ...table }
  const json = JSON.stringify(withChrome).replaceAll('<', '\\u003c')
  return `<style>
  /* Beside the theme control, because they are the same kind of thing: two
     settings for how the page is read, neither of them content. Left of it, in
     reading order, so the pair does not reshuffle between pages. */
  .lang {
    position: fixed;
    top: 1.25rem;
    right: 4rem;
    z-index: 10;
    display: flex;
    padding: 3px;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .lang button {
    font: inherit; font-size: .8125rem; line-height: 1; cursor: pointer;
    padding: 6px 10px; border: 0; border-radius: var(--radius-pill);
    background: none; color: var(--muted); white-space: nowrap;
    transition: color .16s, background .16s;
  }
  .lang button:hover { color: var(--fg); }
  .lang button[aria-pressed="true"] { background: var(--line-soft); color: var(--fg); }
</style>
<div class="lang">
  <button type="button" data-lang="zh" aria-pressed="true">中文</button>
  <button type="button" data-lang="en" aria-pressed="false">EN</button>
</div>
<script>
  (function () {
    var T = ${json}
    function apply(next) {
      document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
      if (T['doc.title']) document.title = T['doc.title'][next]
      var write = function (selector, attribute, set) {
        var nodes = document.querySelectorAll(selector)
        for (var i = 0; i < nodes.length; i += 1) {
          var entry = T[nodes[i].getAttribute(attribute)]
          if (entry) set(nodes[i], entry[next])
        }
      }
      write('[data-t]',  'data-t',  function (el, text) { el.textContent = text })
      write('[data-th]', 'data-th', function (el, html) { el.innerHTML = html })
      // Attributes, not content: a placeholder and a label have to be
      // translated too, and neither is reachable through textContent.
      write('[data-tp]', 'data-tp', function (el, text) { el.placeholder = text; el.setAttribute('aria-label', text) })
      write('[data-ta]', 'data-ta', function (el, text) { el.setAttribute('aria-label', text) })
      var buttons = document.querySelectorAll('.lang button')
      for (var j = 0; j < buttons.length; j += 1) {
        buttons[j].setAttribute('aria-pressed', String(buttons[j].dataset.lang === next))
      }
      current = next
      try { localStorage.setItem('dsh-lang', next) } catch (error) { /* private mode */ }
    }
    // For the strings a page's own script produces rather than renders: a hint
    // written into an element on an event, the sentence a confirm dialog asks.
    // They cannot carry a data-t attribute because they do not exist until
    // something happens, so the page asks for them by the same key instead.
    var current = 'zh'
    window.dshText = function (key) {
      var entry = T[key]
      return entry === undefined ? key : entry[current]
    }
    var stored = null
    try { stored = localStorage.getItem('dsh-lang') } catch (error) { /* as above */ }
    // No stored choice falls back to the browser's own, which for this
    // deployment's audience is usually the one already on screen.
    apply(stored === 'zh' || stored === 'en' ? stored
      : (navigator.language || '').indexOf('zh') === 0 ? 'zh' : 'en')
    var controls = document.querySelectorAll('.lang button')
    for (var k = 0; k < controls.length; k += 1) {
      controls[k].addEventListener('click', function () { apply(this.dataset.lang) })
    }
  })()
</script>`
}

/**
 * The ground the whole deployment stands on: the landing page's lattice.
 *
 * A field of points, each held to its rest position by a spring and pushed away
 * by the cursor. This is `web/landing/index.html`'s canvas, constant for
 * constant — 90px cells, a 140px reach, a peak push of 30, a 0.05 spring and
 * 0.85 damping, capped at 30fps — because the two are the same ground and a
 * lattice on a different pitch would read as a different site. It is copied
 * rather than shared for the reason everything else here is: the landing page
 * is a file in the web image and these pages are strings in this process, with
 * no build step anywhere between them.
 *
 * Cheap enough to leave running behind a form. It sleeps as soon as the lattice
 * has settled and wakes on the next mouse move, so a sign-in page nobody is
 * touching costs nothing at all; where it cannot be driven — a touch screen, or
 * a reader who asked for stillness — it draws one static frame, because this is
 * the ground rather than an effect laid over one.
 *
 * The canvas is `.ground` and not `.field`, which is what the landing page calls
 * it: on these pages `.field` is already a row of the form.
 */
export const GROUND_HTML = '<canvas class="ground" id="ground" aria-hidden="true"></canvas>'

/**
 * What the ground needs from the page it is dropped into.
 *
 * The page colour moves to `html` and `body` goes transparent: the canvas sits
 * at `z-index: -1`, and an opaque body would paint straight over it.
 */
export const GROUND_CSS = `
  html { background: var(--bg); }
  body { background: transparent; }
  .ground {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
  }
  /* Upstream paints its hero light with a WebGL2 flowmap. This is the same
     light on a keyframe: a compositor-only transform, nothing to fall back
     from. \`translateX(-50%)\` is repeated inside the keyframes, or the animation
     drops the centring. */
  .glow {
    position: fixed;
    left: 50%;
    top: -22%;
    width: min(1100px, 130%);
    aspect-ratio: 2 / 1;
    z-index: -1;
    transform: translateX(-50%);
    pointer-events: none;
    will-change: transform;
    background: radial-gradient(closest-side, var(--glow), transparent 72%);
    animation: glow-drift 22s ease-in-out infinite;
  }
  @keyframes glow-drift {
    0%, 100% { transform: translateX(-50%) translate3d(0, 0, 0) scale(1); }
    50%      { transform: translateX(-50%) translate3d(3%, -4%, 0) scale(1.1); }
  }
  @media (prefers-reduced-motion: reduce) { .glow { animation: none; } }
`

/** The lattice itself. Goes last in the body, after the canvas it draws on. */
export const GROUND_SCRIPT = `<script>
;(() => {
  const canvas = document.getElementById('ground')
  const context = canvas && canvas.getContext('2d')
  if (!context) return

  const SPACING = 90        // cell size, CSS pixels
  const REACH = 140         // how far from the cursor a point feels anything
  const PUSH = 30           // peak force, at the cursor itself
  const SPRING = 0.05       // pull back towards rest
  const DAMPING = 0.85
  const GAP = 10            // drawn gap at each end of a segment
  const FRAME = 1000 / 30
  const ASLEEP = 0.01       // below this much motion there is nothing left to draw

  const idle = matchMedia('(hover: none), (pointer: coarse)').matches
    || matchMedia('(prefers-reduced-motion: reduce)').matches

  let ratio = 1, width = 0, height = 0, columns = 0, rows = 0
  let points = []
  let line = 'rgba(16,17,19,.055)', dot = 'rgba(16,17,19,.10)', accent = '10 125 85'
  let sleeping = false, frame = 0, previous = 0, pending = 0
  const cursor = { x: NaN, y: NaN }

  function readTokens() {
    const style = getComputedStyle(document.documentElement)
    line = style.getPropertyValue('--grid-line').trim() || line
    dot = style.getPropertyValue('--grid-dot').trim() || dot
    accent = style.getPropertyValue('--accent-rgb').trim() || accent
  }

  function build() {
    columns = Math.ceil(width / SPACING) + 1
    rows = Math.ceil(height / SPACING) + 1
    // Centred, so the lattice is not pinned to one corner as the window changes.
    const originX = (width - (columns - 1) * SPACING) / 2
    const originY = (height - (rows - 1) * SPACING) / 2
    points = []
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = originX + column * SPACING
        const y = originY + row * SPACING
        points.push({ restX: x, restY: y, x, y, vx: 0, vy: 0 })
      }
    }
  }

  function resize() {
    ratio = Math.min(devicePixelRatio || 1, 2)
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    build()
  }

  function segment(a, b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length < GAP * 2) return
    const ux = dx / length
    const uy = dy / length
    context.moveTo(a.x + GAP * ux, a.y + GAP * uy)
    context.lineTo(b.x - GAP * ux, b.y - GAP * uy)
  }

  /** @returns {number} the fastest point this frame, which is what decides sleep. */
  function draw() {
    const mx = cursor.x
    const my = cursor.y
    const chased = !Number.isNaN(mx)
    let fastest = 0

    for (const point of points) {
      if (chased) {
        const dx = point.x - mx
        const dy = point.y - my
        const distance = Math.hypot(dx, dy)
        if (distance < REACH && distance > 0.1) {
          const force = (1 - distance / REACH) * PUSH * 0.1
          point.vx += (dx / distance) * force
          point.vy += (dy / distance) * force
        }
      }
      point.vx = (point.vx + SPRING * (point.restX - point.x)) * DAMPING
      point.vy = (point.vy + SPRING * (point.restY - point.y)) * DAMPING
      point.x += point.vx
      point.y += point.vy
      const speed = Math.abs(point.vx) + Math.abs(point.vy)
      if (speed > fastest) fastest = speed
    }

    context.clearRect(0, 0, width, height)

    // Every segment in one path: a few hundred strokes a frame is the one thing
    // here that would show up in a profile, and batching makes it one.
    context.strokeStyle = line
    context.lineWidth = 0.5
    context.beginPath()
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns - 1; column++) {
        segment(points[row * columns + column], points[row * columns + column + 1])
      }
    }
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows - 1; row++) {
        segment(points[row * columns + column], points[(row + 1) * columns + column])
      }
    }
    context.stroke()

    // Squares rather than arcs, as upstream draws them: at this size the shape
    // does not read, and \`fillRect\` skips a path per point.
    context.fillStyle = dot
    for (const point of points) {
      context.fillRect(point.x - 1.8, point.y - 1.8, 3.6, 3.6)
    }

    // A second pass over only what the cursor is near, tinting those points
    // towards the accent as they grow. Overdrawing is what blends the two
    // colours — interpolating them would mean parsing both.
    if (chased) {
      for (const point of points) {
        const near = 1 - Math.hypot(point.x - mx, point.y - my) / REACH
        if (near <= 0) continue
        const half = 1.8 + 2 * near
        context.fillStyle = \`rgb(\${accent} / \${(0.45 * near).toFixed(3)})\`
        context.fillRect(point.x - half, point.y - half, half * 2, half * 2)
      }
    }

    return fastest
  }

  function tick(now) {
    if (now - previous < FRAME) { frame = requestAnimationFrame(tick); return }
    previous = now - (now - previous) % FRAME

    if (canvas.clientWidth !== width || canvas.clientHeight !== height) resize()

    if (draw() < ASLEEP) sleeping = true
    else frame = requestAnimationFrame(tick)
  }

  function wake() {
    if (!sleeping) return
    sleeping = false
    previous = 0
    frame = requestAnimationFrame(tick)
  }

  readTokens()
  resize()

  if (idle) {
    draw()
    addEventListener('resize', () => {
      clearTimeout(pending)
      pending = setTimeout(() => { resize(); draw() }, 150)
    })
  } else {
    frame = requestAnimationFrame(tick)
    addEventListener('mousemove', (event) => {
      const box = canvas.getBoundingClientRect()
      cursor.x = event.clientX - box.left
      cursor.y = event.clientY - box.top
      wake()
    }, { passive: true })
    addEventListener('resize', () => {
      clearTimeout(pending)
      pending = setTimeout(() => { resize(); wake() }, 150)
    })
  }

  // The colours are read once, so the lattice would otherwise keep drawing in
  // the old palette after the theme changed under it. Two ways it can: the
  // system, and this deployment's own toggle, which writes \`data-theme\` on the
  // root — the landing page has only the first because it has no toggle.
  function repaint() {
    readTokens()
    if (sleeping || idle) draw()
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint)
  new MutationObserver(repaint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})()
</script>`
