/**
 * What a tenant is called and what they look like.
 *
 * A gateway page rather than a surface in the shell, for the same reason the
 * sign-in page is one: the account it edits is the gateway's, dsh has no notion
 * of it, and the one moment this has to work is before a sandbox exists. It is
 * also the only way to make it unskippable — the shell's gate below sends an
 * account that has never answered here, and nothing in the frontend has to
 * participate or could.
 *
 * The avatar arrives already cropped and already encoded, because the cropping
 * happens in the browser: a canvas is the only image processor in this
 * deployment, the gateway holds no image library and is the one process that
 * must not grow attack surface for tenant-supplied bytes. What arrives here is
 * therefore not trusted to be what it says — it is matched against the shape a
 * `data:` URI is allowed to have, and refused if it is anything else.
 *
 * @module profile
 */

import { hasProfile, normalizeEmail } from './accounts.js'
import { eraseAccount } from './erase.js'
import { profilePage } from './profile-page.js'
import { signedOutCookies } from './tokens.js'
import { isSecureRequest } from './auth.js'

/**
 * The longest name this will store, in code points rather than UTF-16 units so
 * that a name of emoji is counted the way it is read.
 *
 * Short on purpose: it is rendered in a sidebar row that is 208px wide at its
 * widest and 56px at its narrowest, and a name that does not fit is a name
 * shown as an ellipsis.
 */
const MAX_NAME_POINTS = 24

/**
 * The largest avatar this will store, as characters of `data:` URI.
 *
 * The cropper sends a 256×256 WebP, which is a few tens of kilobytes; this is
 * several times that, so it bounds a broken or hostile client rather than a
 * legitimate one. It matters because the row is read whole on every `/whoami`
 * — there is no object store here to keep the bytes out of the account.
 */
const MAX_AVATAR_CHARS = 64 * 1024

/**
 * The only image the avatar column may hold.
 *
 * Three raster types and nothing else. SVG is absent deliberately: it is a
 * document with script in it, and this value is interpolated into an `img` on a
 * page the deployment serves — one that a tenant chooses the contents of.
 * Base64 is matched strictly rather than decoded, so a URI carrying anything
 * but an encoded payload never reaches a reader.
 */
const AVATAR_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]{16,}={0,2}$/

/**
 * Reduce a submitted name to what will be stored, or reject it.
 *
 * Control characters go rather than being escaped: they are never part of a
 * name anyone meant to type, and one of them is what turns a name into two
 * lines in the sidebar.
 *
 * @param {string} raw - the name as submitted.
 * @returns {string | undefined} the name to store, or undefined when it is not usable.
 */
export function cleanName(raw) {
  // By code point rather than by a regular expression, which is how
  // `dsh-sandbox-host` reduces a filename and the only form the linter accepts
  // for this: a character class of control characters is one however it is
  // written, escapes included.
  const cleaned = [...raw]
    .map((ch) => (ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f ? ' ' : ch))
    .join('')
    .trim()
  const points = [...cleaned]
  if (points.length === 0 || points.length > MAX_NAME_POINTS) return undefined
  return cleaned
}

/**
 * What is wrong with a submitted avatar, if anything.
 *
 * Two answers, not one. These used to be a single boolean, and both failures
 * came back as `avatar.format` — so an ordinary photograph that was merely too
 * large was reported as being the wrong KIND of file, which is advice nobody
 * can act on. They are different problems with different remedies: one is
 * "choose a different file", the other is "this one needs to be smaller", and
 * only the sender can tell them apart.
 *
 * @param {string} raw - the `data:` URI as submitted.
 * @returns {string|undefined} the code for what is wrong, or nothing.
 */
export function avatarProblem(raw) {
  if (!AVATAR_PATTERN.test(raw)) return 'avatar.format'
  if (raw.length > MAX_AVATAR_CHARS) return 'avatar.large'
  return undefined
}

/**
 * What the profile page needs from the rest of the gateway.
 * @typedef {object} ProfileDeps
 * @property {import('./accounts.js').Accounts} accounts - who exists.
 * @property {(req: import('node:http').IncomingMessage, res?: import('node:http').ServerResponse) => Promise<{email: string, id: string, admin: boolean} | undefined>} callerOf - the authenticated caller.
 * @property {(req: import('node:http').IncomingMessage, limit: number) => Promise<Buffer | undefined>} readBody - the capped body reader.
 * @property {import('./tokens.js').Tokens} tokens - the sessions a deletion revokes.
 * @property {import('./sandboxes.js').SandboxManager} sandboxes - the machine a deletion releases.
 * @property {(accountId: string) => Promise<void>} destroyVolume - what takes a deleted tenant's durable state with them.
 * @property {string | undefined} version - the release shown in the footer.
 */

/**
 * Serve the profile page and the form it posts.
 *
 * Both halves need a session and neither needs anything else: the address is
 * the caller's own, so there is no target to authorize and no way to name
 * somebody else's account.
 *
 * @param {string} path - the request path, which says whether this is the form or the deletion.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {ProfileDeps} deps - the stores this reads and writes.
 * @returns {Promise<void>} resolves once the response is complete.
 */
