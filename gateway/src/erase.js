/**
 * Taking an account away, and everything that belongs to it.
 *
 * One sequence, in one place, because there are two callers and they must not
 * differ: an administrator deleting a tenant, and a tenant deleting themselves.
 * A self-service deletion that forgot the volume, or an administrative one that
 * forgot to revoke the tokens, would leave the account gone and its data behind
 * — which is exactly the claim the data notice makes and the one thing about it
 * that would be a lie.
 *
 * The order is the point. Tokens first, so a session that is open right now
 * stops being one before its owner's machine is pulled out from under it. Then
 * the sandbox, then the volume it was mounted on — the volume outlives every
 * sandbox that used it, so deleting the account is the only moment it is right
 * to take. The row goes last, because everything above is keyed by the address
 * and a failure halfway should leave something to retry rather than an orphan
 * nothing names.
 *
 * Failures along the way are logged and stepped over rather than thrown. A
 * runtime that cannot destroy a container must not be able to keep an account
 * alive: the person asked to be forgotten, and the remaining machine is an
 * operator's problem, not theirs.
 *
 * @module erase
 */

import { volumesEnabled } from './volumes.js'

/**
 * What erasing an account needs.
 * @typedef {object} EraseDeps
 * @property {import('./accounts.js').Accounts} accounts - the row itself.
 * @property {import('./tokens.js').Tokens} tokens - the sessions to revoke.
 * @property {import('./sandboxes.js').SandboxManager} sandboxes - the machine to release.
 * @property {(accountId: string) => Promise<void>} destroyVolume - what takes the durable state with it.
 */

/**
 * Erase one account: its sessions, its sandbox, its volume, and its row.
 *
 * @param {EraseDeps} deps - the stores this reaches into.
 * @param {import('./accounts.js').Account} account - the account being erased, read before this is called.
 * @returns {Promise<void>} resolves once the address is unregistered.
 */
export async function eraseAccount(deps, account) {
  const { email, id } = account

  await deps.tokens.revokeAll(email)
  await deps.sandboxes.release(email).catch((error) => {
    console.error(`gateway: releasing ${email} failed: ${error.message}`)
  })
  if (volumesEnabled()) {
    await deps.destroyVolume(id).catch((error) => {
      console.error(`gateway: destroying ${email}'s volume failed: ${error.message}`)
    })
  }
  await deps.accounts.erase(email)
}
