/**
 * One icon set, held to its consumers.
 *
 * The interface a tenant sees is drawn by two things at once: the harness,
 * which ships 70 glyphs in `@deepseek-ai/dsh-client-ui-primitives`, and this
 * repository, which adds four plugins, a gateway and a landing page around it.
 * Those used to be three different icon styles in one window — the harness's
 * filled 16-grid outlines, a 24-grid Lucide set at stroke 2 in the panel, and a
 * 16-grid set at stroke 1.4 everywhere else — and the seam was visible in the
 * places they met.
 *
 * So there is one set now, and it comes from the harness wherever the harness
 * has a drawing. What this checks is the three ways that can quietly stop being
 * true:
 *
 * - The mirrored half going stale. `packages/dsh-icons/mirrored.js` is
 *   generated from a pinned harness release; a `DSH_VERSION` bump that does not
 *   come back through `mirror.mjs` leaves this repository drawing an older
 *   version's glyphs beside the new one's.
 * - The copies drifting. Two plugin client halves are loaded raw by the shell's
 *   module loader and cannot import a sibling package, so they carry the path
 *   data inline. Nothing but this makes those bytes stay equal to the original.
 * - A surface going back to drawing its own. The gateway's pages and the
 *   landing page have a helper that hands them markup; a hand-written stroked
 *   `<svg>` beside it is how the second style got in last time.
 *
 * It needs only the tree — no network, no registry, no built image — so it runs
 * in the pre-commit hook with the rest.
 *
 * Run: node scripts/check-icons.mjs
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

const { icons, origin } = await import(`file://${join(root, 'packages/dsh-icons/index.js')}`)
const { MIRRORED_FROM, mirrored } = await import(`file://${join(root, 'packages/dsh-icons/mirrored.js')}`)
const { EXTRACTED_FROM, EXTRACTED_SET, extracted } = await import(`file://${join(root, 'packages/dsh-icons/extracted.js')}`)

const problems = []
/** @param {boolean} ok - whether the claim holds. @param {string} said - what it claims. */
const check = (ok, said) => { if (!ok) problems.push(said) }

// -- the mirrored half is the pinned release's ------------------------------

const pinned = read('Dockerfile').match(/^ARG DSH_VERSION=(\S+)$/m)?.[1]
check(pinned !== undefined, 'the Dockerfile has no `ARG DSH_VERSION=` to pin the icon set to')
check(
  pinned === MIRRORED_FROM,
  `mirrored.js was taken from ${MIRRORED_FROM} but the Dockerfile pins ${pinned}`
  + ' — re-run `npm --prefix packages/dsh-icons run mirror`',
)

// -- no glyph carries ink of its own ----------------------------------------
//
// The same claim the harness makes about its own set in
// `packages/client/ui-primitives/tests/icons.client.spec.tsx`: a glyph takes
// the colour of whatever it sits in, so it works on both grounds without a
// second rule per icon. A hex here is a glyph that will be invisible in one
// theme, and it will look correct to whoever added it.

