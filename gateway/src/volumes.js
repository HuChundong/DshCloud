/**
 * CubeSandbox volumes: what a tenant keeps, and the ceiling on all of it.
 *
 * This replaces the host mounts the deployment used first. Those were plain
 * directories on the sandbox host, which gave every tenant their files back but
 * gave none of them a limit: one `dd` filled the host disk and took the whole
 * deployment — CubeSandbox included — down with it. Access was isolated;
 * capacity was not.
 *
 * A volume is CubeSandbox's own object, created through its API and attached by
 * a driver at sandbox creation. The driver here is `juicefs`, implemented in
 * `volume-plugin/`: one JuiceFS filesystem holds every tenant's
 * directory, with its metadata in Postgres and its blocks in an S3-compatible
 * store. Two ceilings follow, both JuiceFS's to enforce rather than anything
 * here: the capacity the filesystem was formatted with, and a per-directory
 * quota for each volume.
 *
 * Volumes are named by account id, not by address, so an address deleted and
 * registered again gets an empty one rather than the previous holder's files.
 */

import process from 'node:process'

/** The driver CubeMaster routes create/destroy/attach/detach to. */
const DRIVER = process.env.SANDBOX_VOLUME_DRIVER ?? 'juicefs'

/**
 * Where a tenant's volume is mounted inside their sandbox.
 *
 * Everything of theirs lives under it — the workspace and the harness's state
 * are both subdirectories, and both are reached by their real names. Nothing
 * is linked or bound out of here: the paths the sandbox uses ARE these paths,
 * because which path the workspace has was always ours to choose.
 */
const MOUNT_PATH = process.env.SANDBOX_VOLUME_MOUNT ?? '/mnt'

/**
 * Whether this deployment gives tenants a volume.
 * @returns {boolean} whether volumes are in use.
 */
export function volumesEnabled() {
  return (process.env.SANDBOX_VOLUMES ?? 'on') !== 'off'
}

/**
 * The volume id for one account.
 *
 * Derived rather than stored: CubeSandbox accepts a caller-chosen id, so the
 * account id is the volume id and no table has to be kept in step with theirs.
 *
 * @param {string} accountId - the tenant's stable account id.
 * @returns {string} the volume id.
 */
function volumeIdFor(accountId) {
  return `dsh-${accountId}`
}

/**
 * Ensure the tenant's volume exists, and describe how to mount it.
 *
 * Creating one that already exists is not an error worth surfacing: the volume
 * outlives every sandbox that used it, so the second call is the ordinary case
 * rather than the exception.
 *
 * @param {(method: string, path: string, body?: object) => Promise<{status: number, body: string}>} request - the CubeSandbox API caller.
 * @param {string} accountId - the tenant's stable account id.
 * @returns {Promise<Array<{name: string, path: string}>>} the mounts to pass at sandbox creation, or none when volumes are off.
 * @throws {Error} when the volume cannot be created.
 */
export async function volumeMountsFor(request, accountId) {
  if (!volumesEnabled()) return []
  const volumeId = volumeIdFor(accountId)

  const { status, body } = await request('POST', '/volumes', {
    volumeID: volumeId,
    name: volumeId,
    driver: DRIVER,
  })
  // 409 is "it is already there", which is what a returning tenant looks like.
  if (status !== 200 && status !== 201 && status !== 409) {
    throw new Error(`cubesandbox: creating volume ${volumeId} failed (${status}): ${body}`)
  }

  return [{ name: volumeId, path: MOUNT_PATH }]
}

/**
 * Destroy a tenant's volume and everything in it.
 *
 * Called when an account is erased, which is the only moment this is right: a
 * reclaimed sandbox must leave the volume alone, since keeping it is the whole
 * point of having one.
 *
 * @param {(method: string, path: string, body?: object) => Promise<{status: number, body: string}>} request - the CubeSandbox API caller.
 * @param {string} accountId - the tenant's stable account id.
 * @returns {Promise<void>} resolves once the volume is gone or was never there.
 * @throws {Error} when the API refuses for any reason other than absence.
 */
export async function destroyVolume(request, accountId) {
  const volumeId = volumeIdFor(accountId)
  const { status, body } = await request('DELETE', `/volumes/${encodeURIComponent(volumeId)}`)
  if (status !== 200 && status !== 204 && status !== 404) {
    throw new Error(`cubesandbox: destroying volume ${volumeId} failed (${status}): ${body}`)
  }
}
