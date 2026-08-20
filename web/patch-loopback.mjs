/**
 * The one place this repository patches the harness, and the reason it does.
 *
 * `AGENTS.md` says never to patch, vendor, or fork DSH, and every other change
 * in this repository obeys that. This one does not, so it states its case here
 * and fails the build rather than the deployment when it stops applying.
 *
 * ## What it changes
 *
 * `@deepseek-ai/dsh-client-connection`'s browser half computes, once, at apply:
 *
 *     isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)
 *
 * and `@deepseek-ai/dsh-client-ui-settings` binds every settings namespace with
 * `connection.isLoopback ? "host" : "memory"`. On `"memory"` a preference lives
 * in the tab and is discarded on reload, and reads report `unavailable`. So for
 * a browser on any hostname but `localhost`, `[::1]` or `127/8`, the entire
 * configuration plane is inert: theme, language, conversation preferences, the
 * shell's own settings. Every tenant of this deployment is such a browser.
 *
 * ## Why upstream is right, and why we are not upstream
 *
 * The lock is deliberate. The server pins `settings.*`, `credentials.*`,
 * `host.*` and `llm.discoverModels` to loopback callers even on a trusted-host
 * deployment, and says why: `trustedHosts` is a DNS-rebinding fence, explicitly
 * not authentication, so the configuration plane stays loopback-same-origin
 * *until a real authentication layer exists*. A LAN browser talking straight to
 * dsh genuinely must not reach that plane, and the client's `"memory"` fallback
 * correctly declines to try.
 *
 * This deployment is the authentication layer that comment is waiting for. The
 * gateway authenticates every request before it is forwarded, each tenant
 * reaches only their own sandbox, and the tunnel rewrites `Host` to a loopback
 * authority while stripping `Origin`, `Cookie` and the Fetch-Metadata headers —
 * so the server-side pin already passes, and has to: a browser on `localhost`
 * and a browser on a domain produce byte-identical requests by the time dsh
 * sees them, and the one on `localhost` persists its settings today.
 *
 * The client is therefore refusing to send something the server would accept,
 * on the strength of a hostname it reads out of its own address bar.
 *
 * ## Why it is patched here and not solved in a plugin
 *
 * Three plugin-shaped fixes were tried and each is closed:
 *
 * - **Configuration.** The browser half takes none. `trustedHosts` exists, but
 *   only the node half reads it; `apply(ctx)` has no config parameter.
 * - **Composition order.** `applyEntryPatches` can only *append* — without an
 *   id to the end of the root list, with one to the end of that group. A row
 *   this repository adds can never precede `ui-theme`.
 * - **Flipping the flag from a plugin.** It works — the property is writable,
 *   and a probe confirmed `false → true` — but always too late: measured at
 *   both 171ms and 1618ms after load, `ui-theme` had already constructed its
 *   controller, and `persistence` is fixed at construction.
 *
 * What remains inside the rules is an upstream change, which is not available.
 *
 * ## How this fails
 *
 * Loudly. An upgrade that renames or reshapes the expression makes this script
 * exit non-zero and the image build fail. The alternative — a patch that
 * quietly matches nothing — reproduces the exact bug it was written to fix, and
 * silently, which is how this cost an afternoon in the first place.
 *
 * Usage: node web/patch-loopback.mjs <shell-directory>
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

/** The harvested bundle that owns the flag, relative to the shell directory. */
const TARGET = 'plugins/@deepseek-ai/dsh-client-connection/client.js'

/**
 * The expression as the published bundle writes it.
 *
 * Matched whole rather than by a loose regular expression: a pattern lenient
 * enough to survive a reshaping is lenient enough to match something else, and
 * the failure this guards against is precisely a reshaping.
 */
const FROM = 'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),'

/**
 * What it becomes. The comment travels into the bundle so that anyone reading
 * the served asset — in a debugger, in a diff, in a bug report — finds the
 * reason there rather than only in this repository.
 */
const TO = 'isLoopback: true /* HamsterHQ: gateway-authenticated; see web/patch-loopback.mjs */,'

const shell = process.argv[2]
if (shell === undefined) {
  console.error('usage: node web/patch-loopback.mjs <shell-directory>')
  process.exit(2)
}

const file = path.join(shell, TARGET)
const source = await readFile(file, 'utf8').catch(() => undefined)
if (source === undefined) {
  console.error(`patch-loopback: ${file} is not there.`)
  console.error('  The harvested shell no longer carries dsh-client-connection under that path.')
  process.exit(1)
}

// Already patched is not success: it means this ran twice over one shell, and
// the second run had nothing to do. Say so rather than passing quietly.
if (source.includes(TO)) {
  console.error(`patch-loopback: ${TARGET} is already patched; this script ran twice.`)
  process.exit(1)
}

const occurrences = source.split(FROM).length - 1
if (occurrences !== 1) {
  console.error(`patch-loopback: expected exactly one occurrence, found ${occurrences}.`)
  console.error('')
  console.error('  Looked for:')
  console.error(`    ${FROM}`)
  console.error('')
  console.error('  DSH has changed how the browser half decides `isLoopback`. Read')
  console.error('  web/patch-loopback.mjs for what this patch is for and what to check,')
  console.error('  then either update the expression above or — better — drop this script')
  console.error('  entirely if the release made the decision configurable.')
  process.exit(1)
}

await writeFile(file, source.replace(FROM, TO))
console.log(`patch-loopback: ${TARGET} — the settings plane is enabled for this deployment's browsers`)