for (const [name, glyph] of Object.entries(icons)) {
  const data = glyph.paths.join('')
  check(!/#[0-9a-fA-F]{3,8}/.test(data), `icon \`${name}\` carries a hardcoded colour`)
  check(glyph.paths.length > 0, `icon \`${name}\` has no path data`)
  check(/^0 0 \d+ \d+$/.test(glyph.viewBox), `icon \`${name}\` has an odd viewBox: ${glyph.viewBox}`)
}

// -- the inline copies still equal the original -----------------------------
//
// Both of these files are read by the shell's module loader as source, with
// `require` bound to the shell's own table rather than Node's — so neither can
// resolve `dsh-icons`, and neither has a build step that could. The copy is the
// only way, and this is what keeps it honest.

/** @type {Array<{file: string, constant: string, glyphs: string[]}>} */
const COPIES = [
  { file: 'packages/dsh-tenant-account/client.js', constant: 'DRAWN', glyphs: ['signout', 'admin'] },
  { file: 'packages/dsh-sandbox-host/client.js', constant: 'SANDBOX_GLYPH', glyphs: ['sandbox'] },
]

/** Which glyph in `extracted` a copied name means, where the plugin calls it something else. */
const ALIAS = { admin: 'people' }

for (const { file, constant, glyphs } of COPIES) {
  const source = read(file)
  // The declaration, not the name: a reference to it survives the declaration
  // being renamed away, and that was the one mutation an earlier version of
  // this check waved through.
  check(
    new RegExp(`const ${constant} = [\\[{]`).test(source),
    `${file} no longer declares \`${constant}\``,
  )
  for (const name of glyphs) {
    const original = extracted[ALIAS[name] ?? name]
    check(original !== undefined, `${file} copies \`${name}\`, which \`dsh-icons\` does not draw`)
    for (const d of original?.paths ?? []) {
      check(
        source.includes(`'${d}'`),
        `${file} is missing a path of \`${name}\` — re-copy it from packages/dsh-icons/extracted.js`,
      )
    }
  }
}

// -- each half is painted the way it was drawn --------------------------------

// The two halves are constructed differently and have to be painted
// differently: upstream expands its strokes into filled shapes, Lucide ships
// the strokes. A renderer that guessed would fill a stroke, which turns a
// drawing into a blot, and the guess would keep working for whichever half the
// author happened to be looking at.
for (const [name, glyph] of Object.entries(extracted)) {
  check(
    glyph.stroke !== undefined && glyph.stroke.width > 0,
    `\`${name}\` comes from a stroked set and does not say how wide its stroke is`,
  )
}
for (const [name, glyph] of Object.entries(mirrored)) {
  check(
    glyph.stroke === undefined,
    `\`${name}\` is upstream's, which is already a filled outline, and must not be stroked as well`,
  )
}

// The line has to weigh the same in both halves or one of them looks bolder in
// a row of the other. Upstream draws 1.3 on a 16 box; anything within a tenth
// of that reads as the same weight.
const UPSTREAM_WEIGHT = 1.3 / 16
for (const [name, glyph] of Object.entries(extracted)) {
  const edge = Number(glyph.viewBox.split(' ')[2])
  const weight = (glyph.stroke?.width ?? 0) / edge
  check(
    Math.abs(weight - UPSTREAM_WEIGHT) / UPSTREAM_WEIGHT <= 0.1,
    `\`${name}\` draws its line at ${weight.toFixed(4)} of its box, too far from the harness's ${UPSTREAM_WEIGHT.toFixed(4)}`,
  )
}

// Colour belongs to whatever the glyph sits in, in both halves.
for (const [name, glyph] of Object.entries({ ...mirrored, ...extracted })) {
  check(
    !glyph.paths.some((d) => /#[0-9a-f]{3,8}\b/i.test(d)),
    `\`${name}\` carries a colour in its path data`,
  )
}

// -- the surfaces that cannot require the set still use this one -------------

const landing = read('web/landing/index.html')
for (const [, name] of landing.matchAll(/<i data-icon="([\w-]+)"/g)) {
  check(name in icons, `the landing page asks for \`${name}\`, which no glyph carries`)
}
check(
  /<i data-icon="/.test(landing),
  'the landing page names no icons at all — it used to name eight',
)

// A hand-authored `<svg>` coming back, which is what `stroke-width` in one of
// these files means: every icon they show arrives from `dsh-icons` as a runtime
// call, so none of it is written here. It is not about the paint — half the set
// is stroked on purpose — it is about where the drawing lives. The two marks
// the page keeps are GitHub's, which is a logo rather than an icon.
check(
  !/stroke-width/.test(landing),
  'web/landing/index.html has a stroked <svg> again — icons come from `dsh-icons`',
)
for (const page of ['page-chrome.js', 'admin-page.js', 'login-page.js', 'profile-page.js', 'policy-page.js', 'panel.js']) {
  check(
    !/stroke-width/.test(read(`gateway/src/${page}`)),
    `gateway/src/${page} has a stroked <svg> again — icons come from \`dsh-icons\``,
  )
}

// -- and the set is still worth having --------------------------------------

const mirroredCount = Object.keys(icons).filter((name) => origin(name) === 'mirrored').length
const extractedCount = Object.keys(extracted).length
check(mirroredCount > 0, 'nothing is mirrored from the harness any more')

if (problems.length > 0) {
  for (const problem of problems) process.stdout.write(`  ${problem}\n`)
  process.stdout.write(`check-icons: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`)
  process.exit(1)
}
process.stdout.write(
  `check-icons: ${mirroredCount} mirrored from dsh ${MIRRORED_FROM}, ${extractedCount} from ${EXTRACTED_SET} ${EXTRACTED_FROM}, no drift\n`,
)
