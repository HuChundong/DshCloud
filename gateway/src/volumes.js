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

import { createVolume, destroyVolume as removeVolume } from './platform-cube.js'

/** The driver CubeMaster routes create/destroy/attach/detach to. */
const DRIVER = process.env.SANDBOX_VOLUME_DRIVER ?? 'juicefs'

/**
 * Where a tenant's volume is mounted inside their sandbox.
 *
 * Everything of theirs lives under it — the workspace and the harness's state
 * are both subdirectories, and both are reached by their real names. Nothing
 * is linked or bound out of here: the paths the sandbox uses ARE these paths,
 * because which path the workspace has was always ours to choose.
 *
 * `||` rather than `??`, because compose passes an unset variable through as
 * an empty string and `??` would keep it — mounting the volume at "" while the
 * image writes to /mnt. The same value is spelled again in `compose.cube.yml`,
 * and the two disagreeing is silent data loss rather than an error.
 */
const MOUNT_PATH = process.env.SANDBOX_VOLUME_MOUNT || '/mnt'

/**
 * Whether this deployment gives tenants a volume.
 *
 * Two conditions, and the runtime is the one that was missing. A volume is
 * created by asking the platform for one, and only the `cube` runtime asks —
 * the docker runtime is a simulation with no such API. So a deployment running
 * on docker has no volumes no matter what the switch says, and answering `true`
 * there meant deleting an account tried to destroy something that was never
 * created, failed, and reported the deletion as stuck.
 *
 * @returns {boolean} whether volumes are in use.
 */
export function volumesEnabled() {
  if (process.env.SANDBOX_RUNTIME !== 'cube') return false
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
  return `hamsterhq-${accountId}`
}

/**
 * Ensure the tenant's volume exists, and describe how to mount it.
 *
 * Creating one that already exists is not an error worth surfacing: the volume
 * outlives every sandbox that used it, so the second call is the ordinary case
 * rather than the exception.
 *
 * A map of mount path to volume, which is the shape both SDKs take. It used to
 * be a list of `{name, path}` — the platform's own shape, hand-built here
 * because this file hand-built the request too. The client converts now.
 *
 * @param {string} accountId - the tenant's stable account id.
 * @returns {Promise<Record<string, string>>} the mounts to pass at sandbox creation, or none when volumes are off.
 * @throws {Error} when the volume cannot be created.
 */
export async function volumeMountsFor(accountId) {
  if (!volumesEnabled()) return {}
  const volumeId = volumeIdFor(accountId)
  await createVolume(volumeId, DRIVER)
  return { [MOUNT_PATH]: volumeId }
}

/**
 * Destroy a tenant's volume and everything in it.
 *
 * Called when an account is erased, which is the only moment this is right: a
 * reclaimed sandbox must leave the volume alone, since keeping it is the whole
 * point of having one.
 *
 * @param {string} accountId - the tenant's stable account id.
 * @returns {Promise<void>} resolves once the volume is gone or was never there.
 * @throws {Error} when the platform refuses for any reason other than absence.
 */
export async function destroyVolume(accountId) {
  await removeVolume(volumeIdFor(accountId))
}
