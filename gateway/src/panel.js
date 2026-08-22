/**
 * The right-hand panel's file plane.
 *
 * Reading a workspace and rearranging it: list a directory, describe one path,
 * hand back one file's bytes, and rename, delete or create one entry. They are answered here rather than in the sandbox because the panel's
 * data plane is envd, which the gateway addresses from outside through
 * CubeProxy — a plugin inside the sandbox would have to leave and come back.
 *
 * The security property is one line, and it is not in this file's path
 * handling: `callerOf` resolves who is asking and `sandboxes.ensure` hands
 * back THAT caller's own sandbox, so a request can only ever reach the machine
 * belonging to the tenant who made it. Cross-tenant reads are not defended
 * against here; they are unrepresentable.
 *
 * Inside one tenant's own sandbox there is nothing to defend. The sandbox is
 * the boundary, and within it the tenant is already root — their agent is a
 * root shell they type into. Anything the panel could be tricked into reading,
 * they can read by asking for it.
 *
 * So the workspace is the panel's SCOPE, not a fence: it is what makes this a
 * workspace browser rather than a filesystem browser, and it keeps paths
 * absolute and rooted. An earlier version also resolved every path through
 * `realpath` and re-checked the answer, to stop a symlink out of the
 * workspace. That bought nothing — the same read is a sentence to the agent
 * away — and cost a round trip on every request plus the wrong behaviour when
 * a tenant deliberately links their own directory into their workspace, which
 * should simply open.
 *
 * @module panel
 */

import { listDir, makeDir, move, newestFile, readFile, remove, stat, writeFile } from './envd.js'
import { PathRefused, ROOT, pathFromRawUrl, requireInsideRoot, requireReadable } from './panel-path.js'
import { TICKET_TTL_MS, mintTicket, readPreviewUrl, readTicket } from './panel-ticket.js'
import { STATS_PATH, WATCH_PATH, serveStats, serveWatch } from './stats.js'

/** The prefix the JSON routes answer on. `/files` is the tunnel's, not ours. */
const FS_PREFIX = '/sandbox/fs/'

/**
 * How long a browser may keep a file's bytes.
 *
 * Zero: the agent rewrites these files while the tenant is looking at them,
 * and a preview that shows the previous revision is worse than a slow one.
 */
const RAW_CACHE = 'no-store'

/**
 * Read one JSON request body.
 *
 * Bounded, because this is a public endpoint and an unbounded read is a way to
 * spend the gateway's memory. A body that is not JSON is an empty object: the
 * path checks below refuse whatever is missing, with the message that names
 * what was wrong.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<object>} the parsed body.
 */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new PathRefused(413, 'request too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return {}
  }
}

/**
 * Answer with JSON.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {number} status - the status to send.
 * @param {object} payload - the body.
 */
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/**
 * What a directory entry looks like to the panel.
 *
 * Reshaped rather than passed through: envd's `EntryInfo` carries mode bits,
 * ownership and a metadata map that the panel has no use for, and forwarding
 * them would publish the sandbox's internals to a browser for no reason.
 *
 * `FILE_TYPE_DIRECTORY` is envd's spelling under `connect+json` — the enum
 * serialises as its name, not its number.
 *
 * @param {object} entry - one envd `EntryInfo`.
 * @returns {{name: string, path: string, directory: boolean, size: number, modified: string|undefined, link: boolean}} the entry as the panel sees it.
 */
function entryOf(entry) {
  // Two spellings, because two things produce these. The client normalises
  // envd's `FILE_TYPE_DIRECTORY` to `dir`, and the raw enum is what arrives
  // from anything speaking to envd directly. Reading only the raw one is what
  // made every folder in the tree draw as a file the moment the client
  // changed — a whole-tree regression from one string comparison, and one
  // nothing failed on: entries kept arriving, they were just all the wrong
  // kind.
  const type = entry.type ?? entry.fileType
  return {
    name: entry.name ?? '',
    path: entry.path ?? '',
    directory: type === 'dir' || type === 'FILE_TYPE_DIRECTORY',
    size: Number(entry.size ?? 0),
    modified: entry.modifiedTime ?? entry.modified_time ?? entry.modifiedAt,
    // Shown, not judged. A link is a thing the tree draws differently; where
    // it points is the tenant's business, and following it is what they meant.
    link: (entry.symlinkTarget ?? entry.symlink_target ?? '') !== '',
  }
}

