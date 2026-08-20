/**
 * The deployment's brand, host half.
 *
 * Empty, like `dsh-tenant-account`'s: a client plugin is a dual-face package
 * and the client-module registry only scans packages the Loader mounted, so
 * this exists to be mounted. Everything it does is in the browser.
 *
 * @module dsh-brand
 */

export const name = 'brand'

/** Mount the host half. The work is in `client.js`. */
export function apply() {}
