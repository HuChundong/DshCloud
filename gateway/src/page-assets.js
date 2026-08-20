/**
 * The files the gateway's own pages are drawn with, under names that change
 * with their bytes.
 *
 * These used to be served at fixed names for an hour — `/login-assets/
 * hamster.svg`, `max-age=3600` — while the landing page's copy of the very
 * same mark went out content-hashed and immutable. So replacing the mark
 * reached the front door immediately and the sign-in page whenever the hour
 * happened to be up, which is the arrangement hashing exists to end. It also
 * meant the same file was cached under two policies at once, and which one a
 * visitor got depended on which page they had opened first.
 *
 * Hashed here rather than by a bundler because these pages are rendered by
 * this process, not built: the markup is a template literal and the URL is
 * interpolated into it, so the name only has to be known at boot. It is
 * computed once, when the file is read.
 *
 * The rule this establishes, and `scripts/check-assets.mjs` enforces: a name
 * that carries a hash may be cached forever, and a name that does not must be
 * revalidated. Nothing is cached for an hour under a name that can change.
 *
 * @module page-assets
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** What each page asset is, by the name it is written under in `assets/`. */
const SOURCES = {
  // This deployment's own mark, which is what these pages are signed with.
  'hamster.svg': 'image/svg+xml',
  // The same animal, squared, for the tab.
  'favicon.svg': 'image/svg+xml',
  // Upstream's whale, kept for the one thing it is still right for: naming DSH
  // where these pages refer to DSH. Nothing here wears it as its own.
  'mark.svg': 'image/svg+xml',
  // The deployment's WeChat account, in the sign-in page's panel. An image
  // rather than a link because a QR code is how someone follows an account
  // from a laptop, which is where they are when they read this page.
  'wechat-qr.webp': 'image/webp',
}

/** Where these are served from. One prefix, so nginx can route on it. */
const PREFIX = '/login-assets/'

/** @type {Map<string, {type: string, body: Buffer}>} hashed name to what to send. */
const served = new Map()

/** @type {Record<string, string>} plain name to the URL that carries its hash. */
const urls = {}

for (const [name, type] of Object.entries(SOURCES)) {
  const body = readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)))
  // Ten hex characters, as the landing build uses: far past collision for a
  // handful of files, and short enough to read in a network panel.
  const digest = createHash('sha256').update(body).digest('hex').slice(0, 10)
  const dot = name.lastIndexOf('.')
  const hashed = `${name.slice(0, dot)}.${digest}${name.slice(dot)}`
  served.set(hashed, { type, body })
  urls[name] = `${PREFIX}${hashed}`
}

/**
 * The URL for one page asset, carrying its content hash.
 *
 * @param {string} name - the plain file name, as it is written in `assets/`.
 * @returns {string} the URL to put in the markup.
 * @throws {Error} when nothing is served under that name, which is a typo in a
 *   template and would otherwise be a broken image nobody notices.
 */
export function asset(name) {
  const url = urls[name]
  if (url === undefined) throw new Error(`page-assets: nothing is served as ${name}`)
  return url
}

/**
 * What to send for one request under the asset prefix.
 *
 * @param {string} path - the request path.
 * @returns {{type: string, body: Buffer}|undefined} the file, or nothing.
 */
export function assetFor(path) {
  if (!path.startsWith(PREFIX)) return undefined
  return served.get(path.slice(PREFIX.length))
}

/** The prefix these are served under. */
export { PREFIX as ASSET_PREFIX }
