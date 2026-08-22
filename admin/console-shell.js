/**
 * The frame every console page is drawn in.
 *
 * A left rail of sections and a content area, rather than the one long column
 * this used to be. The column was fine while there were three cards and would
 * not have survived the fourth: everything the deployment can be asked about
 * was on one page, in one scroll, with no address of its own — so an operator
 * could not link to the tier they were looking at, a refresh took them back to
 * the top, and adding a module meant making the page longer.
 *
 * Each section is a real route. That is the whole design decision: the browser
 * keeps the position, the back button works, and a section is a file rather
 * than another block appended to a template.
 *
 * ## Adding one
 *
 * Write `sections/<name>.js` exporting `label`, `icon`, `strings` and
 * `render`, then name it in `sections/index.js`. Nothing here changes.
 *
 * @module console-shell
 */

import { cssUrl } from 'dsh-icons'

import {
  BRAND_CSS,
  CONSOLE_NOTICES,
  FONT_PRELOAD,
  PALETTE_CSS,
  TOAST_CSS,
  THEME_TOGGLE,
  WORDMARK,
  escapeHtml,
  langToggle,
  toast,
  toastEntry,
} from '../gateway/src/page-chrome.js'
import { asset } from '../gateway/src/page-assets.js'

/**
 * One moment, rendered.
 *
 * @param {number} at - epoch milliseconds.
 * @returns {string} the rendered time.
 */
