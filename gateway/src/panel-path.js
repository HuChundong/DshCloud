/**
 * What the right-hand panel is allowed to name.
 *
 * This decides the panel's SCOPE, and it is worth being exact about what that
 * is and is not. It is not what keeps one tenant out of another's files —
 * `panel.js` asks `sandboxes.ensure` for the caller's own sandbox and there is
 * no way to name someone else's. It is not a defence against the tenant
 * either: inside their own sandbox they are root, and their agent is a shell
 * they type into. It is what makes this a workspace browser instead of a
 * filesystem browser, and what keeps every path absolute and rooted so the
 * routes never have to guess.
 *
 * Kept free of I/O and separate from the routes so every case can be produced
 * without a deployment; `scripts/check-panel-paths.mjs` runs them.
 *
 * Two rules, both of which have a specific failure behind them.
 *
 * Absolute only, and never assembled from a relative one. `ENV HOME` in the
 * Dockerfile is a container environment variable, not root's home in
 * `/etc/passwd`, and envd resolves a relative path against passwd — so
 * `notes.md` does not mean a file in the workspace, it means `/root/notes.md`.
 * Guessing a base would therefore land somewhere the caller never named. The
 * client resolves against the session's cwd before it asks.
 *
 * Inside the root after normalisation, checked segment-wise rather than by
 * `startsWith`. A raw prefix test admits `/mnt/workspace-of-someone-else`,
 * which is the oldest bug in this shape of code — and here it would simply be
 * wrong, since that is a different directory than the one being scoped to.
 *
 * Symlinks are deliberately NOT chased. A path spelled inside the workspace
 * that resolves elsewhere in the sandbox is followed, because a tenant who
 * links their own directory into their own workspace means for it to open. An
 * earlier version resolved every path and re-checked the answer; it bought no
 * safety — the tenant's agent reads anything they ask it to — and cost a round
 * trip on every request.
 *
 * @module panel-path
 */

import path from 'node:path/posix'

/**
 * The directory the panel is a browser of.
 *
 * A real directory on the tenant's mount, and the same path whether or not
 * they have a volume. It used to be `/workspace`, a symlink into the volume —
 * which meant the workspace had two names, and the one the panel used was the
 * one `find` refuses to follow.
 */
export const ROOT = '/mnt/workspace'

/** What a refusal carries: a status the route can answer with, and a reason. */
export class PathRefused extends Error {
  /**
   * @param {number} status - the HTTP status this refusal deserves.
   * @param {string} message - what was wrong, in terms the caller can act on.
   */
  constructor(status, message) {
    super(message)
    this.name = 'PathRefused'
    this.status = status
  }
}

/**
 * Whether `target` is `base` or lies under it.
 *
 * Segment-wise: equal, or prefixed by `base` and a separator. `startsWith` on
 * its own would accept `/mnt/workspace-evil` for a base of `/mnt/workspace`,
 * and that is a real escape rather than a theoretical one — the mount has
 * sibling directories a tenant can create.
 *
 * Both sides are expected to be already normalised, which is what
 * `requireInsideRoot` does before calling this.
 *
 * @param {string} base - the directory that bounds.
 * @param {string} target - the path being judged.
 * @returns {boolean} true when target cannot escape base.
 */
export function isWithin(base, target) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  return target === b || target.startsWith(`${b}/`)
}

/**
 * Normalise a caller-supplied path, or refuse it.
 *
 * Refuses anything that is not already absolute rather than resolving it
 * against a base — see the module comment for why a base would be the wrong
 * one. A NUL byte is refused outright: it truncates the path in every C API it
 * eventually reaches, so `/mnt/workspace/ok\0/../../etc/shadow` would be
 * judged as one path and read as another.
 *
 * @param {unknown} value - what the caller sent.
 * @returns {string} the normalised absolute path.
 * @throws {PathRefused} when it is not a usable absolute path.
 */
