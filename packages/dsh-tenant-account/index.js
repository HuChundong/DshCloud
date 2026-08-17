/**
 * The tenant's account, host half.
 *
 * Everything here follows from this being a multi-tenant deployment rather than
 * one person's harness: dsh has no notion of the gateway's sessions, no notion
 * of who administers the deployment, and no reason to carry either. Take the
 * gateway away and none of it means anything — which is the line between this
 * package and `dsh-sandbox-host`, whose surfaces survive that removal.
 *
 * The work is entirely in the browser half. This side exists because a client
 * plugin is a dual-face package, and the registry only scans packages the
 * Loader actually mounted.
 *
 * @module dsh-tenant-account
 */

export const name = 'tenant-account'

/** Mount the host half. The sections it advertises live in the browser. */
export function apply() {}
