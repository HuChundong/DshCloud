/**
 * Re-take the mirrored half of the table from the harness's own package.
 *
 * `mirrored.js` is generated and committed. Generated, because the paths are
 * upstream's drawing and retyping them is how a copy drifts; committed, because
 * `scripts/check-icons.mjs` and the landing build both have to read it without
 * a network, and CI has neither the harness checkout nor a registry it should
 * be reaching for.
 *
 * Only the glyphs the surfaces outside the shell need are taken. Everything
 * rendered inside the shell — all four plugins' browser halves — requires
 * `@deepseek-ai/dsh-client-ui-primitives` from the shell's own module table at
 * runtime and mirrors nothing at all. This file exists for the gateway's
 * server-rendered pages and the landing page, which have no module table to
 * ask: one is Node writing HTML into a string, the other is a static document
 * Vite hashes assets for. Neither can hold a React component.
 *
 * The version is not a parameter. It is read from `DSH_VERSION` in the
 * Dockerfile, which is the one place this deployment says which harness it
 * runs, and it is stamped into the output so the check can fail a version bump
 * that did not come back through here.
 *
 * Run: npm --prefix packages/dsh-icons run mirror
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const here = import.meta.dirname
const root = resolve(here, '../..')

/** The package upstream publishes the icon set in, MIT and public. */
const PACKAGE = '@deepseek-ai/dsh-client-ui-primitives'

/**
 * What the surfaces outside the shell ask for, as our name for upstream's.
 *
 * Deliberately short. A name added here is a path copied into this repository
 * that then has to be kept in step; a plugin that can require the real
 * component should do that instead, and every one of them can.
 */
const WANTED = {
  light: 'IconLightOutline16',
  dark: 'IconDarkOutline16',
  'chevron-down': 'IconChevronDownOutline14',
  'new-chat': 'IconNewChatOutline16',
  'folder-close': 'IconFolderClose16',
  // Both states, because the row it draws has both. The front door's picture of
  // the sidebar shows a workspace with its session listed under it — which is
  // an OPEN workspace — while the only folder here was the closed one, so the
  // picture disagreed with the product it is a picture of.
  'folder-open': 'IconFolderOpen16',
  // Upstream's panel glyph, mirrored here rather than at the call site.
  //
  // It draws a panel against the LEFT edge, because in the shell that is where
  // the panel it opens sits. Ours is against the right, so the button pointed
  // away from the thing it operates.
  //
  // Flipping it where it is drawn instead of where it is shown is what makes
  // it reliable: upstream's `IconProps` is `{size, className}` and nothing
  // else, so a `style` handed to one of those components is dropped without a
  // word — a flip that silently does not happen. Taken as path data, the
  // element around it is ours and there is no prop to be honoured or ignored.
  'panel-right': { name: 'IconPanelLeftOutline16', flipX: true },
  plus: 'IconPlusOutline16',
  send: 'IconSendOutline16',
  copy: 'IconCopyOutline16',
}

/** @returns {string} the harness version this deployment pins. */
const pinnedVersion = () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
  const match = dockerfile.match(/^ARG DSH_VERSION=(\S+)$/m)
  if (match === null) throw new Error('Dockerfile has no `ARG DSH_VERSION=` to read')
  return match[1]
}

/**
 * The published package's `lib/index.js`, fetched into a directory of its own.
 *
 * `npm pack` rather than an install: nothing here needs the dependency tree,
 * and adding the harness to a package.json would put a second pin beside the
 * Dockerfile's for the two to disagree about.
 *
 * @param {string} version - the version to fetch.
 * @returns {string} the module's source.
 */
const fetchLib = (version) => {
  const into = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  execFileSync('npm', ['pack', `${PACKAGE}@${version}`, '--silent', '--pack-destination', into], { stdio: ['ignore', 'ignore', 'inherit'] })
  const tarball = readdirSync(into).find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error(`npm pack produced nothing for ${PACKAGE}@${version}`)
  execFileSync('tar', ['xzf', join(into, tarball), '-C', into])
  return readFileSync(join(into, 'package/lib/index.js'), 'utf8')
}