export async function handleProfile(path, req, res, deps) {
  const caller = await deps.callerOf(req, res)
  if (caller === undefined) {
    // The page is worthless without knowing whose profile it is, and a 401 here
    // would be a blank tab. Sign-in already returns here afterwards.
    res.writeHead(303, { Location: '/login' })
    res.end()
    return
  }

  const account = await deps.accounts.read(normalizeEmail(caller.email))
  if (account === undefined) {
    // Authenticated against an account that has since been erased. The token is
    // the stale half, so send them to the door rather than showing a form that
    // would write nothing.
    res.writeHead(303, { Location: '/login' })
    res.end()
    return
  }

  /**
   * @param {number} status - the status to answer with.
   * @param {object} state - what the page should show over the stored values.
   */
  const page = (status, state = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(profilePage({
      email: account.email,
      name: account.displayName,
      avatar: account.avatar,
      // Which of the two the page is: an account that has never answered is
      // being asked, and one that has is editing. It changes the wording, the
      // way out, and nothing else.
      first: !hasProfile(account),
      // The page enforces both in the browser so a person is told before they
      // submit; these are the same numbers, passed rather than restated, so the
      // two cannot drift into disagreeing about what is acceptable.
      avatarLimit: MAX_AVATAR_CHARS,
      nameLimit: MAX_NAME_POINTS,
      version: deps.version,
      ...state,
    }))
  }

  if (req.method === 'GET') {
    page(200)
    return
  }

  // Closing the account. Its own path rather than a field on the form above,
  // because it is not an edit: nothing it does can be undone, and a mistyped
  // name should not be able to reach it.
  //
  // Confirmed by typing the address, which is the same confirmation a browser
  // with no JavaScript can give and the same one every service that deletes
  // things irreversibly asks for. The dialog on the page is a courtesy in front
  // of it; this check is what actually stands between a click and the deletion.
  if (path === '/profile/delete') {
    const form = new URLSearchParams((await deps.readBody(req, 4096))?.toString('utf8') ?? '')
    if (normalizeEmail(form.get('confirm') ?? '') !== account.email) {
      page(400, { error: 'delete.confirm' })
      return
    }
    await eraseAccount(deps, account)
    console.log(`gateway: ${account.email} closed their own account`)
    // Signed out on the way out: the tokens are already revoked, and leaving
    // the cookies in the browser would mean the next request is authenticated
    // as an account that no longer exists.
    res.writeHead(303, {
      Location: '/login?done=' + encodeURIComponent('账号已注销，相关数据已删除。'),
      'Set-Cookie': signedOutCookies(isSecureRequest(req)),
    })
    res.end()
    return
  }

  // Whether the caller wants an answer or a page.
  //
  // The same handler serves both, and that is the point: the settings dialog
  // and the sign-up page enforce one set of rules about what a name and an
  // avatar may be, because they ARE one handler. A second endpoint for the
  // dialog would have been a second copy of the size cap, the character
  // limit and the allowed image types, drifting from this one.
  const wantsJson = (req.headers.accept ?? '').includes('application/json')
  /**
   * Answer a caller that asked for JSON.
   * @param {number} status - the status to send.
   * @param {object} payload - the body.
   */
  const answer = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(payload))
  }

  // Comfortably above the avatar cap, which form encoding inflates by about
  // half: `+`, `/` and `=` each become three characters on the wire.
  const body = await deps.readBody(req, 512 * 1024)
  if (body === undefined) {
    if (wantsJson) { answer(413, { error: 'avatar.large' }); return }
    page(413, { error: 'avatar.large' })
    return
  }
  const form = new URLSearchParams(body.toString('utf8'))

  const name = cleanName(form.get('name') ?? '')
  if (name === undefined) {
    const problem = { code: 'name.required', params: { max: MAX_NAME_POINTS } }
    if (wantsJson) { answer(400, { error: problem }); return }
    page(400, { error: problem, name: form.get('name') ?? '' })
    return
  }

  // Three states rather than two, because "leave it alone" and "take it away"
  // are different intentions and an empty field cannot be both. The form says
  // which one it means.
  // Trimmed before it is matched. The field is filled by this deployment's own
  // script and carries no whitespace, but the pattern is anchored at both ends,
  // and a stray newline picked up in transit would otherwise be refused as a
  // format problem the person cannot see and cannot act on.
  const submitted = (form.get('avatar') ?? '').trim()
  let avatar = account.avatar
  if (form.get('avatar_clear') === '1') {
    avatar = undefined
  } else if (submitted !== '') {
    const problem = avatarProblem(submitted)
    if (problem !== undefined) {
      if (wantsJson) { answer(400, { error: problem }); return }
      page(400, { error: problem, name })
      return
    }
    avatar = submitted
  }

  await deps.accounts.setProfile(account.email, name, avatar)
  console.log(`gateway: ${account.email} set their profile`)
  // A dialog is already where it wants to be; only the page needs sending on.
  if (wantsJson) { answer(200, { name, avatar: avatar ?? '' }); return }
  // Straight into the application: this page is on the way in, and for an
  // account being asked for the first time it is the last thing between the
  // sign-in form and the shell.
  res.writeHead(303, { Location: '/' })
  res.end()
}
