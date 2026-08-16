/**
 * CubeSandbox client: the sandbox runtime the Docker simulation stood in for.
 *
 * CubeSandbox serves an E2B-compatible API, so this speaks that: `POST
 * /sandboxes` against a template, `DELETE /sandboxes/{id}` to reclaim. This is
 * the management plane only; addressing anything *into* a sandbox is
 * CubeProxy's, and lives in `envd.js`.
 *
 * The template is generic — one image, no tenant baked in. What makes a sandbox
 * one tenant's is the environment the backend is started with (`SANDBOX_ID` and
 * `SANDBOX_TOKEN`, the identity it presents when it dials, and
 * `GATEWAY_TUNNEL_URL`, where it dials), and that is handed over at start time
 * rather than at creation.
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
 * @returns {Promise<string>} the CubeSandbox sandbox id.
 * @throws {Error} when the API refuses the creation.
 */
export async function createSandbox(metadata, network, volumeMounts) {
  const { status, body } = await request('POST', '/sandboxes', {
    templateID: TEMPLATE,
    metadata,
    network,
    volumeMounts,
    timeout: SANDBOX_TIMEOUT_SECONDS,
  })
  if (status !== 200 && status !== 201) {
    throw new Error(`cubesandbox: create failed (${status}): ${body}`)
  }
  const parsed = JSON.parse(body)
  const id = parsed.sandboxID ?? parsed.sandboxId ?? parsed.id
  if (typeof id !== 'string') {
    throw new Error(`cubesandbox: create returned no sandbox id: ${body}`)
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
    throw new Error(`cubesandbox: remove ${sandboxId} failed (${status}): ${body}`)
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
  if (status !== 200) throw new Error(`cubesandbox: list failed (${status}): ${body}`)
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