export function requireAbsolute(value) {
  if (typeof value !== 'string' || value === '') {
    throw new PathRefused(400, 'a path is required')
  }
  if (value.includes('\0')) {
    throw new PathRefused(400, 'a path may not contain a null byte')
  }
  if (!value.startsWith('/')) {
    throw new PathRefused(400, `"${value}" is not an absolute path`)
  }
  // `normalize` collapses `.`, `..` and repeated separators. It is a string
  // operation and knows nothing about links, which is deliberate — see the
  // module comment.
  const resolved = path.normalize(value)
  return resolved.length > 1 && resolved.endsWith('/') ? resolved.slice(0, -1) : resolved
}

/**
 * The one gate every path the panel handles passes through.
 *
 * @param {unknown} value - what the caller sent.
 * @returns {string} the normalised path, guaranteed inside {@link ROOT}.
 * @throws {PathRefused} when it is unusable or points outside.
 */
/**
 * A path this may READ, which is anywhere in the sandbox.
 *
 * Reading is not scoped to the workspace and refusing to would protect
 * nothing. The sandbox is the security boundary and the tenant is root inside
 * their own: anything this declines to show, they can `cat` in the terminal on
 * the next row of the same screen. What the scope was doing was making the
 * agent's own output unreachable — a script it wrote to `/tmp` came back from
 * the panel as a path the deployment would not open, and then as
 * `spawn xdg-open ENOENT`, which is the host's answer to being asked to open a
 * file on a desktop nobody is sitting at.
 *
 * Writing stays inside the workspace, and that is not the same question. The
 * tree is a workspace browser; a rename or a delete offered outside the one
 * directory it shows is a destructive action against a path nobody navigated
 * to.
 *
 * Everything `requireAbsolute` refuses is still refused: a relative path, a
 * null byte, and `..` collapsed before anyone looks at the result.
 *
 * @param {string|unknown} value - the path a caller offered.
 * @returns {string} the normalised absolute path.
 * @throws {PathRefused} when it is not a path at all.
 */
export function requireReadable(value) {
  return requireAbsolute(value)
}

export function requireInsideRoot(value) {
  const resolved = requireAbsolute(value)
  if (!isWithin(ROOT, resolved)) {
    // The path is not echoed back. A caller that asked for `/etc/shadow` learns
    // only that it was refused, which is all it is entitled to know.
    throw new PathRefused(403, `a path outside ${ROOT} cannot be read`)
  }
  return resolved
}

/** The route prefix the raw-bytes reader answers on. */
export const RAW_PREFIX = '/sandbox/raw/'

/**
 * Build the URL that serves one file's bytes.
 *
 * Path-encoded rather than a query parameter, and that is load-bearing for the
 * HTML preview: a previewed page resolves `./style.css` against its own URL,
 * and the URL algorithm drops the query of a path-relative reference. With the
 * file's path in the query, every relative asset in a previewed page would
 * arrive here naming nothing.
 *
 * @param {string} absolute - an absolute path inside the root.
 * @returns {string} the route URL.
 */
export function rawUrl(absolute) {
  const segments = absolute.split('/').filter((segment) => segment !== '')
  return RAW_PREFIX + segments.map((segment) => encodeURIComponent(segment)).join('/')
}

/**
 * Read back the path from a raw-route URL.
 *
 * The caller still passes the result through {@link requireInsideRoot}: this
 * decodes, it does not judge. A `..` written as `%2e%2e` decodes to something
 * that normalises out of the root, and it is refused there.
 *
 * @param {string} pathname - the request's pathname.
 * @returns {string|undefined} the decoded absolute path, or undefined when the URL is not one of ours.
 */
export function pathFromRawUrl(pathname) {
  if (!pathname.startsWith(RAW_PREFIX)) return undefined
  const rest = pathname.slice(RAW_PREFIX.length)
  if (rest === '') return undefined
  let segments
  try {
    segments = rest.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    // Malformed percent-encoding. Undefined rather than a throw: to the route
    // this is indistinguishable from a URL that was never ours.
    return undefined
  }
  if (segments.some((segment) => segment === '')) return undefined
  return `/${segments.join('/')}`
}