/**
 * Guess a content type from a name.
 *
 * Deliberately short, and deliberately not `application/octet-stream` for the
 * unknown case — `text/plain` is what an unrecognised file in a workspace
 * almost always is, and the response carries `nosniff` and a sandboxing CSP
 * either way, so a wrong guess cannot become a wrong execution.
 *
 * @param {string} path - the file's path.
 * @returns {string} a content type.
 */
function contentTypeOf(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const known = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
    json: 'application/json', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
    xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
    pdf: 'application/pdf', zip: 'application/zip',
  }
  return known[ext] ?? 'text/plain'
}

/**
 * Handle one request, if it is ours.
 *
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {{callerOf: Function, sandboxes: {ensure: Function}}} deps - the gateway's caller resolution and sandbox manager.
 * @returns {Promise<boolean>} true when this module answered.
 */
export async function handlePanel(req, res, deps) {
  const url = new URL(req.url ?? '/', 'http://gateway')
  const path = url.pathname
  const isFs = path.startsWith(FS_PREFIX) || path === STATS_PATH || path === WATCH_PATH
  const rawPath = pathFromRawUrl(path)
  const preview = readPreviewUrl(path)
  if (!isFs && rawPath === undefined && preview === undefined) return false

  // A preview authenticates by its ticket rather than by the session cookie,
  // because the sandboxed frame it is loaded in sends no cookies at all. See
  // `panel-ticket.js`.
  let caller
  if (preview !== undefined) {
    const accountId = readTicket(deps.sessionSecret, preview.ticket, Date.now())
    if (accountId === undefined) {
      json(res, 401, {})
      return true
    }
    const account = await deps.accountById(accountId)
    if (account === undefined) {
      json(res, 401, {})
      return true
    }
    caller = { email: account.email, id: account.id }
  } else {
    caller = await deps.callerOf(req, res)
  }
  if (caller === undefined) {
    // 401 rather than a redirect: every one of these is fetched by script, and
    // a login page arriving where JSON was expected is a confusing failure.
    json(res, 401, {})
    return true
  }

  /**
   * The caller's sandbox, started if it is not running.
   *
   * The runtime's handle, not the gateway's id: this is an address for
   * `envd.js`, and only one of the two is one.
   *
   * @returns {Promise<{handle: string, sandboxId: string}>} where to reach it, and what to call it.
   */
  const resolve = async () => {
    const { handle, sandboxId } = await deps.sandboxes.ensure(caller.email, caller.id)
    return { handle, sandboxId }
  }

  // The two subscriptions are answered BEFORE the sandbox is resolved, and
  // that is deliberate rather than an ordering that happens to work.
  //
  // Every other route here needs a sandbox to say anything at all, so failing
  // to reach one is a 502 and the caller tries again. A subscription is the
  // opposite: it is the thing that reports what the sandbox is doing, and "not
  // up yet" is one of the answers it exists to give. Refusing it with a status
  // does not defer the news, it destroys the channel — `EventSource` treats a
  // non-2xx as fatal and never reconnects. So these open unconditionally and
  // report the trouble down the stream they just opened.
  if (path === STATS_PATH) {
    serveStats(req, res, resolve)
    return true
  }
  if (path === WATCH_PATH) {
    serveWatch(req, res, resolve)
    return true
  }

  let handle
  try {
    ({ handle } = await resolve())
  } catch (error) {
    console.error(`gateway: the panel could not reach ${caller.email}'s sandbox: ${error.message}`)
    json(res, 502, { error: { code: 'sandbox.not_ready' } })
    return true
  }

  try {
    const bytesPath = rawPath ?? preview?.path
    if (bytesPath !== undefined) {
      // Read, so anywhere in the sandbox — see `requireReadable`.
      const resolved = requireReadable(bytesPath)
      const { status, body } = await readFile(handle, resolved)
      if (status >= 400) {
        json(res, status === 404 ? 404 : 502, { error: { code: 'file.unreadable' } })
        return true
      }
      res.writeHead(200, {
        'Content-Type': contentTypeOf(resolved),
        'Content-Length': String(body.length),
        'Cache-Control': RAW_CACHE,
        // Readable from the opaque origin the preview frame runs in.
        //
        // `sandbox` without `allow-same-origin` is what makes a previewed page
        // safe, and it gives that page the origin `null`. An ordinary
        // `<script src>` does not care, which is why this went unnoticed — but
        // a module script, a `fetch`, a font and a CORS-mode image all do, and
        // they were refused with no `Access-Control-Allow-Origin` present. A
        // page that loads its own JavaScript as a module could not run at all.
        //
        // Open, and it grants nothing extra: reaching this URL already
        // requires the ticket in its path, which is signed, names the one
        // account it was minted for, and expires in minutes. No credentials
        // are involved — the frame sends no cookies, which is the whole reason
        // tickets exist — so there is no session here for a reader to borrow.
        ...(preview === undefined ? {} : { 'Access-Control-Allow-Origin': '*' }),
        // The three headers that make it safe to serve a tenant's own HTML
        // from this origin. `sandbox` without `allow-same-origin` forces an
        // opaque origin on the document, so a previewed page cannot read the
        // session it was fetched with. The iframe's own `sandbox` attribute is
        // the first boundary; this one holds even if the page is opened top
        // level.
        'Content-Security-Policy': "sandbox allow-scripts allow-popups allow-downloads allow-modals; object-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      })
      res.end(body)
      return true
    }

    const action = path.slice(FS_PREFIX.length)
    if (action === 'list' && req.method === 'GET') {
      const resolved = requireInsideRoot(url.searchParams.get('path'))
      const entries = await listDir(handle, resolved)
      json(res, 200, { path: resolved, entries: entries.map(entryOf) })
      return true
    }
    if (action === 'stat' && req.method === 'GET') {
      // Read, and the one question a tab asks about a file it is showing.
      const resolved = requireReadable(url.searchParams.get('path'))
      json(res, 200, { path: resolved, entry: entryOf(await stat(handle, resolved)) })
      return true
    }
    // What the panel asks for before it shows an HTML preview.
    if (action === 'ticket' && req.method === 'GET') {
      const now = Date.now()
      json(res, 200, { ticket: mintTicket(deps.sessionSecret, caller.id, now), expiresAt: now + TICKET_TTL_MS })
      return true
    }
    // What the canvas follows: the newest page in the workspace, and when it
    // was written. One call answers both — which file to show, and whether
    // what is on screen is still current.
    if (action === 'newest' && req.method === 'GET') {
      const found = await newestFile(handle, ROOT, '*.html')
      json(res, 200, found === undefined ? {} : { path: found.path, modified: found.modified })
      return true
    }

    // The three that change something. POST rather than GET, and each reads
    // its paths through the same scope check as everything else — a rename
    // has two paths and BOTH have to be inside the workspace, or it becomes a
    // way to write anywhere by naming a destination.
    if (req.method === 'POST' && ['move', 'remove', 'mkdir', 'create'].includes(action)) {
      const body = await readJson(req)
      if (action === 'move') {
        const from = requireInsideRoot(body.from)
        const to = requireInsideRoot(body.to)
        json(res, 200, { entry: entryOf(await move(handle, from, to)) })
        return true
      }
      if (action === 'create') {
        const at = requireInsideRoot(body.path)
        // Refused rather than overwritten. envd's uploader replaces a file
        // without complaint, and "new file" is the one gesture where replacing
        // one is never what was meant.
        let taken = true
        try {
          await stat(handle, at)
        } catch (error) {
          if (error.code !== 'not_found') throw error
          taken = false
        }
        if (taken) throw new PathRefused(409, '这个名字已经被占用了')
        await writeFile(handle, at, Buffer.alloc(0))
        json(res, 200, { path: at })
        return true
      }
      if (action === 'mkdir') {
        const at = requireInsideRoot(body.path)
        json(res, 200, { entry: entryOf(await makeDir(handle, at)) })
        return true
      }
      const at = requireInsideRoot(body.path)
      // The workspace itself is not one of the things in it.
      if (at === ROOT) throw new PathRefused(403, '工作区本身不能删除')
      await remove(handle, at)
      json(res, 200, {})
      return true
    }
    json(res, 404, { error: 'no such route' })
    return true
  } catch (error) {
    if (error instanceof PathRefused) {
      json(res, error.status, { error: error.message })
      return true
    }
    // A path that is not there is the caller's answer, not a fault of ours.
    if (error.code === 'not_found') {
      json(res, 404, { error: 'no such path' })
      return true
    }
    // The message goes to the deployment's log, not to the browser: it names
    // sandbox ids and envd internals.
    console.error(`gateway: the panel failed for ${caller.email}: ${error.message}`)
    json(res, 502, { error: { code: 'sandbox.silent' } })
    return true
  }
}
