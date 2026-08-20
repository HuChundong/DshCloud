/**
 * What the landing page has to hold true, checked without a browser.
 *
 * The page claims two things about itself, and both are the kind of claim that
 * quietly stops being true:
 *
 * - It is served from two roots — the site root on GitHub Pages, and
 *   `/welcome/` inside the web image — so every asset reference has to be
 *   relative and every application link absolute. One `/assets/…` is enough to
 *   make the container serve the shell's bundles instead of a screenshot, and
 *   the page still renders, just without the picture.
 * - Its two languages cannot drift, because they sit on one line per string
 *   rather than in two files. That holds only while every key really does carry
 *   both, and while every string with markup in it goes through the attribute
 *   that renders markup — `data-t` sets textContent, so a `<code>` on that side
 *   reaches the reader as four visible characters.
 *
 * Run: node scripts/check-landing.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const page = join(root, 'web/landing/index.html')
const source = readFileSync(page, 'utf8')

/**
 * Where a relative reference is resolved from, mirroring how the page is
 * assembled: its own directory, `docs/assets` mounted at `assets/`, and the
 * gateway's mark dropped in beside the document.
 */
const ROOTS = [join(root, 'web/landing'), join(root, 'docs'), join(root, 'gateway/assets')]

/** Keys the page never marks up, because JavaScript writes them at runtime. */
const RUNTIME_KEYS = new Set(['copy.idle', 'copy.done', 'doc.title'])

const problems = []

/**
 * The `T` table, read from the page rather than duplicated here.
 * @returns {Record<string, {en: string, zh: string}>} the table.
 */
function table() {
  const start = source.indexOf('const T = {')
  if (start === -1) throw new Error('the T table is gone from web/landing/index.html')
  // The table's closing brace is the first `}` at the start of a line after it,
  // which holds because everything nested inside it is indented.
  const end = source.indexOf('\n}\n', start)
  if (end === -1) throw new Error('the T table has no closing brace at column 0')
  const literal = source.slice(start + 'const T = '.length, end + 2)
  return new Function(`return ${literal}`)()
}

const T = table()

// ---- every key carries both languages, and neither is empty ----

for (const [key, entry] of Object.entries(T)) {
  for (const lang of ['en', 'zh']) {
    if (typeof entry[lang] !== 'string' || entry[lang].trim() === '') {
      problems.push(`${key}: missing or empty ${lang}`)
    }
  }
}

// ---- every key the markup names exists, and every key exists to be named ----

// `data-t` is textContent, `data-th` is innerHTML, `data-tp` is a placeholder
// and `data-ta` an aria-label. Only the second may carry markup.
const used = new Map()
for (const match of source.matchAll(/data-(t|th|tp|ta)="([^"]+)"/g)) {
  used.set(match[2], match[1] === 'th' ? 'html' : 'text')
}

for (const [key, kind] of used) {
  if (!(key in T)) {
    problems.push(`${key}: named by a data-${kind === 'html' ? 'th' : 't*'} attribute but absent from T`)
    continue
  }
  // A string that carries a tag has to be written through innerHTML. The check
  // is on both languages, because a translation is where a `<code>` usually
  // appears on one side only.
  if (kind === 'text') {
    for (const lang of ['en', 'zh']) {
      if (/<[a-z]/i.test(T[key][lang])) {
        problems.push(`${key}: ${lang} contains markup but the element uses data-t, which would show the tags`)
      }
    }
  }
}

for (const key of Object.keys(T)) {
  if (!used.has(key) && !RUNTIME_KEYS.has(key)) {
    problems.push(`${key}: in T but nothing names it`)
  }
}

// ---- references resolve, and point at the right kind of thing ----

