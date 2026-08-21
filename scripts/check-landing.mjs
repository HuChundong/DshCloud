/**
 * What the landing page has to hold true, checked without a browser.
 *
 * Less than there was. The page used to be one file that a script copied,
 * hashed and rewrote by string substitution, and most of what was asserted here
 * were the things that arrangement could get silently wrong: a reference the
 * substitution did not recognise, an asset staged into one of the three
 * assemblies and not the others, a mark opened from the checkout resolving to
 * nothing. `vite build` writes those references from the document it parsed, so
 * they are no longer claims to check.
 *
 * What is left is what a bundler has no opinion about:
 *
 * - The two languages cannot drift, because they sit on one line per string
 *   rather than in two files. That holds only while every key really does carry
 *   both, and while every string with markup in it goes through the attribute
 *   that renders markup — `data-t` sets textContent, so a `<code>` on that side
 *   reaches the reader as four visible characters.
 * - Links into the application are absolute and assets are not. Vite makes the
 *   asset URLs relative; nothing stops someone writing `/login` as `login`,
 *   which would be resolved against whichever root the page was served from.
 * - The deployment serves what the build produces, at the paths it produces
 *   them at, with the caching each deserves.
 *
 * Run: node scripts/check-landing.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const landing = join(root, 'web/landing')

/** The page's three source files, read once. */
const page = {
  html: readFileSync(join(landing, 'index.html'), 'utf8'),
  css: readFileSync(join(landing, 'styles.css'), 'utf8'),
  js: readFileSync(join(landing, 'main.js'), 'utf8'),
}

/** Keys the page never marks up, because JavaScript writes them at runtime. */
const RUNTIME_KEYS = new Set(['copy.idle', 'copy.done', 'doc.title'])

/**
 * Whether a document's tags open and close in order.
 *
 * @param {string} xml - the document.
 * @throws {Error} naming the first tag that does not match.
 */
function balanced(xml) {
  const stack = []
  // Comments and CDATA hold text that is not markup, so they go first.
  const text = xml.replaceAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '')
  for (const match of text.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const [, closing, name, rest] = match
    if (rest.trimEnd().endsWith('/')) continue
    if (closing === '') { stack.push(name); continue }
    const open = stack.pop()
    if (open !== name) throw new Error(`</${name}> closes <${open ?? 'nothing'}>`)
  }
  if (stack.length > 0) throw new Error(`<${stack[stack.length - 1]}> is never closed`)
}

const problems = []

/**
 * The `T` table, read from the page's script rather than duplicated here.
 * @returns {Record<string, {en: string, zh: string}>} the table.
 */
