/**
 * This deployment's own plugins, in two languages, checked without a browser.
 *
 * The shell offers a language switch, and a plugin that ignores it
 * half-translates the window: the tenant picks English and the sidebar, the
 * settings pages and the file panel stay Chinese. So every string these plugins
 * show goes through the shell's own locale service, and this asserts that it
 * really does.
 *
 * Four things, and the last is the one that bites:
 *
 * - No Chinese outside a dictionary. A literal left in the markup is a string
 *   that never translates, and nothing about it looks wrong in either language.
 * - Every key a plugin asks for exists in both languages, and every key a
 *   dictionary carries is asked for.
 * - No component finds its section by matching visible text — a handle that
 *   works only while there is one language for the text to be in.
 * - Every component that calls `t` actually has one. `t` is not a global, and
 *   nothing in the lint rules objects to a free variable, so a component that
 *   uses it without `const t = useT()` passes every check and then throws the
 *   first time it renders.
 *
 * Run: node scripts/check-plugins.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const CJK = /[一-鿿]/

/** The plugins this deployment writes, and the file each says its words in. */
function sources() {
  const found = []
  for (const name of readdirSync(join(root, 'packages'))) {
    for (const relative of [`packages/${name}/client.js`, `packages/${name}/src/client.js`]) {
      const file = join(root, relative)
      if (existsSync(file)) found.push({ name, relative, text: readFileSync(file, 'utf8') })
    }
  }
  return found
}

/**
 * A plugin's dictionary, read from its source rather than duplicated here.
 *
 * @param {string} text - the plugin source.
 * @returns {{zh: Record<string, string>, en: Record<string, string>}|undefined} the dictionary.
 */
function dictionary(text) {
  const start = text.indexOf('const DICTIONARY = {')
  if (start === -1) return undefined
  // The literal ends at the first `}` sitting at the indentation the const was
  // declared at, which holds because everything nested inside is indented past
  // it.
  const indent = ' '.repeat(text.slice(0, start).length - text.lastIndexOf('\n', start) - 1)
  const end = text.indexOf(`\n${indent}}\n`, start)
  if (end === -1) return undefined
  const literal = text.slice(start + 'const DICTIONARY = '.length, end + indent.length + 2)
  // The span too, because the rest of this file has to be able to read the
  // source WITHOUT it: a key is written in quotes inside the dictionary, so a
  // search for "is this key named anywhere" finds its own definition and calls
  // every dead key alive.
  return { entries: new Function(`return ${literal}`)(), rest: text.slice(0, start) + text.slice(end) }
}

const problems = []

