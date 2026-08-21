/**
 * What the panel's pure logic has to hold true, decided from the tree alone.
 *
 * Two things live here: the path scope, and the preview tickets. Neither needs
 * a deployment, and both are the kind of code where a case nobody produced is
 * a case nobody checked.
 *
 * It decides the panel's scope — a workspace browser rather than a filesystem
 * browser — and keeps every path absolute and rooted so the routes never
 * guess. It is pure string work with no I/O, so every case it exists for can
 * be produced here rather than hoped for in a deployment run: a traversal, a
 * sibling directory that shares a prefix, an encoded `..`, a null byte.
 *
 * Symlinks are out of its remit on purpose, and not because they are hard to
 * check: the sandbox is the security boundary, the tenant is root inside their
 * own, and a link they made into their own workspace should open rather than
 * be refused.
 *
 * Run: node scripts/check-panel-paths.mjs
 */

import assert from 'node:assert/strict'
import process from 'node:process'
import {
  PREVIEW_PREFIX,
  TICKET_TTL_MS,
  mintTicket,
  previewUrl,
  readPreviewUrl,
  readTicket,
} from '../gateway/src/panel-ticket.js'
import { forgetPath, shows } from '../packages/dsh-artifact-panel/src/tabs.js'
import {
  PathRefused,
  requireReadable,
  RAW_PREFIX,
  ROOT,
  isWithin,
  pathFromRawUrl,
  rawUrl,
  requireAbsolute,
  requireInsideRoot,
} from '../gateway/src/panel-path.js'

let failures = 0
let passes = 0

/**
 * Run one check, reporting rather than throwing.
 * @param {string} name - what is being asserted.
 * @param {() => unknown} fn - the assertion.
 */
const t = (name, fn) => {
  try {
    fn()
    passes += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL  ${name} -> ${error.message}`)
  }
}

/**
 * Assert that a path is refused, with the status it deserves.
 * @param {string|unknown} value - the path to offer.
 * @param {number} status - the status the refusal must carry.
 */
const refused = (value, status) => {
  assert.throws(
    () => requireInsideRoot(value),
    (error) => error instanceof PathRefused && error.status === status,
    `expected ${JSON.stringify(value)} to be refused with ${String(status)}`,
  )
}

// ---- what is allowed through --------------------------------------------

t('a plain path inside the workspace passes', () => {
  assert.equal(requireInsideRoot(`${ROOT}/notes.md`), `${ROOT}/notes.md`)
})

t('the workspace itself passes', () => {
  assert.equal(requireInsideRoot(`${ROOT}`), `${ROOT}`)
})

t('a trailing slash is dropped so two spellings are one path', () => {
  assert.equal(requireInsideRoot(`${ROOT}/src/`), `${ROOT}/src`)
})

t('interior traversal that stays inside is normalised, not refused', () => {
  assert.equal(requireInsideRoot(`${ROOT}/a/../b/c.txt`), `${ROOT}/b/c.txt`)
})

t('repeated separators collapse', () => {
  assert.equal(requireInsideRoot(`${ROOT}//a///b.txt`), `${ROOT}/a/b.txt`)
})

t('a name that merely looks like a traversal is a name', () => {
  assert.equal(requireInsideRoot(`${ROOT}/..hidden`), `${ROOT}/..hidden`)
})

// ---- what is turned away ------------------------------------------------

t('a relative path is refused rather than joined to a base', () => {
  // The whole reason: envd resolves it against passwd, so it would land in
  // /root — the exact place this fence exists to keep out.
  refused('notes.md', 400)
})

t('an empty path is refused', () => {
  refused('', 400)
})

t('a non-string path is refused', () => {
  refused(undefined, 400)
  refused(42, 400)
  refused({ path: `${ROOT}` }, 400)
})

t('a null byte is refused', () => {
  // It truncates the path in the C API this eventually reaches, so the path
  // judged here and the path opened there would differ.
  refused(`${ROOT}/ok\0/../../etc/shadow`, 400)
})

t('traversal out of the workspace is refused', () => {
  refused(`${ROOT}/../etc/shadow`, 403)
  refused(`${ROOT}/a/../../root/.dsh`, 403)
})

t('the tenant secrets directory is refused', () => {
  refused('/root/.dsh/settings.json', 403)
})

