/**
 * Starting, stopping and listing sandboxes, through CubeSandbox's own client.
 *
 * ## What "E2B compatible" turned out to mean
 *
 * This file used to hand-build `POST /sandboxes` and was named `e2b.js`, on
 * the belief that CubeSandbox's management API *is* E2B's and that pointing
 * the official E2B client at it was a matter of one environment variable.
 * That belief was wrong in a specific way worth writing down, because it is
 * the kind of thing a README's headline invites.
 *
 * CubeSandbox ships its own SDK — an independent implementation whose only
 * dependency is an HTTP dispatcher. What it offers is E2B's *surface*:
 * `Sandbox.create`, `sandbox.files`, `sandbox.commands`, the same names and
 * nearly the same arguments. Underneath it speaks CubeSandbox's own protocol
 * and converts on the way — `network.rules` given in E2B's host-keyed shape
 * becomes an ordered list of L7 rules, a volume map becomes a mount list.
 *
 * So the compatibility lives in the client, not on the wire. An application
 * holding the official E2B SDK does not get it: it sends E2B's shapes to an
 * API that does not take them. (CubeSandbox reads that as a bug against the
 * "drop-in" claim in its own README, and is fixing it — issue #1482.)
 *
 * ## Which client, then
 *
 * Each platform's own. Both SDKs expose the same surface, so the adapter
 * between them is thin, and each one is maintained by the people whose
 * protocol it speaks — which is the whole argument against the version of
 * this file that came before, where every shape CubeSandbox changed was a
 * shape this deployment had to notice by being broken.
 *
 * @module platform-cube
 */

import process from 'node:process'

import { Sandbox, Volume } from '@cubesandbox/sdk'

/**
 * The template sandboxes are created from — its alias or its generated id.
 *
 * The SDK reads `CUBE_TEMPLATE_ID` itself; this is here because the gateway
 * prints it at boot and a tier will one day choose a different one.
 */
export const TEMPLATE = process.env.CUBE_TEMPLATE_ID ?? 'dsh-sandbox'

/**
 * How long CubeSandbox keeps a sandbox alive without being told otherwise.
 *
 * The gateway reclaims idle sandboxes itself; this is the backstop for a
 * gateway that dies without cleaning up, so it is deliberately longer.
 */
const SANDBOX_TIMEOUT_SECONDS = Number(process.env.CUBE_SANDBOX_TIMEOUT_SECONDS ?? 24 * 60 * 60)

/**
 * Everything the SDK needs to reach this deployment's platform.
 *
 * All of it has an environment variable the SDK reads on its own, and all of
 * it is passed anyway: a client configured by ambient state is a client whose
 * behaviour changes with a variable nobody here named.
 *
 * @returns {object} the connection settings.
 */
function config() {
  return {
    apiUrl: process.env.CUBE_API_URL ?? 'http://127.0.0.1:3000',
    // A local CubeSandbox accepts any value; the header is still required.
    apiKey: process.env.CUBE_API_KEY ?? 'e2b_000000',
  }
}

/**
 * Start one sandbox.
 *
 * @param {Record<string, string>} metadata - what the gateway tags it with, so `listSandboxes` can find it again.
 * @param {object} network - the egress policy, including the rules that inject the model credential.
 * @param {Record<string, string>} volumeMounts - mount path to volume id, which the SDK converts to the platform's list.
 * @param {string} [template] - the template to build from; the deployment's own by default.
 * @returns {Promise<string>} the sandbox's id.
 */
export async function createSandbox(metadata, network, volumeMounts, template) {
  const sandbox = await Sandbox.create({
    ...config(),
    template: template ?? TEMPLATE,
    metadata,
    network,
    volumeMounts,
    timeout: SANDBOX_TIMEOUT_SECONDS,
  })
  return sandbox.sandboxId
}

/**
 * Stop one sandbox, and do not mind if it is already gone.
 *
 * Two calls rather than one: the SDK's kill is a method on a sandbox, so it
 * connects first. That is the cost of not writing the DELETE by hand, and it
 * is worth it — a connect that 404s is exactly the answer this wants anyway.
 *
 * @param {string} sandboxId - which one.
 * @returns {Promise<void>} resolves once it is gone or was already.
 */
export async function removeSandbox(sandboxId) {
  try {
    const sandbox = await Sandbox.connect(sandboxId, { config: config() })
    await sandbox.kill()
  } catch (error) {
    if (gone(error)) return
    throw error
  }
}

/**
 * Every sandbox this deployment started, with who it belongs to.
 *
 * Filtered here rather than by the platform: the list endpoint takes no
 * metadata query, and a deployment sharing a CubeSandbox with something else
 * would otherwise adopt its sandboxes.
 *
 * @param {string} owner - the metadata key the gateway tags an owner under.
 * @returns {Promise<Array<{sandboxId: string, owner: string}>>} the sandboxes.
 */
export async function listSandboxes(owner) {
  const listed = await Sandbox.list(config())
  if (!Array.isArray(listed)) return []
  return listed
    .filter((sandbox) => sandbox?.metadata?.[owner] !== undefined)
    .map((sandbox) => ({
      sandboxId: sandbox.sandboxID ?? sandbox.sandboxId ?? sandbox.id,
      owner: sandbox.metadata[owner],
    }))
    .filter((sandbox) => typeof sandbox.sandboxId === 'string')
}

/**
 * Create one persistent volume, or answer with the one already there.
 *
 * @param {string} name - the volume's name, which is also its id here.
 * @param {string} driver - which storage plugin backs it.
 * @returns {Promise<string>} the volume's id.
 */
export async function createVolume(name, driver) {
  try {
    const volume = await Volume.create({ ...config(), name, driver })
    return volume.volumeId ?? name
  } catch (error) {
    // Already there is the answer this wants: a tenant's volume outlives every
    // sandbox that mounts it, so creating one is asked on every start.
    if (exists(error)) return name
    throw error
  }
}

/**
 * Delete one volume.
 *
 * @param {string} volumeId - which one.
 * @returns {Promise<boolean>} whether it was there to delete.
 */
export async function destroyVolume(volumeId) {
  return await Volume.destroy(volumeId, { config: config() })
}

/**
 * Whether an error means the thing was not there.
 *
 * By the SDK's own name for it where it has one, and by the status otherwise:
 * a client that grew a typed error should not need this file edited, and one
 * that has not yet should still work.
 *
 * @param {Error} error - what was thrown.
 * @returns {boolean} whether to treat it as already gone.
 */
function gone(error) {
  return error?.name === 'SandboxNotFoundError' || error?.status === 404 || /404|not found/i.test(error?.message ?? '')
}

/**
 * Whether an error means the thing is already there.
 *
 * @param {Error} error - what was thrown.
 * @returns {boolean} whether to treat it as created.
 */
function exists(error) {
  return error?.status === 409 || /409|already exists/i.test(error?.message ?? '')
}
