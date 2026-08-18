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
import {
  PathRefused,
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
  assert.equal(requireInsideRoot('/workspace/notes.md'), '/workspace/notes.md')
})

t('the workspace itself passes', () => {
  assert.equal(requireInsideRoot('/workspace'), '/workspace')
})

t('a trailing slash is dropped so two spellings are one path', () => {
  assert.equal(requireInsideRoot('/workspace/src/'), '/workspace/src')
})

t('interior traversal that stays inside is normalised, not refused', () => {
  assert.equal(requireInsideRoot('/workspace/a/../b/c.txt'), '/workspace/b/c.txt')
})

t('repeated separators collapse', () => {
  assert.equal(requireInsideRoot('/workspace//a///b.txt'), '/workspace/a/b.txt')
})

t('a name that merely looks like a traversal is a name', () => {
  assert.equal(requireInsideRoot('/workspace/..hidden'), '/workspace/..hidden')
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
  refused({ path: '/workspace' }, 400)
})

t('a null byte is refused', () => {
  // It truncates the path in the C API this eventually reaches, so the path
  // judged here and the path opened there would differ.
  refused('/workspace/ok\0/../../etc/shadow', 400)
})

t('traversal out of the workspace is refused', () => {
  refused('/workspace/../etc/shadow', 403)
  refused('/workspace/a/../../root/.dsh', 403)
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
  // `startsWith('/workspace')` alone would let all of these through.
  refused('/workspace-evil/x', 403)
  refused('/workspaces/x', 403)
  refused('/workspace.bak', 403)
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
  const p = '/workspace/reports/2026 Q1.md'
  assert.equal(pathFromRawUrl(rawUrl(p)), p)
})

t('a raw URL encodes each segment, keeping the separators as separators', () => {
  // Path-encoded rather than a query parameter, so a previewed page's
  // `./style.css` resolves back into this same route.
  assert.equal(rawUrl('/workspace/a b/c#d.html'), `${RAW_PREFIX}workspace/a%20b/c%23d.html`)
})

t('a raw URL of a path with a slash-bearing name cannot forge a segment', () => {
  assert.equal(pathFromRawUrl(rawUrl('/workspace/a%2Fb')), '/workspace/a%2Fb')
})

t('a URL that is not ours decodes to nothing', () => {
  assert.equal(pathFromRawUrl('/sandbox/fs/list'), undefined)
  assert.equal(pathFromRawUrl(RAW_PREFIX), undefined)
})

t('malformed percent-encoding decodes to nothing rather than throwing', () => {
  assert.equal(pathFromRawUrl(`${RAW_PREFIX}workspace/%zz`), undefined)
})

t('an encoded traversal decodes, and is then refused by the fence', () => {
  // The decoder does not judge; this is the pair that makes it safe.
  const decoded = pathFromRawUrl(`${RAW_PREFIX}workspace/%2e%2e/%2e%2e/root`)
  assert.equal(decoded, '/workspace/../../root')
  refused(decoded, 403)
})

t('the root the fence bounds is the workspace', () => {
  assert.equal(ROOT, '/workspace')
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
  const parsed = readPreviewUrl(previewUrl(ticket, '/workspace/a b/index.html'))
  assert.equal(parsed.ticket, ticket)
  assert.equal(parsed.path, '/workspace/a b/index.html')
  assert.equal(readTicket(SECRET, parsed.ticket, NOW), 'acct-1')
})

t('a relative asset resolves to a URL that still carries the ticket', () => {
  // The reason the ticket is a path segment and not a query parameter: the URL
  // algorithm drops the query of a path-relative reference, and with it the
  // only thing authenticating the request.
  const ticket = mintTicket(SECRET, 'acct-1', NOW)
  const page = new URL(previewUrl(ticket, '/workspace/report/index.html'), 'https://example.test')
  const asset = new URL('./assets/style.css', page)
  const parsed = readPreviewUrl(asset.pathname)
  assert.equal(readTicket(SECRET, parsed.ticket, NOW), 'acct-1')
  assert.equal(parsed.path, '/workspace/report/assets/style.css')
})

t('a preview URL with no file part is not one of ours', () => {
  assert.equal(readPreviewUrl(PREVIEW_PREFIX), undefined)
  assert.equal(readPreviewUrl(`${PREVIEW_PREFIX}just-a-ticket`), undefined)
  assert.equal(readPreviewUrl('/sandbox/raw/workspace/a'), undefined)
})

t('a preview path is still bounded by the same scope', () => {
  const ticket = mintTicket(SECRET, 'acct-1', NOW)
  const parsed = readPreviewUrl(previewUrl(ticket, '/workspace/../root/.dsh'))
  refused(parsed.path, 403)
})

console.log(failures === 0
  ? `\ncheck-panel-paths: ${String(passes)} check(s) passed`
  : `\ncheck-panel-paths: ${String(failures)} failed`)
process.exit(failures === 0 ? 0 : 1)
