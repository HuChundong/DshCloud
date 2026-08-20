/**
 * Give every landing-page asset a name that changes when its bytes do.
 *
 * The page was served with fixed filenames and a one-hour cache, which is the
 * arrangement where replacing a picture does nothing: the browser holds the old
 * one for an hour, and after that only revalidates. A person who replaces five
 * screenshots and reloads sees the five they replaced — and no way to tell
 * whether the deployment took them.
 *
 * So each asset is copied out under `name.<hash>.ext` and every reference to it
 * is rewritten. Names that change with content can be cached forever, which is
 * the point: the document stays `no-cache` and is small, and everything it
 * names is immutable and never asked about again. A replaced picture is a new
 * URL, so it arrives on the first load rather than the next hour.
 *
 * The document itself is not hashed. It is the entry point — something has to
 * have a stable name, and this is the one thing small enough to revalidate.
 *
 * Usage: node hash-landing.mjs <source-dir> <output-dir>
 */

import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const [source, output] = process.argv.slice(2)
if (source === undefined || output === undefined) {
  process.stderr.write('hash-landing: needs <source-dir> <output-dir>\n')
  process.exit(2)
}

/** Extensions worth hashing: everything the document names but is not. */
const HASHED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.woff2', '.woff', '.ico', '.avif'])

/** Documents that name assets, and are therefore rewritten rather than renamed. */
const REWRITTEN = new Set(['.html'])

/**
 * Every file under a directory, as paths relative to it.
 * @param {string} root - the directory to walk.
 * @param {string} [prefix] - the relative path accumulated so far.
 * @returns {string[]} relative paths.
 */
function walk(root, prefix = '') {
  const found = []
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) found.push(...walk(root, relative))
    else if (entry.isFile()) found.push(relative)
  }
  return found
}

mkdirSync(output, { recursive: true })
cpSync(source, output, { recursive: true })

const files = walk(output)

// Rename first, remembering what each became, so the rewrite below can be a
// plain substitution over every document.
/** @type {Map<string, string>} */
const renamed = new Map()
for (const relative of files) {
  const extension = path.extname(relative).toLowerCase()
  if (!HASHED.has(extension)) continue
  const absolute = path.join(output, relative)
  const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex').slice(0, 10)
  const directory = path.dirname(relative)
  const stem = path.basename(relative, path.extname(relative))
  const next = path.join(directory === '.' ? '' : directory, `${stem}.${digest}${path.extname(relative)}`)
  renameSync(absolute, path.join(output, next))
  // Stored with forward slashes: these are URLs in the document, whatever the
  // build host calls its separator.
  renamed.set(relative.split(path.sep).join('/'), next.split(path.sep).join('/'))
}

// Longest first, so `images/a.jpg` is never partially matched by `a.jpg`.
const ordered = [...renamed.entries()].sort((a, b) => b[0].length - a[0].length)

let rewritten = 0
for (const relative of files) {
  if (!REWRITTEN.has(path.extname(relative).toLowerCase())) continue
  const absolute = path.join(output, relative)
  let text = readFileSync(absolute, 'utf8')
  const before = text
  for (const [from, to] of ordered) {
    // Only inside a quoted attribute or a url(), so a filename mentioned in
    // prose stays prose.
    text = text.replaceAll(`"${from}"`, `"${to}"`)
    text = text.replaceAll(`'${from}'`, `'${to}'`)
    text = text.replaceAll(`("${from}")`, `("${to}")`)
    text = text.replaceAll(`(${from})`, `(${to})`)
    text = text.replaceAll(`"/welcome/${from}"`, `"/welcome/${to}"`)
  }
  if (text !== before) {
    writeFileSync(absolute, text)
    rewritten += 1
  }
}

// A reference that still names an un-hashed asset means the substitution missed
// a spelling, and the page would 404 on it. Loud, because the alternative is a
// broken image nobody notices until it is deployed.
const missed = []
for (const relative of files) {
  if (!REWRITTEN.has(path.extname(relative).toLowerCase())) continue
  const text = readFileSync(path.join(output, relative), 'utf8')
  for (const from of renamed.keys()) {
    for (const quote of ['"', "'", '(']) {
      if (text.includes(`${quote}${from}`)) missed.push(`${relative}: ${from}`)
    }
  }
}
if (missed.length > 0) {
  process.stderr.write(`hash-landing: these references were not rewritten:\n  ${missed.join('\n  ')}\n`)
  process.exit(1)
}

process.stdout.write(`hash-landing: ${String(renamed.size)} asset(s) hashed, ${String(rewritten)} document(s) rewritten\n`)
for (const [from, to] of ordered.slice(0, 4)) process.stdout.write(`hash-landing:   ${from} -> ${to}\n`)
if (ordered.length > 4) process.stdout.write(`hash-landing:   … and ${String(ordered.length - 4)} more\n`)
