#!/usr/bin/env bash
# What the built images have to prove before anyone deploys them.
#
# A green build says nothing about resolution, and this project has been bitten
# by that three times: a `file:` dependency whose relative depth the image did
# not reproduce, an `npm install <path>` that symlinked back to the source so
# Node resolved the plugin's dependencies from the wrong place, and a plugin
# loaded by path that mounted its host half and contributed no client half.
# Each built cleanly. Each failed on the first `import`.
#
# So this asks the images the questions a build cannot: does every package
# resolve from where the registry will look for it, and does the plugin whose
# absence would be silent actually load?
#
# Usage: scripts/check-images.sh [sandbox-image] [gateway-image]
set -euo pipefail

SANDBOX="${1:-dsh-sandbox:latest}"
GATEWAY="${2:-dsh-gateway:latest}"
PROFILE=/root/.dsh/profiles/web

fail=0
check() {  # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  \033[32mPASS\033[0m  %-52s %s\n' "$1" "$3"
  else
    printf '  \033[31mFAIL\033[0m  %-52s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

echo "=== the sandbox image ==="

# Resolved from the profile, because that is where the client-module registry
# looks — resolving from /app would pass here and contribute no client half in
# production.
resolved=$(docker run --rm --entrypoint node "$SANDBOX" -e "
  const { createRequire } = require('module')
  const req = createRequire('$PROFILE/package.json')
  const names = ['dsh-gateway-tunnel', 'dsh-sandbox-host', 'dsh-tenant-account', 'dsh-tunnel-protocol']
  let ok = 0
  for (const name of names) {
    try { req.resolve(name); ok += 1 } catch { console.error('unresolved: ' + name) }
  }
  console.log(ok)
" 2>/dev/null || echo 0)
check 'every package resolves from the profile' 4 "$resolved"

# Under the profile itself, not a symlink into the source tree: a link resolves
# here and takes the plugin's own dependencies with it to the wrong place.
inside=$(docker run --rm --entrypoint node "$SANDBOX" -e "
  const { createRequire } = require('module')
  const req = createRequire('$PROFILE/package.json')
  const path = req.resolve('dsh-gateway-tunnel')
  console.log(path.startsWith('$PROFILE/') ? 'under-profile' : path)
" 2>/dev/null || echo error)
check 'the tunnel plugin lives under the profile' under-profile "$inside"

# The import a build never performs.
loaded=$(docker run --rm --entrypoint node "$SANDBOX" -e "
  import('$PROFILE/node_modules/dsh-gateway-tunnel/index.js')
    .then((m) => console.log(['apply', 'inject', 'name'].every((k) => k in m) ? 'loaded' : 'incomplete'))
    .catch((error) => console.log('failed: ' + error.message))
" 2>/dev/null || echo error)
check 'the tunnel plugin loads' loaded "$loaded"

# Both halves of the adaptation plugin, because they fail differently. The host
# half is an ordinary import; the client half is a script the shell runs against
# a module loader that does not exist under node, so it is parsed rather than
# executed — which is exactly the failure a build cannot see, since nothing in
# this repository ever compiles it.
adapter=$(docker run --rm --entrypoint node "$SANDBOX" -e "
  import('$PROFILE/node_modules/dsh-sandbox-host/index.js')
    .then((m) => console.log(['apply', 'inject', 'name'].every((k) => k in m) ? 'loaded' : 'incomplete'))
    .catch((error) => console.log('failed: ' + error.message))
" 2>/dev/null || echo error)
check 'the sandbox-host plugin loads' loaded "$adapter"

for half in dsh-sandbox-host dsh-tenant-account; do
  parsed=$(docker run --rm --entrypoint node "$SANDBOX" -e "
    const { readFileSync } = require('fs')
    try {
      new Function(readFileSync('$PROFILE/node_modules/$half/client.js', 'utf8'))
      console.log('parses')
    } catch (error) { console.log('failed: ' + error.message) }
  " 2>/dev/null || echo error)
  check "the $half client half parses" parses "$parsed"
done

# Named in the Dockerfile rather than reached through the CLI package, so a
# dependency-graph change upstream cannot quietly remove the frontend.
frontend=$(docker run --rm --entrypoint sh "$SANDBOX" -c \
  "test -f /app/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html && echo present || echo missing" 2>/dev/null || echo error)
check 'the published frontend is installed' present "$frontend"

entry=$(docker run --rm --entrypoint sh "$SANDBOX" -c 'test -f "$DSH_BIN" && echo present || echo missing' 2>/dev/null || echo error)
check 'DSH_BIN names a file that exists' present "$entry"

echo
echo "=== the gateway image ==="

exports=$(docker run --rm --entrypoint node "$GATEWAY" -e "
  import('dsh-tunnel-protocol')
    .then((m) => console.log(['chunkBody', 'decodeFrame', 'encodeFrame', 'rewriteRequestHeaders'].every((k) => k in m) ? 'complete' : 'incomplete'))
    .catch((error) => console.log('failed: ' + error.message))
" 2>/dev/null || echo error)
check 'the frame protocol imports' complete "$exports"

# The gateway authenticates every tenant, so it carries no harness code: an
# accidental dependency on dsh would put a tenant's runtime in the one process
# that must not run tenant code.
harness=$(docker run --rm --entrypoint sh "$GATEWAY" -c \
  "test -d /app/node_modules/@deepseek-ai && echo present || echo absent" 2>/dev/null || echo error)
check 'the gateway carries no harness code' absent "$harness"

echo
[ "$fail" -eq 0 ] && echo 'check-images: the images resolve what they will be asked for' \
  || echo 'check-images: something the build could not tell you is wrong'
exit "$fail"
