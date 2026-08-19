/**
 * What the acceptance run uses to see into CubeSandbox sandboxes.
 *
 * Under the Docker simulation the acceptance run inspects sandboxes with the
 * Docker CLI, because they are containers on the host it runs from. A
 * CubeSandbox sandbox is a machine on Cube's own network: listing it is a
 * management-plane call and looking inside it is an envd call, and both need
 * credentials and a route that only the gateway container has. So this runs
 * there, and `verify.sh` calls it the way it calls `docker`.
 *
 * Verification-only. The gateway never executes anything inside a sandbox — the
 * sandbox dials out and that is the whole of their conversation — so this is
 * deliberately a separate entry rather than a method on the runtime seam.
 *
 * Copied into the gateway container and run as:
 *   node /app/verify-cube.mjs owners
 *   node /app/verify-cube.mjs ids
 *   node /app/verify-cube.mjs ids-of <owner>
 *   node /app/verify-cube.mjs exec <sandboxId> <shell command>
 *   node /app/verify-cube.mjs remove-all
 */

import process from 'node:process'
import { listSandboxes, removeSandbox } from './gateway/src/cubesandbox.js'
import { OWNER_KEY } from './gateway/src/runtimes.js'
import { runCommand } from './gateway/src/envd.js'

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'owners': {
    for (const sandbox of await listSandboxes(OWNER_KEY)) process.stdout.write(`${sandbox.owner}\n`)
    break
  }
  case 'ids': {
    for (const sandbox of await listSandboxes(OWNER_KEY)) process.stdout.write(`${sandbox.sandboxId}\n`)
    break
  }
  case 'ids-of': {
    const [owner] = args
    for (const sandbox of await listSandboxes(OWNER_KEY)) {
      if (sandbox.owner === owner) process.stdout.write(`${sandbox.sandboxId}\n`)
    }
    break
  }
  case 'exec': {
    // CubeSandbox's own id, which is the runtime handle envd is addressed by —
    // never the gateway's `sandboxId` for the same machine. The two are
    // unrelated here, and confusing them reaches nothing; `ids` above prints
    // this one because it comes from the Cube API.
    const [handle, ...rest] = args
    const { exitCode, stdout, stderr } = await runCommand(handle, rest.join(' '), {})
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    process.exit(exitCode)
    break
  }
  case 'remove-all': {
    for (const sandbox of await listSandboxes(OWNER_KEY)) await removeSandbox(sandbox.sandboxId)
    break
  }
  default:
    process.stderr.write(`verify-cube: unknown command ${JSON.stringify(command)}\n`)
    process.exit(2)
}
