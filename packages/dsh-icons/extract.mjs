/**
 * Take the glyphs the harness has no drawing for from a set that has them.
 *
 * These ten were drawn here, by hand, because upstream's set does not carry
 * them — and it showed. Drawing an icon is a craft with its own grid, its own
 * optical corrections and its own conventions for weight, and ten of them
 * authored beside the ninety other things this deployment does were never
 * going to sit beside seventy that a designer made.
 *
 * Substituting upstream glyphs was considered first and is wrong for every one
 * of them: `copy` and `copy-text` are two buttons side by side and would have
 * become the same button; `shrink` is leaving fullscreen and upstream draws
 * only entering it; `terminal` would have taken the glyph this panel already
 * shows for a code file; `shield` means safety and upstream's nearest is a
 * warning; `list` upstream is a checklist or a list being edited. A name that
 * matches is not a meaning that matches.
 *
 * So they come from Bootstrap Icons, which is the closest ready-made set by
 * the two measures that decide whether an icon belongs beside another: it is
 * drawn on a 16x16 grid, which is upstream's grid, and it is drawn as filled
 * outlines rather than solid silhouettes, which is upstream's construction.
 * MIT, and vendored as path data rather than depended on — the same treatment
 * `mirrored.js` gets, for the same reason: these files are read by a static
 * page with no module table.
 *
 * Run: node packages/dsh-icons/extract.mjs   (needs bootstrap-icons installed)
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname)

/**
 * Our name for the glyph, and the Bootstrap Icons file it comes from.
 *
 * Chosen by what the icon has to say where this deployment shows it, not by
 * whose name is closest. Each line says why where the choice was not obvious.
 */
const WANTED = {
  terminal: 'terminal',
  // Leaving fullscreen, which is the other half of upstream's `Fullscreen`.
  shrink: 'minimize-2',
  file: 'file',
  // The file's CONTENTS, next to a button that copies its PATH. Two sheets,
  // because the thing being taken is what is written on them.
  'copy-text': 'files',
  image: 'image',
  // Lucide has no markdown mark, and inventing one from a name that merely
  // sounds right is how the wrong glyph gets chosen. A page of prose is what
  // markdown IS here — it is the one kind the panel renders as prose rather
  // than as text — so that is what it wears.
  markdown: 'file-text',
  signout: 'log-out',
  // The front door's, and only the front door's. A shield says the thing
  // behind it is guarded; behind the console link are three lists of people.
  shield: 'shield',
  list: 'list',
  // The sandbox is a box a tenant's work sits inside.
  sandbox: 'box',
  // The operator's console, whose sections are administrators, users and
  // invite codes: everyone who has an account, not one being configured.
  people: 'users',

  // The console's sidebar. One per section, and each is the section's subject
  // rather than a decoration for its name: a code that admits somebody is a
  // ticket, a trail of what was done is a history, and the settings are the
  // one thing here that is a machine being adjusted rather than a person being
  // managed.
  ticket: 'ticket',
  history: 'history',
  settings: 'settings',

  // The file tree's kinds. All but `data` are the same sheet `file` is, marked
  // — so a column of them reads as one shape with differences in it rather
  // than as a row of unrelated pictures, which is what a mixed tree has to
  // look like to be scannable at 14px.
  // The harness has a glyph it calls `code`, and it draws a hash — `#`, with
  // the square hole in the middle. Whatever it means there, a `.py` in a file
  // tree wearing it is a file labelled with a symbol from another sentence.
  code: 'file-code',
  data: 'file-braces',
  archive: 'file-archive',
  table: 'file-spreadsheet',
  media: 'file-video',
}

/** Where the set came from, recorded beside what was taken from it. */
const PACKAGE = 'lucide-static'

/**
 * One attribute of one element, as a number.
 * @param {string} element - the element's source.
 * @param {string} name - the attribute.
 * @returns {number} its value.
 */
function attribute(element, name) {
  const found = new RegExp(`\\s${name}="([^"]+)"`).exec(element)
  if (found === null) throw new Error(`extract: an element is missing ${name}: ${element}`)
  return Number(found[1])
}

/**
 * Every drawing in one glyph, as path data, in document order.
 *
 * Lucide draws with the whole primitive vocabulary, not just `<path>` — a
 * head is a `<circle>`, a picture frame is a `<rect>`. An earlier version of
 * this read `d` attributes and nothing else, so those shapes were dropped
 * without a word and the glyph arrived incomplete: `users` came through as a
 * body with no head, and nothing failed. Silence is the part that mattered.
 *
 * So every primitive is converted, and anything not converted throws. A set
 * this does not fully understand must stop the extraction rather than produce
 * three quarters of a drawing that then has to be noticed by eye.
 *
 * @param {string} svg - the file's contents.
 * @param {string} name - the glyph, for the errors.
 * @returns {string[]} the path data.
 */