function table() {
  const start = page.js.indexOf('const T = {')
  if (start === -1) throw new Error('the T table is gone from web/landing/main.js')
  // The table's closing brace is the first `}` at the start of a line after it,
  // which holds because everything nested inside it is indented.
  const end = page.js.indexOf('\n}\n', start)
  if (end === -1) throw new Error('the T table has no closing brace at column 0')
  const literal = page.js.slice(start + 'const T = '.length, end + 2)
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
for (const match of page.html.matchAll(/data-(t|th|tp|ta)="([^"]+)"/g)) {
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

/**
 * Everything the page names, from the markup and from the stylesheet both.
 * @returns {Array<{from: string, target: string}>} each reference and its file.
 */
function references() {
  const found = []
  for (const match of page.html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
    found.push({ from: 'index.html', target: match[1] })
  }
  for (const match of page.css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    found.push({ from: 'styles.css', target: match[1] })
  }
  return found
}

for (const { from, target } of references()) {
  if (/^(https?:|mailto:|data:|#)/.test(target)) continue

  if (target.startsWith('/')) {
    // Absolute, which is right for the application and wrong for an asset:
    // these are the paths the container answers and Pages does not, so the
    // page may only use them for links a visitor follows out of the page.
    if (!/^\/(login|logout|profile|admin|policy)(\/|$)/.test(target)) {
      problems.push(`${from}: ${target} is absolute, but not one of the application's own paths`)
    }
    continue
  }

  if (target === './') continue
  // Relative to the file that names it, which is how the bundler resolves it
  // too. Both source files sit in web/landing, so a `../../gateway/assets/…`
  // reaches the one copy of a mark rather than a second one staged beside the
  // page.
  if (!existsSync(resolve(join(landing, dirname(from === 'index.html' ? 'index.html' : 'styles.css')), target))) {
    problems.push(`${from}: ${target} resolves to nothing`)
  }
}

// The document has to name the stylesheet and the script, or the build has an
// entry point that pulls in neither and produces a page with no styling and no
// second language — which renders, and looks like a CSS bug.
if (!page.html.includes('href="./styles.css"')) {
  problems.push('index.html: does not name ./styles.css, so the build would emit an unstyled page')
}
if (!page.html.includes('src="./main.js"')) {
  problems.push('index.html: does not name ./main.js, so the build would emit a page stuck in one language')
}
if (!page.html.includes('type="module"')) {
  problems.push('index.html: the script is not a module, so Vite treats it as an opaque asset and does not bundle it')
}

// ---- the marks are the gateway's, and there is one of each ----

// Two marks, and which is which is the point. This deployment's own hamster
// signs the page — the header and both places inside the product still — and
// upstream's whale appears exactly once, in the footer, on the link that names
// DeepSeek Harness. A whale anywhere else is this project wearing someone
// else's trademark, which is what their brand guidelines ask projects not to
// do; a count is the cheapest way to keep that true.
for (const [file, expected] of [
  ['../../gateway/assets/hamster.svg', 3],
  ['../../gateway/assets/mark.svg', 2],
  ['../../gateway/assets/favicon.svg', 1],
  ['../../gateway/assets/wechat-qr.webp', 1],
]) {
  const found = page.html.split(`"${file}"`).length - 1
  if (found !== expected) problems.push(`${file}: expected ${expected} reference(s), found ${found}`)
}

// A copy of a gateway-owned file staged into the page's own directory would
// render identically and then drift, which is the failure this naming exists to
// prevent.
for (const name of ['mark.svg', 'hamster.svg', 'favicon.svg', 'wechat-qr.webp']) {
  if (existsSync(join(landing, name))) {
    problems.push(`web/landing/${name}: a second copy of a gateway-owned file. The page names it at its real path; delete this one.`)
  }
}

// ---- the mark reads on both grounds, everywhere it is shown ----

// It is one ink-black line drawing with transparent negative space, embedded as
// an `<img>` in three places. Two things follow, and both have been got wrong:
//
// - the SVG may carry no `prefers-color-scheme` rule of its own. An
//   `<img>`-embedded SVG resolves that against the SYSTEM, so a page switched
//   to dark by hand on a light system got a black mark on a black ground — and
//   a page whose own rule then inverted it got a black mark again.
// - every page that shows it must invert it when dark. A missing rule is not a
//   broken layout or an error in a console; it is a mark that is simply not
//   there, on the one screen its author was not looking at.
// Parsed, before anything is asked about what it says. An SVG is XML, so a
// stray `<` — in a comment, in a style element, anywhere — opens a tag and the
// file stops being a document. A browser renders nothing at all for it and
// reports it as an image that failed to load, which reads as a missing file
// rather than as a broken one.
for (const name of ['hamster.svg', 'favicon.svg', 'mark.svg']) {
  const file = join(root, 'gateway/assets', name)
  if (!existsSync(file)) { problems.push(`gateway/assets/${name}: missing`); continue }
  try {
    // No XML parser in the standard library, and none is needed: what breaks
    // these files is an unbalanced or unexpected tag, and a parser that only
    // matches opens against closes catches exactly that.
    balanced(readFileSync(file, 'utf8'))
  } catch (error) {
    problems.push(`gateway/assets/${name}: is not well-formed XML — ${error.message}`)
  }
}

const mark = readFileSync(join(root, 'gateway/assets/hamster.svg'), 'utf8')
if (/@media[^{]*prefers-color-scheme/.test(mark)) {
  problems.push('gateway/assets/hamster.svg: carries its own prefers-color-scheme rule, which resolves against the system rather than the page it is embedded in')
}

for (const [file, rule, what] of [
  ['web/landing/styles.css', 'img[src*="hamster"] { filter: invert(1); }', 'the landing page'],
  ['gateway/src/page-chrome.js', 'img[src*="hamster"] { filter: invert(1); }', "the gateway's own pages"],
  ['packages/dsh-brand/client.js', 'body[data-ds-dark-theme] img', 'the application shell'],
]) {
  if (!readFileSync(join(root, file), 'utf8').includes(rule)) {
    problems.push(`${file}: nothing inverts the mark for dark, so it is invisible in ${what}`)
  }
}

// ---- the faces the design is set in are actually in the tree ----

// A missing woff2 does not fail the build and does not error in a browser:
// `font-display` simply keeps the fallback, and the page renders in the system
// sans looking almost right. Almost right is the hard kind of wrong to notice,
// so the files are asserted here.
for (const face of ['dm-sans-latin', 'host-grotesk-latin', 'fragment-mono-latin']) {
  const file = join(landing, 'fonts', `${face}.woff2`)
  if (!existsSync(file)) {
    problems.push(`web/landing/fonts/${face}.woff2: declared by an @font-face and not in the tree`)
  } else if (!page.css.includes(`fonts/${face}.woff2`)) {
    problems.push(`web/landing/fonts/${face}.woff2: in the tree and named by no @font-face`)
  } else if (!page.html.includes(`fonts/${face}.woff2`)) {
    // Preloaded as well as declared. `font-display: optional` gives a face one
    // brief chance to arrive before the page commits to the fallback for good,
    // and a face discovered only when the stylesheet is parsed does not get it.
    problems.push(`web/landing/fonts/${face}.woff2: declared but not preloaded, so it will lose its race on a cold load`)
  }
}

// ---- the page reads in both themes, in all three states ----

// A visitor has three states, not two: an explicit choice stamps `data-theme`
// on the root, and the default stamps nothing, where only `prefers-color-scheme`
// separates light from dark. The dark palette therefore has to be written twice,
// and CSS gives no way to share one body of declarations between a media query
// and an attribute selector. So they are compared instead — a token added to one
// and not the other is a page that is one colour under the toggle and another
// under the system setting, which is the kind of wrong that only shows up on
// somebody else's machine.
const dark = [...page.css.matchAll(/(?:@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)|:root\[data-theme="dark"\]) \{([^}]*)\}/g)]
  .map((match) => match[1].replaceAll(/\s+/g, ' ').trim())
if (dark.length !== 2) {
  problems.push(`web/landing/styles.css: expected two dark palette blocks, found ${String(dark.length)}`)
} else if (dark[0] !== dark[1]) {
  problems.push('web/landing/styles.css: the two dark palette blocks have drifted apart; they must declare the same tokens')
}

// The theme is applied before the stylesheet, or a page someone asked to read
// dark paints white first and then corrects itself.
const beforeStyles = page.html.indexOf('dsh-theme') < page.html.indexOf('href="./styles.css"')
if (!page.html.includes('dsh-theme')) {
  problems.push('index.html: no pre-paint theme script, so a dark page flashes white on every load')
} else if (!beforeStyles) {
  problems.push('index.html: the theme script runs after the stylesheet, which is the flash it exists to prevent')
}
// Same key as the gateway's pages, so the choice carries from here to sign-in.
if (!page.js.includes("localStorage.setItem('dsh-theme'")) {
  problems.push('main.js: the theme toggle does not store the choice, so it lasts until the next navigation')
}
if (!page.html.includes('class="theme"')) {
  problems.push('index.html: there is no theme control')
}

// ---- the build and the deployment agree on where the assets go ----

const vite = readFileSync(join(landing, 'vite.config.js'), 'utf8')
const nginx = readFileSync(join(root, 'web/site.inc'), 'utf8')

// Not `assets/`, which the shell already owns: the web image serves the
// application's bundles from there, and a landing asset of the same name would
// be answered with a JavaScript bundle.
if (!vite.includes("assetsDir: 'landing'")) {
  problems.push("web/landing/vite.config.js: assetsDir is not 'landing', which is the prefix web/site.inc serves")
}
if (!nginx.includes('location ^~ /landing/ {')) {
  problems.push('web/site.inc: nothing serves /landing/, so every hashed asset the build emits 404s')
}
// Relative, because the same document is served from the site root on GitHub
// Pages and from `/` in the web image.
if (!vite.includes("base: './'")) {
  problems.push("web/landing/vite.config.js: base is not './', so the URLs are only right under one of the page's two roots")
}

// ---- the deployment actually serves what the page assumes ----

// The address the front door used to have. A saved link should still arrive.
if (!nginx.includes('location /welcome/   { return 301 /; }')) {
  problems.push('web/site.inc: /welcome/ no longer leads anywhere, so a saved link 404s')
}
// The front door is served AT the root rather than redirected to, and the
// application has an address of its own. Either half missing turns one into
// the other's page.
if (!nginx.includes('error_page 401 = @front_door;')) {
  problems.push('web/site.inc: / does not serve the landing page to a visitor without a session')
}
if (!nginx.includes('return 303 /app;')) {
  problems.push('web/site.inc: / does not send a signed-in visitor to the application')
}
if (!nginx.includes('location = /app {')) {
  problems.push('web/site.inc: the application has no address of its own')
}

// The build's output has to reach nginx, and nginx has to be served the build
// rather than the tree.
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
for (const line of [
  'COPY web/landing/package.json web/landing/package-lock.json ./',
  'RUN npm ci --no-audit --no-fund',
  'COPY gateway/assets /src/gateway/assets',
  'RUN npm run build',
  'COPY --from=landing /src/web/landing/dist /usr/share/nginx/front-door',
]) {
  if (!dockerfile.includes(line)) problems.push(`Dockerfile: missing \`${line}\``)
}

// Hashed names are cached for a year, so the one rule that must hold is that
// the document is not. Serving index.html as immutable would strand every
// visitor on whichever copy they happened to fetch.
if (!nginx.includes('add_header Cache-Control "no-cache"')) {
  problems.push('web/site.inc: the landing document is not served no-cache')
}
if (!nginx.includes('immutable')) {
  problems.push('web/site.inc: hashed assets are not served immutable, which is the point of hashing them')
}

// ---- the lockfile is in the tree ----

// `npm ci` is what both the image and the published page build with, and it
// fails outright without one. Better here, where the message says why, than in
// a build log.
if (!existsSync(join(landing, 'package-lock.json'))) {
  problems.push('web/landing/package-lock.json: absent, and `npm ci` cannot run without it')
}

// ---- every raster image is webp ----

// A hard rule rather than a preference: these are photographs and screenshots
// on the page a stranger loads first, and jpg or png costs several times what
// the same picture costs as webp — the README's own set went from 2.2 MB to
// 300 KB. Checked rather than remembered, because the next person to add a
// screenshot will export whatever their tool offered.
for (const directory of ['web/landing', 'docs/assets']) {
  const at = join(root, directory)
  if (!existsSync(at)) continue
  const walk = (from) => readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
    // Neither is the page's source: one is the build's output and the other is
    // what it was built from.
    if (entry.name === 'node_modules' || entry.name === 'dist') return []
    const here = join(from, entry.name)
    return entry.isDirectory() ? walk(here) : [here]
  })
  for (const file of walk(at)) {
    if (/\.(jpe?g|png|bmp|tiff?)$/i.test(file)) {
      problems.push(`${file.slice(root.length + 1)}: raster images must be webp`)
    }
  }
}

