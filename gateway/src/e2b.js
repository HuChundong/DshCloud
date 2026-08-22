/**
 * The sandbox management API, which is E2B's.
 *
 * Not "the CubeSandbox client", which is what this file used to be called and
 * was never quite true: the endpoints are `POST /sandboxes`, `DELETE
 * /sandboxes/{id}`, `GET /sandboxes`, the credential rides in `X-API-Key`, and
 * the fallback key is spelled `e2b_000000`. This has always spoken the
 * standard; only its name said otherwise. Pointing it at another vendor of
 * that API is two environment variables.
 *
 * ## Why the official client is not used here
 *
 * It is used for everything reaching INTO a sandbox — see `envd.js`, where it
 * replaced a protocol implemented by experiment. It is not used for creation,
 * and the reason is narrow and worth stating so nobody assumes it was an
 * oversight.
 *
 * Creation carries two fields the platform under this deployment shapes
 * differently from the standard:
 *
 * - `network` — the egress rules that inject the model credential on the way
 *   out. The standard keys rules by host (`{"api.example.com": [{transform:
 *   {headers}}]}`); this platform takes an ordered list matched first-wins
 *   (`[{match, action: {allow, audit, inject}}]`) which can also match on
 *   method and path and can deny. Offering the standard shape is refused with
 *   a 422, measured rather than assumed — `check-e2b-conformance.mjs`.
 * - `volumeMounts` — a list of `{name, path}` where the standard takes a map.
 *
 * The client builds its own request body and has no way to carry either. So
 * creation stays here, in the one place where this deployment's platform is
 * visibly not the standard, and `kill`/`list` stay beside it rather than
 * splitting the management plane across two clients for the sake of two calls
 * of plain REST.
 *
 * When the platform accepts the standard shapes, the conformance check says
 * so and this file can go.
 *
 * Addressing anything INTO a sandbox is the proxy's, and lives in `envd.js`.
 */

import process from 'node:process'

/** Where the CubeSandbox API answers. */
const API_URL = process.env.CUBE_API_URL ?? 'http://127.0.0.1:3000'

/**
 * Credential for that API. A local CubeSandbox deployment accepts any value;
 * the header is still required, so an unset variable would fail every call.
 */
const API_KEY = process.env.CUBE_API_KEY ?? 'e2b_000000'

/** The template sandboxes are created from — its alias or its generated id. */
export const TEMPLATE = process.env.CUBE_TEMPLATE_ID ?? 'dsh-sandbox'

/**
 * How long CubeSandbox keeps a sandbox alive without being told otherwise.
 * The gateway reclaims idle sandboxes itself; this is the backstop for a
 * gateway that dies without cleaning up, so it is deliberately longer.
 */
const SANDBOX_TIMEOUT_SECONDS = Number(process.env.CUBE_SANDBOX_TIMEOUT_SECONDS ?? 24 * 60 * 60)

/**
 * Issue one CubeSandbox API request.
 * @param {string} method - HTTP method.
 * @param {string} path - API path.
 * @param {object} [body] - JSON body, when the endpoint takes one.
 * @returns {Promise<{status: number, body: string}>} the response status and raw body.
 */
export async function request(method, path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'X-API-Key': API_KEY,
      ...body === undefined ? {} : { 'Content-Type': 'application/json' },
    },
    ...body === undefined ? {} : { body: JSON.stringify(body) },
  })
  return { status: response.status, body: await response.text() }
}

/**
 * Create and start one sandbox.
 *
 * No environment is passed here. Per-sandbox environment reaches a process
 * through envd, and the backend is started through envd for reasons the
 * template cannot work around — see `envd.js`.
 *
 * @param {Record<string, string>} metadata - labels kept on the sandbox, so an operator can tell whose it is.
 * @param {{allowOut: string[], rules: object[]}} network - what this sandbox may reach and what is rewritten on the way out; see `egress.js`.
 * @param {Array<{name: string, path: string}>} volumeMounts - volumes to attach and where; see `volumes.js`.
 * @param {string} [template] - the template to build from, when this tenant is entitled to one other than the deployment's; see `entitlements.js`.
 * @returns {Promise<string>} the CubeSandbox sandbox id.
 * @throws {Error} when the API refuses the creation.
 */
export async function createSandbox(metadata, network, volumeMounts, template) {
  const { status, body } = await request('POST', '/sandboxes', {
    // The deployment's own unless the caller named another. A template carries
    // its machine's size, so this is where a tier would get a bigger one —
    // which is why it is an argument rather than a constant, even while every
    // tier resolves to the same name.
    templateID: template ?? TEMPLATE,
    metadata,
    network,
    volumeMounts,
    timeout: SANDBOX_TIMEOUT_SECONDS,
  })
  if (status !== 200 && status !== 201) {
    throw new Error(`e2b: create failed (${status}): ${body}`)
  }
  const parsed = JSON.parse(body)
  const id = parsed.sandboxID ?? parsed.sandboxId ?? parsed.id
  if (typeof id !== 'string') {
    throw new Error(`e2b: create returned no sandbox id: ${body}`)
  }
  return id
}

/**
 * Destroy one sandbox.
 * @param {string} sandboxId - the CubeSandbox sandbox id.
 * @returns {Promise<void>} resolves once the sandbox is gone or already absent.
 * @throws {Error} when the API refuses for any reason other than absence.
 */
export async function removeSandbox(sandboxId) {
  const { status, body } = await request('DELETE', `/sandboxes/${encodeURIComponent(sandboxId)}`)
  if (status !== 200 && status !== 204 && status !== 404) {
    throw new Error(`e2b: remove ${sandboxId} failed (${status}): ${body}`)
  }
}

/**
 * List sandboxes this deployment owns.
 *
 * Used at startup to reclaim sandboxes a previous gateway process left behind:
 * their dial-in tokens died with that process, so they can never reconnect.
 *
 * The owning tenant comes back with each id because the acceptance run counts
 * sandboxes per tenant, and asking the API twice for one listing would let the
 * two answers disagree.
 *
 * @param {string} owner - the metadata marker this deployment stamps on its sandboxes.
 * @returns {Promise<Array<{sandboxId: string, owner: string}>>} the matching sandboxes and whose they are.
 */
export async function listSandboxes(owner) {
  const { status, body } = await request('GET', '/sandboxes')
  if (status !== 200) throw new Error(`e2b: list failed (${status}): ${body}`)
  const parsed = JSON.parse(body)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((sandbox) => sandbox?.metadata?.[owner] !== undefined)
    .map((sandbox) => ({
      sandboxId: sandbox.sandboxID ?? sandbox.sandboxId ?? sandbox.id,
      owner: sandbox.metadata[owner],
    }))
    .filter((sandbox) => typeof sandbox.sandboxId === 'string')
}