for (const { relative, text } of sources()) {
  const found = dictionary(text)
  const dict = found?.entries
  const chinese = CJK.test(text.replaceAll(/^\s*(?:\/\/|\*|\/\*).*$/gm, ''))

  if (found === undefined) {
    // A plugin with nothing to say needs no dictionary; one with Chinese in it
    // and no dictionary has simply not been translated.
    if (chinese) problems.push(`${relative}: has Chinese in it and no DICTIONARY`)
    continue
  }

  // ---- both languages carry the same keys ----

  const zh = Object.keys(dict.zh ?? {})
  const en = Object.keys(dict.en ?? {})
  for (const key of zh) if (!en.includes(key)) problems.push(`${relative}: ${key} has no English`)
  for (const key of en) if (!zh.includes(key)) problems.push(`${relative}: ${key} has no Chinese`)
  for (const [language, entries] of Object.entries(dict)) {
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'string' || value.trim() === '') problems.push(`${relative}: ${key} is empty in ${language}`)
    }
  }

  // ---- every key asked for exists, and every key carried is asked for ----

  // Any quoted string in the source that matches a key, rather than only the
  // ones written directly inside a `t(...)`. Keys are chosen by an expression
  // as often as not — `t(running ? 'status.running' : 'status.starting')` — and
  // a check that only saw the literal form would call the other half dead.
  // `*` rather than `+`, so an empty literal is consumed as one. With `+` the
  // scan skips the empty string's opening quote, pairs its closing quote with
  // the next literal's opening one, and reads the code between them as a
  // string — which silently hides every real literal on the line.
  const quoted = new Set([...found.rest.matchAll(/'([^'\n]*)'/g)].map((match) => match[1]))
  // Keys the source builds rather than writes — `t(`error.${code}`)` — are
  // named by their prefix. Anything under a prefix the source interpolates is
  // reachable, and asserting more than that would mean knowing what the
  // gateway can send, which is not in this file.
  const built = [...found.rest.matchAll(/`([\w.]+)\.\$\{/g)].map((match) => match[1])
  const asked = new Set([...text.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]))
  for (const key of asked) {
    if (!zh.includes(key)) problems.push(`${relative}: ${key} is asked for and is not in the dictionary`)
  }
  for (const key of zh) {
    if (quoted.has(key)) continue
    if (built.some((prefix) => key.startsWith(`${prefix}.`))) continue
    problems.push(`${relative}: ${key} is in the dictionary and nothing names it`)
  }

  // ---- nothing outside the dictionary is Chinese ----

  for (const line of found.rest.split('\n')) {
    const code = line.replace(/^\s*(?:\/\/|\*|\/\*).*$/, '')
    if (!CJK.test(code)) continue
    problems.push(`${relative}: Chinese outside the dictionary — ${code.trim().slice(0, 50)}`)
  }

  // ---- a key reaches something that translates it ----

  // `navLabel(path, 'account')` takes a KEY, and if the thing it builds renders
  // its argument as text the settings nav shows the word `account` — in every
  // language, which is neither of them. Nothing else catches this: the key is
  // in the dictionary, it is named in the source, and no Chinese is left over,
  // so every other rule here passes while the nav is wrong.
  if (/navLabel\([^,]+,\s*'[^']+'\)/.test(text) && !/const NavLabel = /.test(text)) {
    problems.push(`${relative}: navLabel is handed a key but nothing translates it — the nav will show the key itself`)
  }

  // ---- no handle that is really a translation ----

  if (/textContent\?*\.?\s*(?:trim\(\)\s*)?===\s*'[^']*[一-鿿]/.test(text)) {
    problems.push(`${relative}: finds an element by its visible Chinese, which stops working when it is translated`)
  }

  // ---- every component that calls `t` has one ----

  const lines = text.split('\n')
  // Every top-level definition, so one body ends where the next begins. Only
  // the components among them are checked, but all of them bound the ranges —
  // measuring to the next COMPONENT instead swallows whatever plain functions
  // sit between two of them, and reports the first component as using a `t`
  // that belongs to something else entirely.
  const bounds = lines
    .map((line, index) => (/^ {4}(?:const|let|function|class)\s/.test(line) ? index : -1))
    .filter((index) => index !== -1)
  const defs = lines
    .map((line, index) => [index, /^ {4}(?:const\s+([A-Z][\w$]*)\s*=\s*(?:\(|function|React\.memo)|function\s+([A-Z][\w$]*)\s*\(|class\s+([A-Z][\w$]*)\s)/.exec(line)])
    .filter(([, match]) => match !== null)
    .map(([index, match]) => [index, match[1] ?? match[2] ?? match[3], match[3] !== undefined])
  for (const [index, component, isClass] of defs) {
    const next = bounds.find((at) => at > index) ?? lines.length
    const body = lines.slice(index, next).join('\n')
    if (!/\bt\(\s*'/.test(body)) continue
    // A class component cannot hold a hook at all, so `useT` is not the fix
    // there — it has to ask imperatively. The one that got this wrong was the
    // error boundary, which is the component that runs when everything else
    // has already thrown: it threw too, and took the panel with it.
    if (isClass) {
      problems.push(`${relative}: ${component} is a class and calls t() — a class cannot hold a hook; use say()('key')`)
      continue
    }
    if (!/const t = useT\(\)/.test(body)) {
      problems.push(`${relative}: ${component} calls t() and never binds it — it will throw on its first render`)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(`\n${problems.length} problem(s) in the deployment's plugins`)
  process.exit(1)
}

console.log("check-plugins: every string this deployment's plugins show carries both languages")
