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
 * The dark half of the palette, stated once and emitted twice.
 *
 * --ink is the accent as well as the ink: the button fill, the badge, and the
 * focus ring. Dark therefore inverts it rather than darkening it — a black
 * button on a black page is not a button — while --fg stays the reading colour,
 * so the two swap roles rather than both getting darker.
 */
const DARK_TOKENS = `
    color-scheme: dark;
    --ink: #f5f5f4;
    --on-ink: #0a0a0a;
    --fg: #e8e8e6;
    --muted: #8b8b86;
    --line: #2c2c2a;
    --panel: #161615;
    --bg: #0d0d0c;
    --danger: #e07a63;
    --ring: rgb(245 245 244 / 12%);
    --shadow: rgb(0 0 0 / 40%);`

/**
 * The palette, in all three states a visitor can be in.
 *
 * The media query is the visitor who has expressed no choice; the attribute is
 * the one who has. Neither can be folded into the other — a page that only
 * followed the system would ignore the toggle, and one that only followed the
 * toggle would ignore the system.
 */
export const PALETTE_CSS = `
  :root {
    color-scheme: light;
    --ink: #0a0a0a;
    --on-ink: #ffffff;
    --fg: #171717;
    --muted: #8a8a85;
    --line: #e4e4e1;
    --panel: #f7f7f6;
    --bg: #ffffff;
    --danger: #b4341f;
    --ring: rgb(10 10 10 / 8%);
    --shadow: rgb(0 0 0 / 6%);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {${DARK_TOKENS}
    }
  }
  :root[data-theme="dark"] {${DARK_TOKENS}
  }

  /* The mark is a single-colour black glyph served as an image, so it cannot
     inherit --ink the way the wordmark beside it does — and in dark it was
     black on black. Inverting is exact rather than approximate here: the only
     colour in the file is #000, so this is the same swap the palette makes. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .brand img { filter: invert(1); }
  }
  :root[data-theme="dark"] .brand img { filter: invert(1); }
  :root[data-theme="light"] .brand img { filter: none; }
`

/**
 * The toast, and the button that switches themes.
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
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
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

  /* Square and quiet: on the sign-in page it is the only control that is not
     the form, and it must not read as a second submit button. */
  .theme {
    position: fixed;
    top: 1.25rem;
    right: 1.25rem;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    color: var(--muted);
    cursor: pointer;
  }
  .theme:hover { color: var(--fg); border-color: var(--muted); }
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
`

/**
 * One message, or nothing.
 * @param {string} [error] - what went wrong; shown in the danger colour and not dismissed on a timer.
 * @param {string} [notice] - what went right; dismisses itself.
 * @returns {string} the markup, empty when there is nothing to say.
 */
export function toast(error, notice) {
  if (error !== undefined) return `<div class="toast error" role="alert">${escapeHtml(error)}</div>`
  if (notice !== undefined) return `<div class="toast" role="status">${escapeHtml(notice)}</div>`
  return ''
}

/**
 * The theme toggle, with the script that applies a stored choice.
 *
 * The choice is applied before first paint, from an inline script rather than a
 * deferred one, because anything later means a light flash on a dark page.
 * `data-theme` is set only when a choice exists, so a visitor who has made none
 * keeps following their system.
 */
export const THEME_TOGGLE = `<script>
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
<button type="button" class="theme" id="theme" aria-label="切换深色/浅色">
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