function paths(svg, name) {
  const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1)
  const found = []
  for (const match of body.matchAll(/<([a-z]+)\b([^>]*)\/?>/g)) {
    const [element, tag] = [match[0], match[1]]
    if (tag === 'svg' || tag === 'title' || tag === 'desc' || tag === 'defs' || tag === 'g') continue
    if (tag === 'path') {
      found.push(/\sd="([^"]+)"/.exec(element)?.[1] ?? '')
      continue
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = attribute(element, 'cx')
      const cy = attribute(element, 'cy')
      const rx = tag === 'circle' ? attribute(element, 'r') : attribute(element, 'rx')
      const ry = tag === 'circle' ? rx : attribute(element, 'ry')
      // Two half arcs, because one arc cannot close on its own start point.
      found.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`)
      continue
    }
    if (tag === 'rect') {
      const x = attribute(element, 'x')
      const y = attribute(element, 'y')
      const w = attribute(element, 'width')
      const h = attribute(element, 'height')
      const r = /\srx="([^"]+)"/.test(element) ? attribute(element, 'rx') : 0
      found.push(r === 0
        ? `M${x} ${y}h${w}v${h}h${-w}z`
        : `M${x + r} ${y}h${w - r * 2}a${r} ${r} 0 0 1 ${r} ${r}v${h - r * 2}`
          + `a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r * 2)}a${r} ${r} 0 0 1 ${-r} ${-r}`
          + `v${-(h - r * 2)}a${r} ${r} 0 0 1 ${r} ${-r}z`)
      continue
    }
    if (tag === 'line') {
      found.push(`M${attribute(element, 'x1')} ${attribute(element, 'y1')}`
        + `L${attribute(element, 'x2')} ${attribute(element, 'y2')}`)
      continue
    }
    if (tag === 'polyline' || tag === 'polygon') {
      const points = /\spoints="([^"]+)"/.exec(element)?.[1] ?? ''
      const numbers = points.trim().split(/[\s,]+/)
      if (numbers.length < 4) throw new Error(`extract: ${name} has a ${tag} with too few points`)
      const pairs = []
      for (let at = 0; at < numbers.length; at += 2) pairs.push(`${numbers[at]} ${numbers[at + 1]}`)
      found.push(`M${pairs.join('L')}${tag === 'polygon' ? 'z' : ''}`)
      continue
    }
    throw new Error(`extract: ${name} draws with <${tag}>, which this does not convert — add it rather than losing it`)
  }
  if (found.length === 0) throw new Error(`extract: ${name} has no drawing at all`)
  if (found.some((d) => d === '')) throw new Error(`extract: ${name} has a <path> with no d`)
  return found
}

const install = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--prefix', install, PACKAGE], {
  stdio: ['ignore', 'ignore', 'inherit'],
})
const base = join(install, 'node_modules', PACKAGE)
const version = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version

/**
 * How heavy upstream's line is, as a fraction of the glyph's own box.
 *
 * The harness draws on a 16 grid with a 1.3 stroke expanded to a filled
 * outline, so its line is 1.3/16 of the box wherever it is rendered. Lucide
 * draws on a 24 grid with a 2 stroke, which is 2/24 — within two per cent of
 * the same weight, which is why these can sit in one row without either
 * looking bolder than the other.
 *
 * Checked rather than assumed, because it is the whole argument for taking a
 * 24-grid set into a 16-grid interface: nothing is rescaled, the two are
 * simply drawn at the same relative weight and the browser fits each to
 * whatever size the call site asks for.
 */
const UPSTREAM_WEIGHT = 1.3 / 16

/** How far from upstream's weight a glyph may be and still belong in the row. */
const WEIGHT_TOLERANCE = 0.1

const glyphs = Object.fromEntries(Object.entries(WANTED).map(([key, file]) => {
  const svg = readFileSync(join(base, 'icons', `${file}.svg`), 'utf8')
  const box = /viewBox="([^"]+)"/.exec(svg)?.[1]
  if (box === undefined) throw new Error(`extract: ${file} has no viewBox`)
  const edge = Number(box.split(/\s+/)[2])
  const width = Number(/stroke-width="([^"]+)"/.exec(svg)?.[1] ?? '0')
  if (!(edge > 0) || !(width > 0)) throw new Error(`extract: ${file} is not a stroked glyph on a square box`)
  const weight = width / edge
  const drift = Math.abs(weight - UPSTREAM_WEIGHT) / UPSTREAM_WEIGHT
  if (drift > WEIGHT_TOLERANCE) {
    throw new Error(`extract: ${file} draws its line at ${weight.toFixed(4)} of its box, ${(drift * 100).toFixed(0)}% off the harness's ${UPSTREAM_WEIGHT.toFixed(4)}`)
  }
  return [key, {
    from: file,
    viewBox: box,
    paths: paths(svg, file),
    // Carried with the glyph rather than assumed by whoever draws it: this
    // half is stroked and the mirrored half is filled, and a renderer that
    // guessed would paint one of them as a blot.
    stroke: {
      width,
      linecap: /stroke-linecap="([^"]+)"/.exec(svg)?.[1] ?? 'round',
      linejoin: /stroke-linejoin="([^"]+)"/.exec(svg)?.[1] ?? 'round',
    },
  }]
}))

const body = Object.entries(glyphs).map(([key, glyph]) => {
  const list = glyph.paths.map((d) => `\n      '${d}',`).join('')
  const paint = `\n    stroke: { width: ${String(glyph.stroke.width)}, linecap: '${glyph.stroke.linecap}', linejoin: '${glyph.stroke.linejoin}' },`
  return `  '${key}': {\n    from: '${glyph.from}',\n    viewBox: '${glyph.viewBox}',\n    paths: [${list}\n    ],${paint}\n  },`
}).join('\n')

writeFileSync(join(root, 'extracted.js'), `/**
 * Glyphs the harness set does not carry, taken from ${PACKAGE}.
 *
 * Generated by \`extract.mjs\`. Never edited here: a change is a change to the
 * table in that file, and this one is regenerated from it.
 *
 * ${PACKAGE} is MIT. Each glyph records the file it came from, so a reader can
 * check the drawing against its source without guessing at the name.
 *
 * @module extracted
 */

/** The set these were taken from. */
export const EXTRACTED_SET = '${PACKAGE}'

/** The version of ${PACKAGE} these were taken from. */
export const EXTRACTED_FROM = '${version}'

/** The set, by this deployment's name for each glyph. */
export const extracted = Object.freeze({
${body}
})
`)

process.stdout.write(`extracted ${String(Object.keys(glyphs).length)} glyphs from ${PACKAGE}@${version}\n`)
