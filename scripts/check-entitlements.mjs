/**
 * Every entitlement is obeyed by somebody.
 *
 * `plans.js` holds tier ids and no capabilities, on the stated grounds that a
 * capability listed where no code consults it is a promise with no mechanism
 * behind it. `entitlements.js` is where those capabilities go, and the same
 * rule has to hold there — except that a field is far easier to add than a
 * mechanism, and a table of them reads as a feature list long before anything
 * enforces one.
 *
 * So the rule is enforced rather than remembered. A name in `FIELDS` has to be
 * read somewhere in the runtime, and a field the resolver returns has to be
 * declared. Both directions matter: an unread field is the promise this
 * forbids, and an undeclared one is a capability nobody can find.
 *
 * What this cannot check is whether the reading is meaningful — a field could
 * be read into a variable nobody uses. That is what review is for. What it
 * catches is the thing that happens by itself: a tier gaining a number during
 * a pricing conversation, months before any code obeys it.
 *
 * Run: node scripts/check-entitlements.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'gateway/src')

const { FIELDS, entitlementsOf } = await import(`file://${join(source, 'entitlements.js')}`)

const problems = []

/** Where a field may be read. The module that declares them does not count. */
const readers = readdirSync(source)
  .filter((name) => name.endsWith('.js') && name !== 'entitlements.js')
  .map((name) => ({ name, text: readFileSync(join(source, name), 'utf8') }))

if (FIELDS.length === 0) {
  problems.push('entitlements.js declares no fields, which is not a state this check understands')
}

for (const field of FIELDS) {
  // Read through the record, however the caller spells its way there:
  // `entitlements.machine`, `record.entitlements?.idleTtlMs`, a destructure.
  const used = readers.filter(({ text }) => (
    new RegExp(`entitlements[^\\n]{0,24}\\.${field}\\b`).test(text)
    || new RegExp(`\\{[^}\\n]*\\b${field}\\b[^}\\n]*\\}\\s*=\\s*[^\\n]*entitlements`).test(text)
    || new RegExp(`\\bowner\\.${field}\\b`).test(text)
  ))
  if (used.length === 0) {
    problems.push(
      `\`${field}\` is declared in entitlements.js and nothing in gateway/src reads it —`
      + ' a capability with no mechanism is the thing plans.js refuses to carry',
    )
  }
}

// The other direction: what the resolver hands out has to be declared, or a
// consumer could obey something this check knows nothing about.
const resolved = Object.keys(entitlementsOf({ plan: 'free' }))
for (const key of resolved) {
  if (!FIELDS.includes(key)) {
    problems.push(`entitlementsOf returns \`${key}\`, which FIELDS does not declare`)
  }
}
for (const field of FIELDS) {
  if (!resolved.includes(field)) {
    problems.push(`FIELDS declares \`${field}\`, which entitlementsOf does not return — a reader would see undefined for every tier`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s): an entitlement nobody obeys`)
  process.exit(1)
}

console.log(`check-entitlements: ${String(FIELDS.length)} entitlement(s), each declared, resolved and read`)
