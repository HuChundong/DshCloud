/**
 * One icon table, and the markup helper the surfaces outside the shell use.
 *
 * Which surfaces those are is the whole reason this package exists. Every
 * browser half of every plugin runs inside dsh and can ask the shell's module
 * table for `@deepseek-ai/dsh-client-ui-primitives`, which is the real icon set
 * — 70 React components, MIT, drawn from the same figma source the rest of the
 * interface is. Those consumers import nothing from here except the glyphs the
 * harness has no drawing for.
 *
 * The gateway's pages and the landing page cannot do that. The gateway writes
 * HTML into template literals from Node, and the landing page is a static
 * document; neither has a module table, a React runtime, or a place to put a
 * component. What they can hold is path data, so that is what this hands them.
 *
 * The table is therefore two halves that are deliberately unlike each other:
 *
 * - `mirrored` is upstream's drawing, generated into `mirrored.js` by
 *   `mirror.mjs` and stamped with the harness version it came from. Never
 *   edited here — a fix goes upstream and comes back through the generator.
 * - `extracted` is Bootstrap Icons, generated into `extracted.js` by
 *   `extract.mjs` and stamped with the version it came from, for the ten
 *   things the harness set does not carry. Also never edited here.
 *
 * Both halves are therefore somebody else's drawing, and that is the point.
 * These ten were authored here first, and ten icons made beside everything
 * else this deployment does do not sit beside seventy a designer made.
 * Bootstrap Icons is the closest ready-made set by the two measures that
 * decide whether a glyph belongs next to another: a 16x16 grid, which is
 * upstream's grid, and filled outlines rather than solid silhouettes, which is
 * upstream's construction. MIT, and vendored as path data for the same reason
 * the mirrored half is — the pages that read this have no module table.
 *
 * `scripts/check-icons.mjs` holds both halves to their consumers, so an icon
 * changed here and not re-inlined — or inlined and not changed here — fails
 * before it is committed.
 */

import { extracted } from './extracted.js'
import { MIRRORED_FROM, mirrored } from './mirrored.js'

export { MIRRORED_FROM }

/**
 * Every glyph this package can hand out, by name.
 *
 * One namespace over both halves, because a consumer asking for `plus` has no
 * reason to care which side of the line it came from — and a name that moves
 * from one to the other, because upstream drew it at last, should not be a
 * change at every call site.
 *
 * @type {Record<string, {viewBox: string, paths: string[]}>}
 */
export const icons = { ...mirrored, ...extracted }

/** Which half a name came from, for the check to report and nothing else. */
export const origin = (name) => (name in extracted ? 'extracted' : name in mirrored ? 'mirrored' : undefined)

/**
 * One glyph as SVG markup.
 *
 * Each half is painted the way it was drawn, and the glyph says which it is.
 * The harness's are outlines already expanded to filled shapes, so they are
 * filled, `evenodd` leaving the middle of a ring open. Lucide's are strokes,
 * and filling a stroke turns a drawing into a blot — so a glyph carrying a
 * `stroke` is stroked, at the width it was drawn with, with its own caps and
 * joins. That roundness is the reason for taking them.
 *
 * No colour either way: every path is `currentColor`, so a glyph takes the ink
 * of whatever it sits in. `check-icons.mjs` holds both halves to that.
 *
 * Sizes are not converted. Lucide is drawn on a 24 box and the harness on a
 * 16, and a viewBox is a coordinate system rather than a size — both are
 * rendered at whatever edge the call site asks for. What has to match is the
 * WEIGHT of the line as a fraction of the box, and it does: 2/24 against
 * 1.3/16, two per cent apart. `extract.mjs` refuses a glyph that drifts.
 *
 * The result is a string rather than a node because both consumers are
 * assembling documents as text — Node writing a page, and a static file the
 * landing build parses.
 *
 * @param {string} name - a key of `icons`.
 * @param {{size?: number, className?: string, title?: string}} [options] - how to present it.
 * @returns {string} the `<svg>` element.
 * @throws {Error} if no glyph carries that name.
 */
export const svg = (name, options = {}) => {
  const glyph = icons[name]
  if (glyph === undefined) throw new Error(`no icon named ${name}`)
  const size = options.size ?? Number(glyph.viewBox.split(' ')[2])
  const attributes = [
    `viewBox="${glyph.viewBox}"`,
    `width="${size}"`,
    `height="${size}"`,
    'fill="none"',
    options.className === undefined ? undefined : `class="${options.className}"`,
    // Decorative unless it is given a name, which is the same call every
    // consumer here was already making by hand.
    options.title === undefined ? 'aria-hidden="true"' : 'role="img"',
  ].filter((attribute) => attribute !== undefined)
  const label = options.title === undefined ? '' : `<title>${options.title}</title>`
  const paint = glyph.stroke === undefined
    ? 'fill="currentColor" fill-rule="evenodd"'
    : `stroke="currentColor" stroke-width="${String(glyph.stroke.width)}"`
      + ` stroke-linecap="${glyph.stroke.linecap}" stroke-linejoin="${glyph.stroke.linejoin}" fill="none"`
  // A glyph mirrored where it was taken carries the transform that mirrors it,
  // because rewriting path data means parsing every command and an arc's flags
  // do not survive a naive negation.
  const turn = glyph.transform === undefined ? '' : ` transform="${glyph.transform}"`
  const paths = glyph.paths.map((d) => `<path d="${d}"${turn} ${paint}/>`).join('')
  return `<svg ${attributes.join(' ')}>${label}${paths}</svg>`
}

/**
 * One glyph as a `url()` value, for the places CSS draws the icon.
 *
 * The gateway's select control is one: a chevron cannot be a child element
 * there, so it is a background image. Percent-encoded rather than base64 —
 * it stays readable in the stylesheet, and it is shorter for markup this small.
 *
 * The colour has to be named here, because a data URI is a document of its own
 * and `currentColor` inside it resolves against nothing. That is the one place
 * this package emits ink, and the caller supplies it.
 *
 * @param {string} name - a key of `icons`.
 * @param {string} colour - a CSS colour the SVG will carry literally.
 * @param {number} [size] - the square edge, defaulting to the glyph's own.
 * @returns {string} a `url("data:image/svg+xml,…")` value.
 */
export const cssUrl = (name, colour, size) => {
  const glyph = icons[name]
  if (glyph === undefined) throw new Error(`no icon named ${name}`)
  const edge = size ?? Number(glyph.viewBox.split(' ')[2])
  const paths = glyph.paths.map((d) => `<path d='${d}' fill='${colour}' fill-rule='evenodd'/>`).join('')
  const markup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${glyph.viewBox}'`
    + ` width='${edge}' height='${edge}' fill='none'>${paths}</svg>`
  // Only what a `url("…")` cannot carry literally. Encoding the spaces and the
  // slashes as well would be valid and three times as long, and the stylesheet
  // is read by people.
  const encoded = markup.replace(/[<>#%"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `url("data:image/svg+xml,${encoded}")`
}
