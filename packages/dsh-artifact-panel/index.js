/**
 * The right-hand panel, host half.
 *
 * There is deliberately nothing here, and there is expected to stay nothing.
 * The panel's data plane is envd, addressed by the gateway from *outside* the
 * sandbox through CubeProxy — so the code that reads a tenant's files lives in
 * `gateway/src/`, not in a plugin. A host half here would run inside the
 * sandbox and would have to leave it and come back to reach envd, which is
 * work for no gain. See `docs/artifact-panel.zh.md`.
 *
 * This file exists because a client plugin is a dual-face package: the
 * client-module registry only scans packages the Loader actually mounted, so
 * the browser half is reachable only if something mounts by this name.
 *
 * @module dsh-artifact-panel
 */

export const name = 'artifact-panel'

/** Mount the host half. Everything this package does is in the browser. */
export function apply() {}
