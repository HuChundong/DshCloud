/**
 * What the documentation has to hold true, checked without rendering it.
 *
 * Three things, all of which have broken here at least once:
 *
 * - Every relative link and image resolves. Moving the design notes into
 *   `docs/` silently broke eight of them, because a relative path that was
 *   right at the root is wrong one level down.
 * - Every English page has a Chinese pair, and each names the other. A page
 *   translated once and then edited on one side only is worse than an
 *   untranslated one: it reads as current and is not.
 * - The two sides carry the same `##` headings in the same order. Section
 *   drift is how a pair stops being a pair while both files still look fine.
 *
 * Run: node scripts/check-docs.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')

/** Pages that are deliberately English-only, with the reason. */
const UNPAIRED = new Set([
  // Upstream's own file, kept as they publish it.
  'LICENSE.md',
])

/**
 * Tracked markdown, so an untracked scratch file is not a failure.
 * @returns {string[]} repository-relative paths.
 */
function markdownFiles() {
  return execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '')
}

/**
 * The `##` headings of one page, in order.
 * @param {string} source - the page's text.
 * @returns {string[]} the heading lines without their marker.
 */
function sections(source) {
  return [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim())
}

/**
 * Relative link and image targets in one page.
 * @param {string} source - the page's text.
 * @returns {string[]} targets, with any anchor stripped.
 */
function localTargets(source) {
  return [...source.matchAll(/]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => target.split('#')[0])
    .filter((target) => target !== '')
}

const problems = []

/**
 * Record one problem.
 * @param {string} file - where it is.
 * @param {string} message - what is wrong.
 */
function report(file, message) {
  problems.push(`${file}: ${message}`)
}

const files = markdownFiles()

for (const file of files) {
  const source = readFileSync(join(root, file), 'utf8')

  for (const target of localTargets(source)) {
    if (!existsSync(resolve(root, dirname(file), target))) {
      report(file, `link target does not exist: ${target}`)
    }
  }

  if (file.endsWith('.zh.md') || UNPAIRED.has(file)) continue

  const chinese = file.replace(/\.md$/, '.zh.md')
  if (!files.includes(chinese)) {
    report(file, `has no Chinese pair at ${chinese}`)
    continue
  }

  const chineseSource = readFileSync(join(root, chinese), 'utf8')
  const base = file.split('/').pop()
  const chineseBase = chinese.split('/').pop()
  if (!source.includes(`(${chineseBase})`)) report(file, `does not link to ${chineseBase}`)
  if (!chineseSource.includes(`(${base})`)) report(chinese, `does not link to ${base}`)

  const here = sections(source)
  const there = sections(chineseSource)
  if (here.length !== there.length) {
    report(file, `has ${here.length} sections, ${chinese} has ${there.length}`)
  }
}

if (problems.length > 0) {
  console.error('check-docs: documentation is inconsistent\n')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`check-docs: ${files.length} page(s) consistent`)