/**
 * One icon's geometry, read out of the published module.
 *
 * The published build is not minified and each glyph is one arrow function, so
 * this reads the component by name and takes the `viewBox` and every `d` inside
 * it. Anything the harness draws with a mask, a gradient or an id would not
 * survive being reduced to paths — so rather than emit something subtly wrong,
 * this refuses and says which glyph to require from the shell instead.
 *
 * @param {string} source - the module's source.
 * @param {string} name - the exported component's name.
 * @returns {{component: string, viewBox: string, paths: string[]}} the glyph.
 */
const readGlyph = (source, name) => {
  const start = source.indexOf(`${name} = ({`)
  if (start < 0) throw new Error(`${PACKAGE} no longer exports ${name}`)
  const next = source.slice(start).search(/\n(?:const |var |let |function )/)
  const body = source.slice(start, next < 0 ? undefined : start + next)
  const viewBox = body.match(/viewBox: "([^"]+)"/)?.[1]
  if (viewBox === undefined) throw new Error(`${name} has no viewBox`)
  if (/mask|clipPath|linearGradient|\bid:/.test(body)) {
    throw new Error(`${name} is drawn with a mask or an id; require it from the shell rather than mirroring it`)
  }
  const paths = [...body.matchAll(/\bd: "([^"]+)"/g)].map((m) => m[1])
  if (paths.length === 0) throw new Error(`${name} has no path data`)
  if (/fill: "(?!currentColor|none)/.test(body)) throw new Error(`${name} carries a fill this cannot mirror`)
  return { component: name, viewBox, paths }
}

const version = pinnedVersion()
const source = fetchLib(version)
/**
 * The transform that mirrors a glyph inside its own box.
 *
 * Recorded rather than applied to the coordinates: rewriting path data means
 * parsing every command, and an arc's flags do not survive a naive negation.
 * A transform is exact, and every consumer here already writes the element it
 * sits on.
 *
 * @param {string} viewBox - the glyph's box.
 * @returns {string} the transform.
 */
const mirrorAcross = (viewBox) => {
  const [minX, , width] = viewBox.split(/\s+/).map(Number)
  return `translate(${minX * 2 + width} 0) scale(-1 1)`
}

const glyphs = Object.fromEntries(Object.entries(WANTED).map(([key, wanted]) => {
  const { name, flipX } = typeof wanted === 'string' ? { name: wanted, flipX: false } : wanted
  const glyph = readGlyph(source, name)
  return [key, flipX === true ? { ...glyph, transform: mirrorAcross(glyph.viewBox) } : glyph]
}))

const body = Object.entries(glyphs).map(([key, glyph]) => `  /** Upstream's \`${glyph.component}\`. */
  ${JSON.stringify(key)}: {
    viewBox: ${JSON.stringify(glyph.viewBox)},
    paths: [
${glyph.paths.map((d) => `      ${JSON.stringify(d)},`).join('\n')}
    ],${glyph.transform === undefined ? '' : `\n    transform: ${JSON.stringify(glyph.transform)},`}
  },`).join('\n')

writeFileSync(join(here, 'mirrored.js'), `/**
 * GENERATED by \`mirror.mjs\` — do not edit.
 *
 * The glyphs this repository's non-React surfaces borrow from the harness's own
 * icon set, taken from ${PACKAGE}
 * at the version below. That package is MIT, published by the same project the
 * harness comes from; these are its drawings, not ours.
 *
 * Re-take them with: npm --prefix packages/dsh-icons run mirror
 */

/** The harness release these were taken from; must equal \`DSH_VERSION\`. */
export const MIRRORED_FROM = ${JSON.stringify(version)}

/** @type {Record<string, {viewBox: string, paths: string[]}>} */
export const mirrored = {
${body}
}
`)
process.stdout.write(`mirrored ${Object.keys(glyphs).length} glyphs from ${PACKAGE}@${version}\n`)
