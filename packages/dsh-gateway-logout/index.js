/**
 * Account section, host half.
 *
 * Sign-out belongs to the deployment rather than to dsh: the harness has no
 * notion of the gateway's sessions, so nothing in its own composition offers a
 * way to end one. The work is entirely in the browser half — this side exists
 * because a client plugin is a dual-face package, and the registry only scans
 * packages the Loader actually mounted.
 *
 * @module dsh-gateway-logout
 */

export const name = 'gateway-logout'

/** Mount the host half. The section it advertises lives in the browser. */
export function apply() {}
