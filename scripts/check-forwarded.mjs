/**
 * Every proxied route overwrites the header the gateway trusts.
 *
 * The gateway decides who is calling from the last hop of `X-Forwarded-For`,
 * and that is only the caller when the proxy in front appended the peer it
 * actually received the connection from. nginx passes a client's own headers
 * upstream untouched unless a `proxy_set_header` replaces them — so a location
 * that forgets this one hands the gateway a value the caller wrote, and every
 * decision made from it is the caller's to make.
 *
 * `/login` was such a location, and the limit of twenty verification codes an
 * hour is keyed on exactly that value: a different header per request was a
 * different bucket per request. The limit did not exist, and nothing said so.
 *
 * This compares the file against itself rather than testing a deployment,
 * because the failure is silent in a running system: a forged header produces
 * the same page as an honest one, deliberately, so that the form cannot be
 * used to find out who has an account here.
 *
 * Run: node scripts/check-forwarded.mjs
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
// Both files, because a proxied route that lives in a generated one is still
// a proxied route. `entrypoint.sh` writes the operator console's vhost, and a
// check that only read `site.inc` would have been blind to it — which is the
// exact shape of blindness this check exists to prevent, arriving through the
// door it was watching.
const FILES = ['web/site.inc', 'web/entrypoint.sh']

/** The header every proxied location has to set, exactly as nginx wants it. */
const REQUIRED = 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'

/**
 * Every `location` block in the file, with its body.
 *
 * Braces are counted rather than matched with one expression, because a
 * location can hold another block and a regex that stops at the first `}`
 * would read half of one.
 *
 * @param {string} text - the configuration.
 * @returns {Array<{name: string, body: string, line: number}>} the blocks.
 */
function locations(text) {
  const found = []
  // Indentation allowed: a vhost written into a file nests its locations.
  for (const match of text.matchAll(/^[ \t]*location\s+([^{]+)\{/gm)) {
    const start = match.index + match[0].length - 1
    let depth = 0
    let index = start
    for (; index < text.length; index += 1) {
      if (text[index] === '{') depth += 1
      else if (text[index] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    found.push({
      name: match[1].trim(),
      body: text.slice(start, index + 1),
      line: text.slice(0, match.index).split('\n').length,
    })
  }
  return found
}

const problems = []
let checked = 0

for (const file of FILES) {
  const source = readFileSync(join(root, file), 'utf8')
  for (const { name, body, line } of locations(source)) {
    if (!body.includes('proxy_pass')) continue
    checked += 1
    // The generated file escapes nginx's variables for the shell that writes
    // it, so the header reads `\\$proxy_add_x_forwarded_for` there.
    const has = body.includes(REQUIRED) || body.includes(REQUIRED.replaceAll('$', '\\$'))
    if (!has) {
      problems.push(`${file}:${String(line)}: location ${name} proxies upstream without overwriting X-Forwarded-For`)
    }
  }
}

// A file with no proxied routes at all would pass every case above while
// meaning the parse went wrong, not that the configuration is clean.
if (checked === 0) {
  problems.push(`${FILES.join(' and ')}: no proxied routes found, which is not a configuration this check understands`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s): the gateway would trust a caller's own header`)
  process.exit(1)
}

console.log(`check-forwarded: ${String(checked)} proxied route(s) overwrite the caller's address`)
