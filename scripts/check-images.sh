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
# Usage: scripts/check-images.sh [sandbox-image] [gateway-image] [web-image]
set -euo pipefail

SANDBOX="${1:-hamsterhq-sandbox:latest}"
GATEWAY="${2:-hamsterhq-gateway:latest}"
WEB="${3:-hamsterhq-web:latest}"
# The IMAGE's profile directory. At runtime the entrypoint links it into the
# tenant's DSH_HOME on the mount; here we check the copy the image ships.
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

# Resolved through `dsh.client.main` rather than assumed to be `client.js`,
# because one of these is BUILT: the panel bundles xterm and ships
# `lib/client.js`, which is gitignored and produced during the image build. A
# check that opened `client.js` would have read the package's other half, or
# nothing, and passed either way — while the registry served a 404 and the
# panel simply never appeared.
for half in dsh-sandbox-host dsh-tenant-account dsh-artifact-panel; do
  parsed=$(docker run --rm --entrypoint node "$SANDBOX" -e "
    const { readFileSync } = require('fs')
    const path = require('path')
    const base = '$PROFILE/node_modules/$half'
    try {
      const manifest = JSON.parse(readFileSync(base + '/package.json', 'utf8'))
      // Declared when there is something to declare, and client.js by
      // convention otherwise — which is how the registry itself resolves it,
      // and how the two hand-written halves are found.
      // (No backticks: this whole program is inside a double-quoted shell
      // string, where a backtick opens a command substitution.)
      const entry = manifest.dsh?.client?.main ?? 'client.js'
      new Function(readFileSync(path.join(base, entry), 'utf8'))
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

# The workspace has to arrive empty, and this is not a style point: the
# entrypoint replaces the directory with a link onto the tenant's volume, and
# anything the build leaves here either blocks that or follows a tenant into
# their own files. A stray npm cache did both, and the failure was silent for
# weeks — a whole deployment's tenants writing to a layer that dies with the
# sandbox.
stray=$(docker run --rm --entrypoint sh "$SANDBOX" -c 'ls -A /workspace 2>/dev/null | tr "\n" " "' 2>/dev/null || echo docker-error)
check 'the image ships an empty workspace' '' "$stray"

# What the sandbox promises a tenant's agent. A missing tool is not a build
# failure and not a boot failure — it is a tool call that fails halfway through
# somebody's task, which is the worst place to find out.
missing=$(docker run --rm --entrypoint sh "$SANDBOX" -c '
  for tool in git curl jq rg fd tree file patch make less \
              unzip zip 7z zstd bsdtar \
              sqlite3 pdftotext officecli dig ping ip nc \
              python3 pip node npm pnpm yarn; do
    command -v "$tool" >/dev/null 2>&1 || printf "%s " "$tool"
  done
' 2>/dev/null || echo docker-error)
check 'every tool the image promises resolves' '' "$missing"

# The wheels, imported rather than merely present: a wheel whose native
# dependency is absent installs cleanly and raises on import.
MODULES="pandas duckdb sqlalchemy openpyxl xlsxwriter xlrd pyxlsb odf"
MODULES="$MODULES pdfplumber PIL matplotlib lxml bs4 markdownify jinja2"
MODULES="$MODULES magic py7zr rarfile requests"
stack=$(docker run --rm --entrypoint python3 -e "MODULES=$MODULES" "$SANDBOX" \
  -c 'import importlib.util, os; names = os.environ["MODULES"].split(); missing = [n for n in names if importlib.util.find_spec(n) is None]; print(" ".join(missing) if missing else "all")' \
  2>/dev/null || echo docker-error)
check 'the python stack imports' all "$stack"

# pip must install into the virtualenv, not fail against Debian's externally
# managed system Python — the whole reason the venv is there.
pip_home=$(docker run --rm --entrypoint sh "$SANDBOX" -c \
  'python3 -c "import sys; print(\"venv\" if sys.prefix != sys.base_prefix else \"system\")"' 2>/dev/null || echo error)
check 'python runs inside the virtualenv' venv "$pip_home"

# A chart with Chinese labels renders as boxes without a CJK face, and nothing
# about that failure says "font".
cjk=$(docker run --rm --entrypoint sh "$SANDBOX" -c \
  'fc-list :lang=zh 2>/dev/null | grep -c . | head -1' 2>/dev/null || echo 0)
check 'a CJK font is installed' 1 "$([ "${cjk:-0}" -gt 0 ] && echo 1 || echo 0)"

# The one tool here that is a downloaded binary rather than a package: a
# truncated download passes `command -v` and fails on first use.
office=$(docker run --rm --entrypoint officecli "$SANDBOX" --version 2>/dev/null | head -1 | grep -c . || echo 0)
check 'officecli runs' 1 "$office"

# A tool an agent cannot be told about is a tool it will not reach for. The
# skill is written by the binary at build time, so this asks for the two things
# that make it discoverable: the file where dsh's provider looks, and the
# frontmatter its parser requires — a skill missing either is skipped with a
# warning nobody reads.
skill=$(docker run --rm --entrypoint sh "$SANDBOX" -c '
  f="$DSH_BUNDLED_SKILL_DIR/officecli/SKILL.md"
  test -f "$f" || { echo no-file; exit 0; }
  grep -q "^name: officecli$" "$f" && grep -q "^description: " "$f" && echo ok || echo no-frontmatter
' 2>/dev/null || echo error)
check 'the officecli skill is where dsh will look' ok "$skill"

# Both package managers must point somewhere before a tenant reaches for them.
# What they point AT is the deployment's choice — a mirror close to the host, or
# the public default — but an empty registry is a tenant discovering on their
# first install that this image never had one.
registry=$(docker run --rm --entrypoint npm "$SANDBOX" config get registry 2>/dev/null | tr -d '\r')
check 'npm has a registry' 1 "$([ -n "$registry" ] && echo 1 || echo 0)"
printf '        npm  -> %s\n' "${registry:-unset}"

# `pip config list` rather than `pip config get`: get exits non-zero when the
# key is unset, and an `|| echo <default>` around it reports the default as
# though pip had chosen it — which is how the first version of this check
# passed while claiming the mirror was not configured.
index=$(docker run --rm --entrypoint sh "$SANDBOX" -c \
  "pip config list 2>/dev/null | sed -n \"s/^global.index-url='\\(.*\\)'$/\\1/p\"" | tr -d '\r')
[ -n "$index" ] || index=https://pypi.org/simple
check 'pip has an index' 1 "$([ -n "$index" ] && echo 1 || echo 0)"
printf '        pip  -> %s\n' "${index:-unset}"

echo
echo "=== the web image ==="

# The one patch this repository applies to the harness. It fails the build when
# it stops matching, so reaching here means it applied — but the build and the
# image are separable (a cached layer, a hand-tagged image), and a served bundle
# that lost the patch is a deployment where nobody can keep a preference and
# nothing says so. Asserted against the bytes nginx will actually serve.
patched=$(docker run --rm --entrypoint sh "$WEB" -c \
  "grep -c 'isLoopback: true' /usr/share/nginx/html/plugins/@deepseek-ai/dsh-client-connection/client.js" 2>/dev/null || echo error)
check 'the settings plane is enabled for non-loopback browsers' 1 "$patched"

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
