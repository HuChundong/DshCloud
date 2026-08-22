/**
 * Every variable a service reads is a variable its container is given.
 *
 * The operator's console was split out of the gateway and kept importing the
 * gateway's modules — `settings.js`, `accounts.js` — which read the
 * deployment's own variables. The compose file was not extended to match, so
 * those reads returned nothing and the console reported, confidently, that a
 * working model credential was not set and that the deployment named no
 * administrators.
 *
 * Nothing failed. That is what makes this worth a gate rather than a fix: a
 * missing variable is not an error, it is a default, and a service reporting
 * on a deployment it cannot see reports the default as the truth.
 *
 * The rule is disagreement, not completeness. Requiring every variable to be
 * declared would mean listing a dozen tuning knobs that have good defaults and
 * that no deployment sets — noise, and noise is how a gate stops being read.
 *
 * What is checked instead: when two services share a module that reads X, and
 * one of them is given X, the other must be too. That is exactly the shape of
 * the bug. Both services read `settings.js`; the gateway was given the model
 * credential and the console was not, so the two disagreed about a deployment
 * they are both reporting on. A knob neither service is given is a default
 * they share, which is fine.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/** The services this applies to, and where each one's code starts. */
const SERVICES = [
  { service: 'admin', roots: ['admin'] },
  { service: 'gateway', roots: ['gateway/src'] },
]

/**
 * Variables that belong to the runtime rather than to the deployment.
 *
 * `NODE_ENV` and friends are set by the image or by node itself, and listing
 * them in compose would say something untrue about where they come from.
 */
const AMBIENT = new Set(['NODE_ENV', 'TZ', 'PORT', 'HOME', 'PATH'])

/**
 * Every `process.env` name read from a file and everything it imports.
 *
 * @param {string} entry - the file to start from.
 * @param {Set<string>} seen - files already walked.
 * @param {Map<string, Set<string>>} found - variable to the files reading it.
 * @returns {void}
 */
function walk(entry, seen, found) {
  if (seen.has(entry)) return
  seen.add(entry)
  let source
  try {
    source = readFileSync(entry, 'utf8')
  } catch {
    return
  }
  for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    if (AMBIENT.has(match[1])) continue
    if (!found.has(match[1])) found.set(match[1], new Set())
    found.get(match[1]).add(entry)
  }
  // Relative imports only. A package's own variables are its business.
  for (const match of source.matchAll(/from '(\.[^']+)'/g)) {
    walk(path.join(path.dirname(entry), match[1]), seen, found)
  }
}

/**
 * The environment block one compose service declares.
 *
 * Read as text rather than as YAML: this repository has no YAML parser as a
 * dependency, and the shape here is flat enough that finding the service and
 * reading the indented `environment:` under it is unambiguous.
 *
 * @param {string} compose - the file's contents.
 * @param {string} service - the service name.
 * @returns {Set<string>} the variables it is given.
 */
function declaredFor(compose, service) {
  const lines = compose.split('\n')
  const start = lines.findIndex((line) => line === `  ${service}:`)
  if (start < 0) return new Set()
  const given = new Set()
  let inEnvironment = false
  for (const line of lines.slice(start + 1)) {
    // The next service at the same indentation ends this one.
    if (/^ {2}\S/.test(line)) break
    if (/^ {4}environment:/.test(line)) {
      inEnvironment = true
      continue
    }
    if (inEnvironment && /^ {4}\S/.test(line)) inEnvironment = false
    if (!inEnvironment) continue
    const named = /^ {6}([A-Z0-9_]+):/.exec(line)
    if (named !== null) given.add(named[1])
  }
  return given
}

// Every compose file, because an overlay is where a deployment's own variables
// often are, and a service is given the union of what all of them declare.
const composeFiles = readdirSync('.').filter((name) => /^compose(\..+)?\.yml$/.test(name)).sort()
const sources = composeFiles.map((name) => readFileSync(name, 'utf8'))

/** What each service reads, and what each service is given. */
const reads = new Map()
const given = new Map()

for (const { service, roots } of SERVICES) {
  const found = new Map()
  const seen = new Set()
  for (const root of roots) {
    for (const file of readdirSync(root)) {
      if (file.endsWith('.js')) walk(path.join(root, file), seen, found)
    }
  }
  reads.set(service, found)
  const declared = new Set()
  for (const source of sources) for (const name of declaredFor(source, service)) declared.add(name)
  given.set(service, declared)
}

let problems = 0
let shared = 0

for (const [service, found] of reads) {
  for (const [name, files] of [...found].sort()) {
    // Only variables another service also reads, and that the other service is
    // actually given. Anything else is a default, not a disagreement.
    const others = [...reads]
      .filter(([other, theirs]) => other !== service && theirs.has(name) && given.get(other).has(name))
      .map(([other]) => other)
    if (others.length === 0) continue
    shared += 1
    if (given.get(service).has(name)) continue
    problems += 1
    const where = [...files].sort().join(', ')
    console.error(
      `check-service-env: ${service} reads ${name} (${where}) and is not given it, `
      + `while ${others.join(', ')} is — so the two disagree about the same deployment`,
    )
  }
}

if (problems > 0) {
  console.error(`check-service-env: ${String(problems)} variable(s) that two services read and only one of them sees`)
  console.error('check-service-env: this does not fail at runtime — it reports a default as the deployment\'s answer')
  process.exit(1)
}

console.log(`check-service-env: ${String(shared)} shared variable reading(s), none of them one-sided`)
