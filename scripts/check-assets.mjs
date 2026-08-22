/**
 * One rule about caching, in both directions.
 *
 * A name that carries its content's hash may be cached forever, because a
 * different file is a different URL. A name that does not must be revalidated,
 * because the same URL will one day hold different bytes. Everything else is a
 * bug with a delay on it: cache a fixed name for an hour and replacing the file
 * reaches some visitors now, some in an hour, and some not until they clear
 * something — and it will look correct to whoever deployed it, because their
 * own browser fetched it fresh.
 *
 * That is exactly what happened here. The mark went out content-hashed and
 * immutable from the landing page's build, and at a fixed name with an hour's
 * caching from the gateway and from nginx — the same file, cached two ways,
 * and which one a visitor got depended on which page they opened first.
 *
 * So this reads the places that set the policy and holds the rule from both
 * ends. It is deliberately not clever: what it can check is that nothing claims
 * to be immutable without a hash in the name it is served under, and that
 * nothing served under a name this deployment writes by hand is cached for a
 * period instead of revalidated.
 *
 * Run: node scripts/check-assets.mjs
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const problems = []

const nginx = readFileSync(join(root, 'web/site.inc'), 'utf8')
const gateway = readFileSync(join(root, 'gateway/src/server.js'), 'utf8')
const assets = readFileSync(join(root, 'gateway/src/page-assets.js'), 'utf8')

// ---- nothing is cached for a period ----

// `expires` and a bare `max-age` are the shape of the bug: they say "this will
// be right again eventually", which is not a thing a correct cache policy says.
// A URL is either immutable or revalidated.
for (const [file, text] of [['web/site.inc', nginx], ['gateway/src/server.js', gateway]]) {
  for (const match of text.matchAll(/^\s*(expires\s+(?!max|epoch|-1)\S+;)/gm)) {
    problems.push(`${file}: \`${match[1]}\` caches for a period; use immutable for hashed names and no-cache for fixed ones`)
  }
  for (const line of text.split('\n')) {
    const match = /max-age=(\d+)(?![^'"]*immutable)/.exec(line)
    if (match === null || match[1] === '0') continue
    // A DOCUMENT may be cached for a period on purpose — it is the thing whose
    // address is stable by design, and how long it may go stale is a judgement
    // about the content. This rule is about the files a document names.
    if (line.includes('text/html')) continue
    problems.push(`${file}: max-age=${match[1]} without immutable; a fixed name should revalidate instead`)
  }
}

// ---- what the gateway serves immutable is hashed ----

// The gateway hashes its page assets at boot. If it stopped, it would still
// answer — with a fixed name and a year's caching, which is the worst of both.
if (!assets.includes("createHash('sha256')")) {
  problems.push('gateway/src/page-assets.js: does not hash, so the URLs it hands out are fixed names')
}
if (!gateway.includes('immutable')) {
  problems.push('gateway/src/server.js: does not serve its hashed assets immutable, which is the point of hashing them')
}

// ---- and no page writes an asset path by hand ----

// A hand-written `/login-assets/hamster.svg` still resolves — to a 404 now,
// since only hashed names are served — but the failure is a missing image on a
// page nobody reloads. Better said here.
// Paths rather than names joined onto one directory: the console lives in its
// own service now, and a bare name would have quietly stopped covering it.
for (const page of [
  'gateway/src/login-page.js',
  'gateway/src/profile-page.js',
  'gateway/src/policy-page.js',
  'admin/console-shell.js',
  'admin/sections/tenants.js',
  'admin/sections/invites.js',
  'admin/sections/settings.js',
  'admin/sections/security.js',
  'admin/sections/audit.js',
]) {
  const text = readFileSync(join(root, page), 'utf8')
  for (const match of text.matchAll(/["']\/login-assets\/[^"']+["']/g)) {
    problems.push(`${page}: ${match[0]} is written by hand; call asset() so it carries the hash`)
  }
}

// ---- the landing build still hashes ----

const vite = readFileSync(join(root, 'web/landing/vite.config.js'), 'utf8')
if (!vite.includes("assetsDir: 'landing'")) {
  problems.push('web/landing/vite.config.js: the asset directory changed; web/site.inc serves /landing/')
}
if (!nginx.includes('location ^~ /landing/ {') || !nginx.includes('immutable')) {
  problems.push('web/site.inc: the landing build\'s hashed assets are not served immutable')
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s) in how assets are cached`)
  process.exit(1)
}

console.log('check-assets: hashed names are immutable, fixed names revalidate')
