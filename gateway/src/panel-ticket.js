/**
 * Short-lived tickets for the panel's HTML previews.
 *
 * These exist because of one browser rule with no way around it. A preview is
 * shown in an iframe sandboxed WITHOUT `allow-same-origin`, which is what stops
 * a page the agent wrote from reading the session it was fetched with. The
 * price is that the document gets an opaque origin, so every request it makes
 * for its own assets — `./style.css`, `img/x.png` — is treated as cross-site,
 * and `SameSite=Lax` session cookies are not sent with it. The page loads and
 * every relative asset in it comes back 401.
 *
 * So the preview's URLs authenticate themselves. The ticket is one path segment
 * and it sits BEFORE the file's path, which is the whole trick: a page at
 * `/sandbox/preview/<ticket>/mnt/workspace/a/index.html` resolves `./style.css`
 * to the same directory, carrying the ticket along
 * without the page knowing it exists. A query parameter cannot do this — the
 * URL algorithm drops the query of a path-relative reference.
 *
 * What a ticket is worth: read access to the holder's own workspace, for a few
 * minutes. It names the account it was minted for, so it cannot be replayed
 * against anyone else's sandbox, and it is signed with the deployment's session
 * secret so it cannot be forged. It is deliberately NOT a session — it grants
 * no writes, no other route, and expires on its own.
 *
 * @module panel-ticket
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * How long a ticket stays good.
 *
 * Long enough for a page and everything it pulls in — including an image the
 * page only asks for when something is scrolled into view — and short enough
 * that a URL copied out of a devtools panel is stale before it is useful.
 */
export const TICKET_TTL_MS = 5 * 60 * 1000

/** Separates the claim from its signature. Not a character base64url produces. */
const SEPARATOR = '.'

/**
 * Encode without the characters a URL path would have to escape.
 * @param {Buffer|string} value - what to encode.
 * @returns {string} base64url.
 */
function encode(value) {
  return Buffer.from(value).toString('base64url')
}

/**
 * Sign one claim.
 * @param {string} secret - the deployment's session secret.
 * @param {string} claim - the encoded claim.
 * @returns {string} the signature, base64url.
 */
function sign(secret, claim) {
  // Scoped by a fixed label so a signature minted here can never be mistaken
  // for one minted by anything else that shares this secret.
  return createHmac('sha256', secret).update(`artifact-panel-preview:${claim}`).digest('base64url')
}

/**
 * Mint a ticket for one account.
 *
 * @param {string} secret - the deployment's session secret.
 * @param {string} accountId - whose workspace the ticket may read.
 * @param {number} now - the current epoch milliseconds.
 * @returns {string} the ticket, safe to place in a URL path segment.
 */
export function mintTicket(secret, accountId, now) {
  const claim = encode(JSON.stringify({ a: accountId, e: now + TICKET_TTL_MS }))
  return `${claim}${SEPARATOR}${sign(secret, claim)}`
}

/**
 * Check a ticket and say whose it is.
 *
 * Returns undefined for every kind of failure — wrong shape, bad signature,
 * expired — rather than saying which. A caller learns only that it was refused,
 * and the route answers all of them the same way.
 *
 * @param {string} secret - the deployment's session secret.
 * @param {string} ticket - what arrived in the URL.
 * @param {number} now - the current epoch milliseconds.
 * @returns {string|undefined} the account id the ticket was minted for.
 */
export function readTicket(secret, ticket, now) {
  if (typeof ticket !== 'string') return undefined
  const cut = ticket.indexOf(SEPARATOR)
  if (cut <= 0) return undefined
  const claim = ticket.slice(0, cut)
  const signature = ticket.slice(cut + 1)
  const expected = sign(secret, claim)
  // Compared without an early exit, so the time taken says nothing about how
  // much of a forged signature was right.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
  let payload
  try {
    payload = JSON.parse(Buffer.from(claim, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof payload?.a !== 'string' || typeof payload.e !== 'number') return undefined
  if (payload.e <= now) return undefined
  return payload.a
}

/** The route prefix a ticketed read answers on. */
export const PREVIEW_PREFIX = '/sandbox/preview/'

/**
 * Build a ticketed URL for one file.
 * @param {string} ticket - a minted ticket.
 * @param {string} absolute - the file's absolute path.
 * @returns {string} the URL.
 */
export function previewUrl(ticket, absolute) {
  const segments = absolute.split('/').filter((segment) => segment !== '')
  return PREVIEW_PREFIX + encodeURIComponent(ticket) + '/' + segments.map((segment) => encodeURIComponent(segment)).join('/')
}

/**
 * Split a ticketed URL back into its ticket and its path.
 *
 * Decodes only; whether the path is in scope is decided by the same fence
 * every other route uses.
 *
 * @param {string} pathname - the request's pathname.
 * @returns {{ticket: string, path: string}|undefined} the parts, or undefined when the URL is not one of ours.
 */
export function readPreviewUrl(pathname) {
  if (!pathname.startsWith(PREVIEW_PREFIX)) return undefined
  const rest = pathname.slice(PREVIEW_PREFIX.length)
  let segments
  try {
    segments = rest.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    return undefined
  }
  const [ticket, ...path] = segments
  if (ticket === undefined || ticket === '' || path.length === 0) return undefined
  if (path.some((segment) => segment === '')) return undefined
  return { ticket, path: `/${path.join('/')}` }
}