for (const match of source.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
  const target = match[1]
  if (/^(https?:|mailto:|data:|#)/.test(target)) continue

  if (target.startsWith('/')) {
    // Absolute, which is right for the application and wrong for an asset:
    // these are the paths the container answers and Pages does not, so the
    // page may only use them for links a visitor follows out of the page.
    if (!/^\/(login|logout|profile|admin|policy)(\/|$)/.test(target)) {
      problems.push(`${target}: absolute, but not one of the application's own paths`)
    }
    continue
  }

  if (target === './') continue
  if (!ROOTS.some((base) => existsSync(join(base, target)))) {
    problems.push(`${target}: relative, and resolves to nothing under web/landing or docs`)
  }
}

// The deployed page gets its marks during assembly, but people also open the
// source file directly while designing it. Each visible mark and the favicon
// must fall back to the gateway-owned source without creating a second copy.
//
// Two marks, and which is which is the point. This deployment's own hamster
// signs the page — the header and both places inside the product still — and
// upstream's whale appears exactly once, in the footer, on the link that names
// DeepSeek Harness. A whale anywhere else is this project wearing someone
// else's trademark, which is what their brand guidelines ask projects not to
// do; a count is the cheapest way to keep that true.
for (const [file, images, icon] of [
  ['../../gateway/assets/hamster.svg', 3, false],
  ['../../gateway/assets/favicon.svg', 0, true],
  ['../../gateway/assets/mark.svg', 2, false],
]) {
  const imageFallback = `onerror="this.onerror=null;this.src='${file}'"`
  const found = source.split(imageFallback).length - 1
  if (found !== images) problems.push(`${file}: expected ${images} checkout image fallback(s), found ${found}`)
  if (icon && !source.includes(`onerror="this.onerror=null;this.href='${file}'"`)) {
    problems.push(`${file}: the favicon has no checkout fallback`)
  }
  if (!existsSync(resolve(join(root, 'web/landing'), file))) {
    problems.push(`${file}: checkout fallback resolves to nothing`)
  }
}

// ---- the faces the design is set in are actually in the tree ----

// A missing woff2 does not fail anything at build time and does not error in a
// browser: `font-display: swap` simply keeps the fallback, and the page renders
// in the system sans looking almost right. Almost right is the hard kind of
// wrong to notice, so the files are asserted here.
for (const face of ['dm-sans-latin', 'host-grotesk-latin', 'fragment-mono-latin']) {
  const file = join(root, 'web/landing/fonts', `${face}.woff2`)
  if (!existsSync(file)) problems.push(`web/landing/fonts/${face}.woff2: declared by an @font-face and not in the tree`)
  else if (!source.includes(`fonts/${face}.woff2`)) problems.push(`web/landing/fonts/${face}.woff2: in the tree and named by nothing`)
}

// ---- the assets the page shows are the README's, not a second copy ----

if (existsSync(join(root, 'web/landing/assets'))) {
  problems.push(
    'web/landing/assets exists: the images are copied in from docs/assets at build time so that ' +
    'the README and the page cannot show different screenshots. Delete it.',
  )
}

// ---- the deployment actually serves what the page assumes ----

const nginx = readFileSync(join(root, 'web/site.inc'), 'utf8')
if (!nginx.includes('location = /welcome/')) {
  problems.push('web/site.inc: no exact-match location for /welcome/, so the page is not served')
}
if (!nginx.includes('return 303 /welcome/;')) {
  problems.push('web/site.inc: nothing redirects to /welcome/ with its trailing slash, which the relative asset paths need')
}

const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
for (const line of [
  'COPY web/landing /usr/share/nginx/landing',
  'COPY docs/assets /usr/share/nginx/landing/assets',
  'COPY gateway/assets/mark.svg /usr/share/nginx/landing/mark.svg',
  'COPY gateway/assets/hamster.svg /usr/share/nginx/landing/hamster.svg',
  'COPY gateway/assets/favicon.svg /usr/share/nginx/landing/favicon.svg',
  'COPY gateway/assets/wechat-qr.webp /usr/share/nginx/landing/wechat-qr.webp',
]) {
  if (!dockerfile.includes(line)) problems.push(`Dockerfile: missing \`${line}\``)
}

// ---- report ----

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s) in the landing page`)
  process.exit(1)
}

const shown = readdirSync(join(root, 'docs/assets')).length
console.log(`landing page: ${Object.keys(T).length} strings in two languages, ${shown} assets available`)