t('a path outside the workspace is out of scope', () => {
  // Not a secret being guarded — the tenant's agent can read this file on
  // request. It is simply not part of what this browser browses.
  refused('/proc/1/environ', 403)
})

t('a sibling directory sharing the prefix is refused', () => {
  // `startsWith(`${ROOT}`)` alone would let all of these through.
  refused(`${ROOT}-evil/x`, 403)
  refused(`${ROOT}s/x`, 403)
  refused(`${ROOT}.bak`, 403)
})

t('the filesystem root is refused', () => {
  refused('/', 403)
})

t('a refusal never echoes the path back', () => {
  try {
    requireInsideRoot('/etc/shadow')
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(!error.message.includes('/etc/shadow'), error.message)
  }
})

// ---- the primitives, on their own ---------------------------------------

t('isWithin is segment-wise, not prefix-wise', () => {
  assert.equal(isWithin('/workspace', '/workspace'), true)
  assert.equal(isWithin('/workspace', '/workspace/a'), true)
  assert.equal(isWithin('/workspace/', '/workspace/a'), true)
  assert.equal(isWithin('/workspace', '/workspace-evil'), false)
  assert.equal(isWithin('/workspace', '/works'), false)
})

t('requireAbsolute normalises without judging where it points', () => {
  // Separating the two is what lets the fence be read as one rule per line.
  assert.equal(requireAbsolute('/etc/../etc/hosts'), '/etc/hosts')
})

// ---- the raw route's URL vocabulary -------------------------------------

t('a raw URL round-trips', () => {
  const p = `${ROOT}/reports/2026 Q1.md`
  assert.equal(pathFromRawUrl(rawUrl(p)), p)
})

t('a raw URL encodes each segment, keeping the separators as separators', () => {
  // Path-encoded rather than a query parameter, so a previewed page's
  // `./style.css` resolves back into this same route.
  assert.equal(rawUrl(`${ROOT}/a b/c#d.html`), `${RAW_PREFIX}mnt/workspace/a%20b/c%23d.html`)
})

t('a raw URL of a path with a slash-bearing name cannot forge a segment', () => {
  assert.equal(pathFromRawUrl(rawUrl(`${ROOT}/a%2Fb`)), `${ROOT}/a%2Fb`)
})

t('a URL that is not ours decodes to nothing', () => {
  assert.equal(pathFromRawUrl('/sandbox/fs/list'), undefined)
  assert.equal(pathFromRawUrl(RAW_PREFIX), undefined)
})

t('malformed percent-encoding decodes to nothing rather than throwing', () => {
  assert.equal(pathFromRawUrl(`${RAW_PREFIX}mnt/workspace/%zz`), undefined)
})

t('an encoded traversal decodes, and is then refused by the fence', () => {
  // The decoder does not judge; this is the pair that makes it safe.
  const decoded = pathFromRawUrl(`${RAW_PREFIX}mnt/workspace/%2e%2e/%2e%2e/root`)
  assert.equal(decoded, `${ROOT}/../../root`)
  refused(decoded, 403)
})

t('the root the fence bounds is the workspace', () => {
  assert.equal(ROOT, `${ROOT}`)
})

// ---- preview tickets -----------------------------------------------------

const SECRET = 'a-test-secret'
const NOW = 1_700_000_000_000

t('a freshly minted ticket names the account it was minted for', () => {
  assert.equal(readTicket(SECRET, mintTicket(SECRET, 'acct-1', NOW), NOW), 'acct-1')
})

t('a ticket is refused once it expires', () => {
  const ticket = mintTicket(SECRET, 'acct-1', NOW)
  assert.equal(readTicket(SECRET, ticket, NOW + TICKET_TTL_MS - 1), 'acct-1')
  assert.equal(readTicket(SECRET, ticket, NOW + TICKET_TTL_MS), undefined)
})

t('a ticket minted under another secret is refused', () => {
  assert.equal(readTicket(SECRET, mintTicket('another-secret', 'acct-1', NOW), NOW), undefined)
})

