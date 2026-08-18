/**
 * The sandbox runtime seam.
 *
 * A runtime creates one isolated machine per tenant, hands it the identity it
 * needs to dial back, and reclaims it. That is the whole contract — the tunnel,
 * the gateway, and dsh's own configuration are unaffected by which one is in
 * use, because the sandbox connects outward rather than being connected to.
 *
 * Two exist. `cube` is CubeSandbox, the real runtime. `docker` is the
 * simulation that came first and remains the path a developer can run on a
 * laptop, where no CubeSandbox is installed.
 */

import process from 'node:process'
import { createContainer, listContainers, removeContainer, startContainer } from './docker.js'
import { TEMPLATE, createSandbox, listSandboxes, removeSandbox, request } from './cubesandbox.js'
import { protectedEgress } from './egress.js'
import { startBackend } from './envd.js'
import { volumeMountsFor } from './volumes.js'

/** Marker naming the owning tenant, carried as a Docker label or CubeSandbox metadata. */
export const OWNER_KEY = 'dsh.gateway.sandbox'

/**
 * One sandbox runtime.
 * @typedef {object} SandboxRuntime
 * @property {string} name - which runtime this is, for diagnostics.
 * @property {(owner: {username: string, accountId: string}, env: Record<string, string>) => Promise<string>} create - start a sandbox and return the handle used to reclaim it.
 * @property {(handle: string) => Promise<void>} remove - reclaim a sandbox, tolerating one that is already gone.
 * @property {() => Promise<string[]>} listOwned - handles of sandboxes this deployment owns, for reclaiming what a previous process left.
 */

/**
 * CubeSandbox: a generic template is instantiated through its E2B-compatible
 * API, and the tenant's backend is then started inside it with the identity
 * that makes it theirs.
 *
 * Two steps rather than one because a template is a snapshot of the image
 * running: anything the image started would be frozen into it before any tenant
 * existed. The network policy is attached at creation, in the same call,
 * because the backend is unreachable-by-policy until it is — and because the
 * model credential it withholds has to be in force before anything runs.
 *
 * @type {SandboxRuntime}
 */
const cube = {
  name: 'cube',
  create: async (owner, env) => {
    const protectedRun = protectedEgress(env)
    const sandboxId = await createSandbox(
      { [OWNER_KEY]: owner.username },
      protectedRun.network,
      await volumeMountsFor(request, owner.accountId),
    )
    try {
      await startBackend(sandboxId, protectedRun.env)
    } catch (error) {
      // A sandbox whose backend never started can only sit there until the
      // idle sweep, holding a machine's worth of memory and never dialling in.
      await removeSandbox(sandboxId).catch(() => {})
      throw error
    }
    return sandboxId
  },
  remove: async (handle) => { await removeSandbox(handle) },
  listOwned: async () => (await listSandboxes(OWNER_KEY)).map((sandbox) => sandbox.sandboxId),
}

/**
 * Docker: the simulation. Bounds are set here because a container shares the
 * host kernel and its memory, where a CubeSandbox is a machine with its own.
 * @type {SandboxRuntime}
 */
const docker = {
  name: 'docker',
  create: async (owner, env) => {
    const handle = await createContainer(`dsh-sandbox-${env.SANDBOX_ID.slice(0, 12)}`, {
      Image: process.env.SANDBOX_IMAGE ?? 'dsh-sandbox:latest',
      Labels: { [OWNER_KEY]: owner.username },
      Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      // The image's own entrypoint, kept rather than overridden. It starts
      // envd in the background and execs the command in the foreground, so
      // passing the backend as the command gets both: the same envd on the
      // same port a CubeSandbox has, and the same backend start this
      // simulation always had.
      //
      // It used to override the entrypoint and run the backend alone, which
      // left the simulation with no envd — and envd is the panel's entire file
      // plane. The choice then was to write a second file plane over
      // `docker exec` and keep two implementations of one thing true, or to
      // give the simulation the envd it was always missing. This is the
      // second. `Entrypoint` is unset, not restated, so the image stays the
      // one definition of how a sandbox starts.
      Cmd: ['/app/sandbox/entrypoint.sh'],
      HostConfig: {
        NetworkMode: process.env.SANDBOX_NETWORK ?? 'dsh-net',
        // A tenant's agent runs arbitrary commands here; these bounds keep one
        // runaway session from starving the host and its neighbours.
        Memory: Number(process.env.SANDBOX_MEMORY_BYTES ?? 2 * 1024 * 1024 * 1024),
        PidsLimit: Number(process.env.SANDBOX_PIDS_LIMIT ?? 512),
        RestartPolicy: { Name: 'no' },
      },
    })
    await startContainer(handle)
    return handle
  },
  remove: async (handle) => { await removeContainer(handle) },
  listOwned: async () => (await listContainers(OWNER_KEY).catch(() => [])).map((container) => container.Id),
}

/**
 * Select the runtime this deployment uses.
 *
 * Named explicitly rather than probed: a deployment that meant to run real
 * sandboxes and silently fell back to containers on the gateway's own host
 * would look identical until someone noticed the isolation was not there.
 *
 * @returns {SandboxRuntime} the selected runtime.
 * @throws {Error} when the name is not one this gateway implements.
 */
export function selectRuntime() {
  const name = process.env.SANDBOX_RUNTIME ?? 'docker'
  if (name === 'cube') {
    console.log(`gateway: sandbox runtime cube, template ${TEMPLATE}`)
    return cube
  }
  if (name === 'docker') {
    console.log('gateway: sandbox runtime docker (simulation)')
    return docker
  }
  throw new Error(`gateway: unknown SANDBOX_RUNTIME ${JSON.stringify(name)}; expected "cube" or "docker"`)
}