export function when(at) {
  // The deployment's clock, not the reader's: rendered on the server, where
  // `TZ` says which one that is. Node carries its own zone data, so the
  // variable is enough — the image needs no `tzdata` for this to be right.
  const date = new Date(at)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** What the frame itself says, in both languages the console speaks. */
const SHELL = {
  back: { zh: '退出', en: 'Sign out' },
  'rail.toggle': { zh: '收起 / 展开侧栏（⌘B）', en: 'Toggle the sidebar (⌘B)' },
  'confirm.title': { zh: '确认', en: 'Are you sure?' },
  'confirm.go': { zh: '确认删除', en: 'Delete' },
  cancel: { zh: '取消', en: 'Cancel' },
}

/**
 * Draw one console page.
 *
 * @param {object} state - what to show.
 * @param {import('./sections/index.js').Section} state.section - the section being shown.
 * @param {import('./sections/index.js').Section[]} state.sections - every section, for the rail.
 * @param {string} state.body - the section's markup.
 * @param {Record<string, {zh: string, en: string}>} [state.table] - anything the section words at render time.
 * @param {string} state.viewer - who is signed in.
 * @param {string | {code: string, params?: object}} [state.notice] - the outcome of the action that led here.
 * @param {string} [state.version] - the release this deployment runs.
 * @returns {string} the HTML document.
 */
export function consolePage(state) {
  const { section, sections, body, table: sectionTable = {}, viewer, notice, version } = state

  // A toast rather than a block in the page. It reports an action that has
  // already happened, so it dismisses itself — and being out of the layout, it
  // does not push a table down and move the row an operator was aiming at.
  const banner = toast(undefined, notice)

  const table = {
    ...CONSOLE_NOTICES,
    ...SHELL,
    ...Object.fromEntries(sections.map((entry) => [`nav.${entry.id}`, entry.label])),
    // Only this section's. Every rail label is on every page; only one lede is.
    [`lede.${section.id}`]: section.lede,
    ...section.strings,
    ...sectionTable,
    'doc.title': {
      zh: `${section.label.zh} · HamsterHQ`,
      en: `${section.label.en} · HamsterHQ`,
    },
    ...toastEntry(undefined, notice),
  }

  // One rule per section rather than an inline style: `cssUrl` produces a
  // `url("…")` whose quotes cannot survive an HTML attribute, and a mask lets
  // the glyph take the colour of the text beside it instead of being drawn
  // twice for the two states.
  const icons = sections
    .map((entry) => `  .rail a[data-icon="${entry.id}"] i { mask-image: ${cssUrl(entry.icon, '#000', 16)}; -webkit-mask-image: ${cssUrl(entry.icon, '#000', 16)}; }`)
    .join('\n')

  const rail = sections.map((entry) => `      <a href="${entry.path}" data-icon="${entry.id}"${entry.id === section.id ? ' aria-current="page"' : ''}>
        <i aria-hidden="true"></i><span data-t="nav.${entry.id}">${escapeHtml(entry.label.zh)}</span>
      </a>`).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(section.label.zh)} · HamsterHQ</title>
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${asset('favicon.svg')}">
${FONT_PRELOAD}
<script>
  // Before first paint, and in the head for that reason: read after the body
  // exists, the rail would draw open and snap shut on every navigation.
  try {
    if (localStorage.getItem('hq-rail') === 'folded') document.documentElement.dataset.rail = 'folded'
  } catch (error) { /* private mode: the rail simply does not remember */ }
</script>
<style>
${PALETTE_CSS}
${BRAND_CSS}
${TOAST_CSS}
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  /* Two panes, and the page itself does not scroll. The rail was sticky before,
     which meant the document grew with the table and the whole thing moved: a
     long list of tenants pushed the operator's own name and the sign-out below
     the fold, and the browser scrollbar measured the table rather than the
     page. Each pane owns its overflow now. */
  body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    display: flex;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- the rail ---------------------------------------------------------- */

  .rail {
    flex: none;
    width: 232px;
    height: 100%;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
    background: var(--surface);
    transition: width .16s;
  }
  .rail .brand { display: flex; align-items: center; gap: .5rem; padding: 1.15rem 1rem 1rem; }
  .rail .brand img { height: 20px; width: auto; display: block; flex: none; }
  /* Smaller than the wordmark's own size. At 1.5rem the lockup measured 238px
     inside a 232px rail and the badge was clipped off the end — the wordmark is
     sized for a page it is the largest thing on, and here it is a label. */
  .rail .brand .word { font-size: 1.125rem; }
  /* Outlined, not filled: the wordmark already ends in a solid chip, and a
     second one beside it reads as a stutter rather than as an annotation. */
  .rail .badge {
    align-self: center;
    margin-left: .125rem;
    padding: .1rem .35rem;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    color: var(--muted);
    font-size: .5625rem;
    font-weight: 600;
    letter-spacing: .08em;
  }

  .rail nav { display: flex; flex-direction: column; gap: 2px; padding: .25rem .5rem; overflow-y: auto; }
  .rail nav a {
    display: flex;
    align-items: center;
    gap: .6rem;
    padding: .45rem .6rem;
    border-radius: 8px;
    color: var(--muted);
    text-decoration: none;
    font-size: .875rem;
    white-space: nowrap;
  }
  .rail nav a:hover { background: var(--bg); color: var(--fg); }
  /* The current section, said with the attribute a screen reader already reads
     for it rather than with a class that only shows. */
  .rail nav a[aria-current="page"] { background: var(--bg); color: var(--fg); font-weight: 500; box-shadow: inset 0 0 0 1px var(--line); }
  .rail nav i {
    flex: none;
    width: 16px;
    height: 16px;
    background: currentColor;
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: 16px 16px;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: 16px 16px;
  }
${icons}

  /* The trigger, above the page's own heading. Every dashboard people already
     use puts it here rather than on the rail, and the reason is mechanical: a
     control on the rail has to survive the rail closing. */
  .fold {
    margin: 0 0 .75rem;
    padding: .35rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--muted);
  }
  .fold:hover { background: var(--surface); color: var(--fg); border-color: transparent; }
  .fold i {
    width: 17px;
    height: 17px;
    background: currentColor;
    mask: ${cssUrl('panel', '#000', 17)} center/17px no-repeat;
    -webkit-mask: ${cssUrl('panel', '#000', 17)} center/17px no-repeat;
  }

  /* Folded: the glyphs stay, everything that needs width goes. Written against
     the root rather than the rail so the state is set before first paint, which
     is what stops the rail unfolding for a frame on every navigation. */
  :root[data-rail="folded"] .rail { width: 60px; }
  :root[data-rail="folded"] .rail .brand { justify-content: center; padding-left: 0; padding-right: 0; }
  :root[data-rail="folded"] .rail .brand .word,
  :root[data-rail="folded"] .rail .brand .badge,
  :root[data-rail="folded"] .rail nav a span,
  :root[data-rail="folded"] .rail .who .name { display: none; }
  :root[data-rail="folded"] .rail nav a { justify-content: center; padding-left: 0; padding-right: 0; }
  /* Folded, the name goes and the two controls stack. The way out stays: a
     rail with no sign-out is a session left open on whatever machine opened
     it, and 60px is wide enough for one glyph above another. */
  :root[data-rail="folded"] .rail .who {
    flex-direction: column;
    gap: .4rem;
    justify-content: center;
    padding: .6rem 0;
  }
  :root[data-rail="folded"] .rail .who .out { margin-left: 0; }

  /* One row: who is signed in, what is running, and the way out. A block of
     stacked lines read as three unrelated facts stacked in a corner. */
  .rail .who {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: .55rem;
    padding: .75rem;
    margin: auto .5rem .5rem;
    border-radius: 10px;
    border: 1px solid transparent;
  }
  .rail .who:hover { border-color: var(--line); background: var(--bg); }
  .rail .who .face {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 8px;
    background: var(--ink);
    color: var(--on-ink);
    font-size: .75rem;
    font-weight: 600;
  }
  .rail .who .name { min-width: 0; display: grid; line-height: 1.35; }
  .rail .who strong {
    font-weight: 500;
    font-size: .8125rem;
    color: var(--fg);
    /* One line, cut rather than wrapped: a long name is not worth a rail that
       is two lines taller than it was. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rail .who .build { font-family: var(--mono); font-size: .6875rem; color: var(--faint); }
  .rail .who .out {
    flex: none;
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 8px;
    color: var(--muted);
  }
  .rail .who .out:hover { background: var(--surface); color: var(--fg); }
  .rail .who .out i {
    width: 15px;
    height: 15px;
    background: currentColor;
    mask: ${cssUrl('signout', '#000', 15)} center/15px no-repeat;
    -webkit-mask: ${cssUrl('signout', '#000', 15)} center/15px no-repeat;
  }

  /* ---- the page --------------------------------------------------------- */

  main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 2.25rem clamp(1.25rem, 4vw, 2.5rem) 3rem;
    /* Clears the two controls fixed in the corner. */
    padding-right: max(clamp(1.25rem, 4vw, 2.5rem), 7.5rem);
  }
  /* A section holding a list does not scroll: the rows do, inside their card,
     with the pager underneath them where it can be reached without scrolling
     past the thing it pages.
     
     A page of twenty rows is about 1200px of table. It was rendered into an
     800px pane and the pager sat 700px below the fold — a paged list that had
     to be scrolled to find out it was paged. */
  main:has(.card.list) { overflow: hidden; padding-bottom: 1.5rem; }
  main:has(.card.list) .page { display: flex; flex-direction: column; min-height: 0; height: 100%; }

  .card { flex: none; overflow-x: auto; }
  .card.list {
    display: flex;
    flex-direction: column;
    min-height: 9rem;
    flex: 1 1 auto;
    padding-bottom: 0;
    overflow: hidden;
  }
  /* The rows, and only the rows. A zero min-height is what lets a flex child
     shrink below its content — without it the card grows to fit the table and
     the page scrolls after all. */
  .card.list .rows { flex: 1 1 auto; min-height: 0; overflow: auto; }
  /* The header stays while its rows move under it. Opaque, or the rows show
     through it as they pass. */
  .card.list .rows thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg);
  }
  .page { max-width: 60rem; }
  h1 { margin: 0 0 .35rem; font-size: 1.25rem; font-weight: 600; letter-spacing: -.01em; }
  .lede { margin: 0 0 1.75rem; color: var(--muted); font-size: .875rem; }

  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th {
    text-align: left;
    padding: 0 .75rem .6rem;
    color: var(--muted);
    font-weight: 500;
    font-size: .8125rem;
    border-bottom: 1px solid var(--line);
  }
  td { padding: .65rem .75rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
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
  /* Mixed from the tokens rather than written out, so both survive the theme. */
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
  /* The way out of something, beside the way through it. */
  button.quiet { border-color: transparent; color: var(--muted); }
  button.quiet:hover { border-color: var(--line); color: var(--fg); }

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
  .card .note { margin: 0 0 1rem; color: var(--muted); font-size: .8125rem; line-height: 1.6; }

  /* The pager, under the rows it moves through. Always present, even on the
     only page — the count is the useful half, and a control that appears once
     a list gets long moves the rows under the pointer the first time it does. */
  .pager {
    flex: none;
    border-top: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: .75rem .75rem 1rem;
    font-size: .8125rem;
    color: var(--muted);
  }
  .pager .range { font-variant-numeric: tabular-nums; }
  .pager .steps { display: flex; gap: .375rem; }
  .pager .step {
    padding: .3rem .65rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--fg);
    text-decoration: none;
  }
  .pager a.step:hover { border-color: var(--muted); }
  /* The end of the list, said by a control that stays where it is rather than
     disappearing: a pager whose buttons come and go changes width, and the
     other button moves out from under the pointer on the last page. */
  .pager .step.off { color: var(--faint); border-color: var(--line-soft); cursor: default; }

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
  .creds .check { display: flex; align-items: center; gap: .45rem; flex: 0 0 100%; white-space: nowrap; font-size: .8125rem; color: var(--fg); }
  /* The checkbox ONLY: the rule above gives every input a 14rem basis, and the
     ceiling's number field is nested in a .check label too. */
  .creds .check input[type="checkbox"] { flex: none; width: 1rem; height: 1rem; accent-color: var(--ink); margin: 0; }
  .creds input[type="number"] { flex: 0 0 6rem; }

  /* The tier picker, sized and coloured as the buttons beside it so the row
     reads as one strip of controls. Setting appearance to none is what stops
     platform painting its own grey box over the theme on the dark page. */
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
    /* Drawn rather than fetched: this page reaches no other host. Its ink is
       stated because a data: URI is a document of its own and currentColor
       inside one resolves against nothing. */
    background-image: ${cssUrl('chevron-down', '#808184', 16)};
    background-repeat: no-repeat;
    background-position: right .45rem center;
    background-size: 14px 14px;
  }
  .plan select:hover { border-color: var(--muted); }
  /* Hidden by the page's script, which submits on change instead. It is here
     for the visit with no scripting, where it is the only way to send this. */
  .plan button[hidden] { display: none; }

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

  /* The enrolment square. A white ground in both themes, and that is not an
     oversight: a scanner reads dark modules on a light one. */
  .qr { display: inline-block; padding: 10px; margin: 0 0 1rem; border-radius: 10px; background: #fff; line-height: 0; }
  .qr svg { display: block; width: 168px; height: 168px; }
  .secret { margin: 0 0 .25rem; color: var(--muted); font-size: .8125rem; }
  .secret-value { margin: 0 0 1rem; font-family: var(--mono); font-size: .875rem; letter-spacing: .08em; word-break: break-all; user-select: all; }

  /* Recovery codes, shown once. Two columns so ten are one glance. */
  .codes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .375rem 1rem;
    margin: 0 0 1rem;
    padding: 1rem;
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-field);
    background: var(--surface);
    list-style: none;
    counter-reset: code;
    font-family: var(--mono);
    font-size: .875rem;
    font-variant-numeric: tabular-nums;
    user-select: all;
  }
  .codes li::before { counter-increment: code; content: counter(code) '. '; color: var(--faint); }

  /* A native dialog rather than a hand-rolled overlay: the browser owns the
     focus trap, the escape key, inertness of the page behind, and the top
     layer, and does all four better than this page would. */
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

  @media (max-width: 900px) {
    /* The rail becomes a strip. Sticky to the top rather than the side, and
       scrolling sideways rather than wrapping: a wrapped nav changes height
       between sections and moves the page under the reader. */
    body { flex-direction: column; }
    .rail { width: 100%; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
    .rail .brand { padding-bottom: .5rem; }
    .rail nav { flex-direction: row; overflow-x: auto; padding: 0 .75rem .6rem; }
    .rail .who { display: none; }
    /* Nothing to fold when the rail is already a strip, and a folded width
       would take the strip down to 60px of horizontal scroll. */
    :root[data-rail="folded"] .rail { width: 100%; }
    :root[data-rail="folded"] .rail .brand .word,
    :root[data-rail="folded"] .rail .brand .badge,
    :root[data-rail="folded"] .rail nav a span { display: revert; }
    :root[data-rail="folded"] .rail nav a { justify-content: flex-start; padding-left: .6rem; padding-right: .6rem; }
    main { padding-top: 1.5rem; overflow-y: visible; }
    body { height: auto; overflow: auto; }
  }
  @media (max-width: 640px) {
    .hide-narrow { display: none; }
  }
</style>
</head>
<body>
${banner}
${THEME_TOGGLE}
${langToggle(table)}

<aside class="rail">
  <div class="brand">
    <img src="${asset('hamster.svg')}" alt="">
    ${WORDMARK}
    <span class="badge">OPS</span>
  </div>
  <nav>
${rail}
  </nav>
  <div class="who">
    <!-- The initial, not a photograph: there is one operator and no profile to
         carry a picture. It is here because a row with a mark at its head reads
         as somebody, and a line of text reads as a setting. -->
    <span class="face" aria-hidden="true">${escapeHtml(viewer.slice(0, 1).toUpperCase())}</span>
    <span class="name">
      <strong>${escapeHtml(viewer)}</strong>
      <!-- The release, and only the release. "HamsterHQ · 自建部署" said the
           name of the product to the one person who cannot be in any doubt
           about which product this is. -->
      <span class="build">${escapeHtml(version === undefined || version === '' ? '—' : `v${version}`)}</span>
    </span>
    <a href="/sign-out" class="out" data-ta="back" aria-label="退出"><i aria-hidden="true"></i></a>
  </div>
</aside>

<main>
  <div class="page">
    <!-- The trigger sits with the page it opens onto, not on the rail it
         closes: it has to be reachable when the rail is shut, and every
         dashboard people already use puts it here. -->
    <button type="button" class="fold" data-ta="rail.toggle" aria-label="收起 / 展开侧栏"><i aria-hidden="true"></i></button>
    <h1 data-t="nav.${section.id}">${escapeHtml(section.label.zh)}</h1>
    <p class="lede" data-t="lede.${section.id}">${escapeHtml(section.lede.zh)}</p>
${body}
  </div>
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
  // Progressive: a form carrying data-confirm asks first when scripting is on,
  // and submits directly when it is off. The confirmation is a guard against a
  // misplaced click, not an authorisation step — the server decides that — so
  // losing it without JavaScript costs nothing that matters.
  (function () {
    // The fold, remembered. A preference about how this console is read, like
    // the theme and the language beside it — and kept in the same place, so a
    // browser that forgets one forgets all three.
    function toggleRail() {
      var folded = document.documentElement.dataset.rail === 'folded'
      if (folded) delete document.documentElement.dataset.rail
      else document.documentElement.dataset.rail = 'folded'
      try { localStorage.setItem('hq-rail', folded ? 'open' : 'folded') } catch (error) { /* as above */ }
    }

    // Delegated, because the trigger lives inside the part of the page every
    // action replaces — bound to the button, it would stop working after the
    // first suspend.
    document.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('.fold')) toggleRail()
    })

    // The shortcut every dashboard with a rail uses. Ignored while something is
    // being typed into, or it would swallow a ⌘B somebody meant for a field.
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'b' && event.key !== 'B') return
      if (!event.metaKey && !event.ctrlKey) return
      var into = event.target.tagName
      if (into === 'INPUT' || into === 'TEXTAREA' || into === 'SELECT') return
      event.preventDefault()
      toggleRail()
    })

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
    // only the former fires the submit event, and form.submit() would navigate
    // straight past the handler above and put the outcome in the address bar,
    // which is the thing that handler exists to prevent.
    document.addEventListener('change', function (event) {
      var select = event.target
      if (!select.matches || !select.matches('.plan select')) return
      select.form.requestSubmit()
    })

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
    // sends the same request without leaving the page, then reloads the section
    // into the same URL it was already on.
    function run(form) {
      fetch(form.action, {
        method: 'POST',
        headers: { 'X-Console-Action': 'fetch' },
        body: new URLSearchParams(new FormData(form)),
      }).then(function (response) {
        // A session that expired mid-visit answers with the sign-in page rather
        // than an outcome. Submitting normally is what gets the person there.
        if (!response.ok) { form.submit(); return }
        return response.json().then(function (body) { return refresh(body.notice) })
      }).catch(function () { form.submit() })
    }

    // The section re-read from the server rather than patched here, so what is
    // on screen is what it would serve — one description of the page, not two.
    //
    // The current path, not the root: every section is its own route now, and
    // re-reading the root would answer an action taken under /invites with the
    // tenants page.
    function refresh(notice) {
      return fetch(location.pathname, { headers: { Accept: 'text/html' } })
        .then(function (response) { return response.text() })
        .then(function (html) {
          var fresh = new DOMParser().parseFromString(html, 'text/html')
          var page = fresh.querySelector('main .page')
          if (page) {
            document.querySelector('main .page').replaceWith(page)
            // The replacement arrived as the server writes it: Chinese, with
            // every picker's button visible. Neither is what this visit is in.
            window.dshApply()
            hidePlanButtons(page)
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
      node.textContent = typeof notice === 'string'
        ? window.dshText(notice)
        : window.dshText(notice.code, notice.params)
      document.body.appendChild(node)
      setTimeout(function () { node.remove() }, 4000)
    }
  })()
</script>
</body>
</html>
`
}