// ---- the tier cards agree with the row count they are laid out on ----

// Subgrid aligns the four tiers row by row, and `grid-row: span N` is how many
// rows each card claims. That number is written in the stylesheet and the cards
// themselves are the other half of it: add a line to one card and it claims a
// row the others never fill, so every card after it slides up by one and the
// row that was being aligned is aligned against the wrong thing. It goes wrong
// quietly — four cards still stand in four columns, and only their insides
// stop agreeing — so the two halves are compared here rather than by eye.
//
// The `Recommended` flag is left out on purpose: it is positioned absolutely
// and takes no row, which is what lets one card carry it without shifting.

const span = page.css.match(/\.plans \.plan \{[^}]*grid-row: span (\d+)/)
if (span === null) {
  problems.push('web/landing/styles.css: the tier cards no longer say how many rows they span')
} else {
  const rows = Number(span[1])
  const cards = [...page.html.matchAll(/<div class="card plan[^"]*">([\s\S]*?)\n {6}<\/div>/g)]
  if (cards.length === 0) problems.push('web/landing/index.html: no tier cards found to count')
  for (const [index, card] of cards.entries()) {
    const children = [...card[1].matchAll(/^ {8}<(\w+)([^>]*)>/gm)]
      .filter(([, , attributes]) => !attributes.includes('class="pick"'))
    if (children.length !== rows) {
      problems.push(`web/landing/index.html: tier card ${index + 1} has ${children.length} rows of content, but the cards are laid out on ${rows}`)
    }
  }
}

// ---- report ----

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s) in the landing page`)
  process.exit(1)
}

console.log(`landing page: ${Object.keys(T).length} strings in two languages, built by vite`)