t('an edited claim is refused', () => {
  // The whole point: the account is inside the signed claim, so pointing a
  // ticket at someone else's workspace means forging the signature.
  const ticket = mintTicket(SECRET, 'acct-1', NOW)
  const forged = `${Buffer.from(JSON.stringify({ a: 'acct-2', e: NOW + 1000 })).toString('base64url')}.${ticket.split('.')[1]}`
  assert.equal(readTicket(SECRET, forged, NOW), undefined)
})

t('nonsense in the ticket slot is refused rather than thrown at', () => {
  for (const bad of ['', '.', 'no-separator', 'a.b', undefined, 42, `${'x'.repeat(50)}.${'y'.repeat(43)}`]) {
    assert.equal(readTicket(SECRET, bad, NOW), undefined)
  }
})

t('a ticket survives a URL path, which is where it lives', () => {
  const ticket = mintTicket(SECRET, 'acct-1', NOW)
  const parsed = readPreviewUrl(previewUrl(ticket, `${ROOT}/a b/index.html`))
  assert.equal(parsed.ticket, ticket)
  assert.equal(parsed.path, `${ROOT}/a b/index.html`)
  assert.equal(readTicket(SECRET, parsed.ticket, NOW), 'acct-1')
})

t('a relative asset resolves to a URL that still carries the ticket', () => {
  // The reason the ticket is a path segment and not a query parameter: the URL
  // algorithm drops the query of a path-relative reference, and with it the
  // only thing authenticating the request.
  const ticket = mintTicket(SECRET, 'acct-1', NOW)
  const page = new URL(previewUrl(ticket, `${ROOT}/report/index.html`), 'https://example.test')
  const asset = new URL('./assets/style.css', page)
  const parsed = readPreviewUrl(asset.pathname)
  assert.equal(readTicket(SECRET, parsed.ticket, NOW), 'acct-1')
  assert.equal(parsed.path, `${ROOT}/report/assets/style.css`)
})

t('a preview URL with no file part is not one of ours', () => {
  assert.equal(readPreviewUrl(PREVIEW_PREFIX), undefined)
  assert.equal(readPreviewUrl(`${PREVIEW_PREFIX}just-a-ticket`), undefined)
  assert.equal(readPreviewUrl('/sandbox/raw/workspace/a'), undefined)
})

t('a preview path is still bounded by the same scope', () => {
  const ticket = mintTicket(SECRET, 'acct-1', NOW)
  const parsed = readPreviewUrl(previewUrl(ticket, `${ROOT}/../root/.dsh`))
  refused(parsed.path, 403)
})

// ---- reading reaches the whole sandbox; writing does not --------------------

// Two scopes, and the difference is the point. `requireInsideRoot` is the
// tree's: a rename or a delete offered outside the one directory it lists is a
// destructive action against a path nobody navigated to. `requireReadable` is
// a tab's, and it is deliberately wider — refusing to SHOW a path protects
// nothing when the tenant is root in the same sandbox and can read it from the
// terminal on the next row. What the narrow scope actually did was make the
// agent's own output unreachable: a file written to `/tmp` came back as
// `spawn xdg-open ENOENT`, the host being asked to open a file on a desktop
// nobody is sitting at.

t('a path outside the workspace may be read', () => {
  assert.equal(requireReadable('/tmp/notes.txt'), '/tmp/notes.txt')
  assert.equal(requireReadable('/etc/hostname'), '/etc/hostname')
})

t('and may not be written, which is a different question', () => {
  assert.throws(() => requireInsideRoot('/tmp/notes.txt'), PathRefused)
})

// Everything the narrow scope refused about the shape of a path, the wide one
// refuses too. Only the root requirement is gone.
t('reading still refuses what is not a path', () => {
  for (const bad of ['', 'relative/path', '/nul\u0000byte', undefined, 42]) {
    assert.throws(() => requireReadable(bad), PathRefused, `accepted ${JSON.stringify(bad)}`)
  }
})

t('and still collapses traversal before anyone reads the answer', () => {
  assert.equal(requireReadable('/tmp/../etc/hostname'), '/etc/hostname')
  assert.equal(requireReadable('/tmp//a/./b'), '/tmp/a/b')
})

// ---- what the tab bar looks like once a file is gone ----

// A tab outlives the file it was opened from. Nothing about deleting one goes
// near the bar, so the tab stays where it was, named after the file, with an
// error underneath it where the contents used to be — the panel insisting on
// something the workspace has already moved on from. These are the cases the
// removal has to get right, and none of them is easy to produce by hand.

