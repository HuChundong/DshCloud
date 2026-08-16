/**
 * Minimal Docker Engine API client over the unix socket.
 *
 * Only the four calls the sandbox manager needs are implemented. Keeping this
 * hand-written rather than pulling in a full Docker SDK keeps the surface that
 * has to be replaced when real sandboxes arrive down to one small file.
 */

import http from 'node:http'
import process from 'node:process'

/** Docker Engine socket path inside the gateway container. */
const SOCKET_PATH = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock'

/**
 * Issue one Docker Engine API request.
 * @param {string} method - HTTP method.
 * @param {string} path - API path including any query string.
 * @param {object} [body] - JSON body, when the endpoint takes one.
 * @returns {Promise<{status: number, body: string}>} the response status and raw body.
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({
      socketPath: SOCKET_PATH,
      method,
      path,
      headers: payload === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/**
 * Create a container.
 * @param {string} name - container name.
 * @param {object} spec - the Docker create-container specification.
 * @returns {Promise<string>} the created container id.
 * @throws {Error} when Docker refuses the creation.
 */
export async function createContainer(name, spec) {
  const { status, body } = await request('POST', `/v1.43/containers/create?name=${encodeURIComponent(name)}`, spec)
  if (status !== 201) throw new Error(`docker: create ${name} failed (${status}): ${body}`)
  return JSON.parse(body).Id
}

/**
 * Start a container.
 * @param {string} id - the container id.
 * @returns {Promise<void>} resolves once Docker accepts the start.
 * @throws {Error} when Docker refuses; an already-started container is not an error.
 */
export async function startContainer(id) {
  const { status, body } = await request('POST', `/v1.43/containers/${id}/start`)
  if (status !== 204 && status !== 304) throw new Error(`docker: start ${id} failed (${status}): ${body}`)
}

/**
 * Remove a container and its anonymous volumes, killing it first if running.
 * @param {string} id - the container id.
 * @returns {Promise<void>} resolves once the container is gone or already absent.
 */
export async function removeContainer(id) {
  const { status, body } = await request('DELETE', `/v1.43/containers/${id}?force=true&v=true`)
  if (status !== 204 && status !== 404) throw new Error(`docker: remove ${id} failed (${status}): ${body}`)
}

/**
 * List containers carrying a label.
 * @param {string} label - the label filter, as `key` or `key=value`.
 * @returns {Promise<Array<{Id: string, Labels: Record<string, string>}>>} the matching containers, running or not.
 */
export async function listContainers(label) {
  const filters = encodeURIComponent(JSON.stringify({ label: [label] }))
  const { status, body } = await request('GET', `/v1.43/containers/json?all=true&filters=${filters}`)
  if (status !== 200) throw new Error(`docker: list failed (${status}): ${body}`)
  return JSON.parse(body)
}
