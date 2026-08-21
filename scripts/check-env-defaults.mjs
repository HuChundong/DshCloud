/**
 * A default that never applies, because the variable is always there.
 *
 * Compose hands an optional variable to a container as `${NAME:-}`, which
 * means a deployment that never set it still HAS it — as an empty string.
 * `??` falls back on `undefined` and not on `''`, so a default written that
 * way is dead code and the empty string is what runs.
 *
 * This is not theoretical and it is not cheap. `EMAIL_API_URL` was read with
 * `??`, so production called `fetch('')` for every sign-in and answered
 * "the code could not be sent" — no configuration was wrong, the default
 * simply never applied, and nothing said so until someone tried to log in.
 * `POLICY_CONTACT` had the same shape and would have published a data notice
 * naming nobody.
 *
 * So: every variable this repository's compose file can pass through empty is
 * read as "given or not given", never as "present or absent". The check reads
 * the compose file for the list rather than carrying its own, because the two
 * drifting apart is how the next one arrives.
 *
 * Run: node scripts/check-env-defaults.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')

/** Every `${NAME:-}` in the compose file: optional, and empty when unset. */
function passedThroughEmpty() {
  const compose = readFileSync(join(root, 'compose.yml'), 'utf8')
  return [...new Set([...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*):-\}/g)].map((m) => m[1]))]
}

const problems = []
let checked = 0

const names = passedThroughEmpty()
if (names.length === 0) {
  problems.push('compose.yml: no `${NAME:-}` variables found, which is not a file this check understands')
}

for (const file of readdirSync(join(root, 'gateway/src')).filter((name) => name.endsWith('.js'))) {
  const source = readFileSync(join(root, 'gateway/src', file), 'utf8')
  for (const name of names) {
    for (const match of source.matchAll(new RegExp(`process\\.env\\.${name}\\s*\\?\\?\\s*(.{0,24})`, 'g'))) {
      checked += 1
      const fallback = match[1].trimStart()
      // `?? ''` is the honest spelling: it normalises absent to empty and then
      // the code asks whether it is empty. Anything else is a value that was
      // meant to be used and will not be.
      if (fallback.startsWith("''") || fallback.startsWith('""')) continue
      const line = source.slice(0, match.index).split('\n').length
      problems.push(
        `gateway/src/${file}:${String(line)}: \`${name} ?? ${fallback.slice(0, 20)}\` — compose passes this variable`
        + ' through empty, so the fallback never runs. Ask whether it was given, not whether it exists.',
      )
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s): a default that cannot apply`)
  process.exit(1)
}

console.log(`check-env-defaults: ${String(names.length)} optional variable(s), ${String(checked)} reading(s), none relying on a default that never runs`)
