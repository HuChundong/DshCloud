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

// ---- report ----

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s) in the landing page`)
  process.exit(1)
}

console.log(`landing page: ${Object.keys(T).length} strings in two languages, built by vite`)