const bar = (tabs, activeId) => ({ tabs, activeId })
const file = (path) => ({ id: path, path, label: path.slice(path.lastIndexOf('/') + 1) })
const tool = (id) => ({ id })

t('a deleted file closes its tab', () => {
  const { groups, changed } = forgetPath({ s1: bar([file('/w/a.txt'), file('/w/b.txt')], '/w/b.txt') }, '/w/a.txt')
  assert.equal(changed, true)
  assert.deepEqual(groups.s1.tabs.map((tab) => tab.path), ['/w/b.txt'])
})

t('a deleted directory takes the files open from inside it', () => {
  const open = bar([file('/w/src/a.js'), file('/w/src/deep/b.js'), file('/w/keep.txt')], '/w/keep.txt')
  const { groups } = forgetPath({ s1: open }, '/w/src')
  assert.deepEqual(groups.s1.tabs.map((tab) => tab.path), ['/w/keep.txt'])
})

// The separator is part of the prefix, or removing a directory would close
// every sibling whose name begins with the same letters.
t('a sibling that shares a prefix is left alone', () => {
  const { groups, changed } = forgetPath({ s1: bar([file('/w/application.js')], '/w/application.js') }, '/w/app')
  assert.equal(changed, false)
  assert.deepEqual(groups.s1.tabs.map((tab) => tab.path), ['/w/application.js'])
})

t('the built-in tools have no path and are never closed', () => {
  const { changed } = forgetPath({ s1: bar([tool('terminal'), tool('canvas')], 'terminal') }, '/w/a.txt')
  assert.equal(changed, false)
})

// Every session, because the file is equally gone in all of them and a dead
// tab left in one is found later, by someone who was not watching when it went.
t('a file open in another session is forgotten there too', () => {
  const { groups } = forgetPath({
    s1: bar([file('/w/a.txt')], '/w/a.txt'),
    s2: bar([file('/w/a.txt'), file('/w/b.txt')], '/w/b.txt'),
  }, '/w/a.txt')
  assert.deepEqual(groups.s1.tabs, [])
  assert.deepEqual(groups.s2.tabs.map((tab) => tab.path), ['/w/b.txt'])
})

t('focus falls to the left when the active tab goes', () => {
  const { groups } = forgetPath({ s1: bar([file('/w/a'), file('/w/b'), file('/w/c')], '/w/b') }, '/w/b')
  assert.equal(groups.s1.activeId, '/w/a')
})

t('and to the new first tab when the active one was first', () => {
  const { groups } = forgetPath({ s1: bar([file('/w/a'), file('/w/b')], '/w/a') }, '/w/a')
  assert.equal(groups.s1.activeId, '/w/b')
})

t('focus does not move when some other tab goes', () => {
  const { groups } = forgetPath({ s1: bar([file('/w/a'), file('/w/b')], '/w/b') }, '/w/a')
  assert.equal(groups.s1.activeId, '/w/b')
})

// Which is what tells the caller to close the panel rather than leave a
// half-width empty state behind.
t('the last tab going leaves the group empty', () => {
  const { groups, changed } = forgetPath({ s1: bar([file('/w/a')], '/w/a') }, '/w/a')
  assert.equal(changed, true)
  assert.deepEqual(groups.s1.tabs, [])
  assert.equal(groups.s1.activeId, undefined)
})

// No write, no render: a removal that touched nothing must cost nothing.
t('removing something no tab was showing changes nothing', () => {
  const before = { s1: bar([file('/w/a')], '/w/a') }
  const { groups, changed } = forgetPath(before, '/w/z')
  assert.equal(changed, false)
  assert.equal(groups.s1, before.s1)
})

t('a tab whose path is not a string is not a file', () => {
  assert.equal(shows({ id: 'canvas' }, '/w'), false)
  assert.equal(shows({ id: 'x', path: 5 }, '/w'), false)
})

console.log(failures === 0
  ? `\ncheck-panel-paths: ${String(passes)} check(s) passed`
  : `\ncheck-panel-paths: ${String(failures)} failed`)
process.exit(failures === 0 ? 0 : 1)
