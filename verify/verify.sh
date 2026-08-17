#!/usr/bin/env bash
# End-to-end acceptance for the multi-tenant gateway.
#
# Checks the three properties the deployment exists to provide: nothing reaches
# a sandbox unauthenticated, each tenant gets their own, and the loopback-pinned
# configuration methods survive the tunnel's header rewriting.
#
# Runs against either sandbox runtime. Everything about a tenant's sandbox goes
# through the four functions below, because the two runtimes offer nothing in
# common to inspect: under `docker` a sandbox is a container on this host, and
# under `cube` it is a machine on Cube's network that only the gateway container
# has the credentials and the route to reach.
#
# Set `SANDBOX_RUNTIME` to match the deployment, and `COMPOSE_FILE` to the
# overlays it runs with, e.g.
#   SANDBOX_RUNTIME=cube COMPOSE_FILE=compose.yml:compose.cube.yml ./verify.sh
set -uo pipefail

GATEWAY="${GATEWAY:-http://localhost:8080}"
RUNTIME="${SANDBOX_RUNTIME:-docker}"
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  \033[32mPASS\033[0m  %-46s %s\n' "$label" "$actual"
    PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m  %-46s expected %s, got %s\n' "$label" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

api() {  # api <cookiejar> <method> -> status
  curl -s -o /dev/null -w '%{http_code}' -m 120 -b "$1" \
    -X POST "$GATEWAY/api/$2" -H 'Content-Type: application/json' -d '{}'
}

# Addresses the acceptance run registers. Resend's own sink, which accepts and
# discards: it refuses `example.com` outright rather than bouncing it, and a
# real address would collect a code every run. The `+` tags make two tenants out
# of one sink, since the deployment keys accounts on the whole address.
EMAIL_DOMAIN="${VERIFY_EMAIL_DOMAIN:-resend.dev}"
ALICE="${VERIFY_ALICE:-delivered+alice@$EMAIL_DOMAIN}"
BOB="${VERIFY_BOB:-delivered+bob@$EMAIL_DOMAIN}"

# The code is read out of the deployment's own database rather than out of a
# mailbox. That is operator access, not a way in that a user has: the code is a
# secret held for ten minutes, and anyone who can read this database can already
# mint a session.
psql() {  # psql <sql> -> the result, unadorned
  docker compose exec -T postgres psql -U "${POSTGRES_USER:-dsh}" -d "${POSTGRES_DB:-dsh}" -tAc "$1" | tr -d '\r'
}

code_for() {  # code_for <email> -> the pending six-digit code
  psql "SELECT code FROM challenges WHERE email = '$1' AND expires_at > now()"
}

# Minted straight into the table rather than through the console, so signing in
# does not depend on an administrator existing. Unredeemed ones from previous
# runs are cleared first, since every run mints its own.
# Wrapped in a CTE so the statement is a SELECT: `psql` prints an `INSERT 0 1`
# command tag on stdout alongside the returned row, and a caller capturing both
# gets a code with a line of status stuck to it.
mint_invite() {  # mint_invite -> one unused code
  psql "DELETE FROM invites WHERE redeemed_at IS NULL AND created_by = 'verify'" > /dev/null
  psql "WITH minted AS (
          INSERT INTO invites (code, created_by)
          VALUES ('VERIF-' || upper(substr(md5(random()::text), 1, 5)), 'verify')
          RETURNING code
        ) SELECT code FROM minted"
}

login() {  # login <email> <cookiejar> -> status of the final step
  local code invite
  # Minted before the code is asked for, not after. A code only goes out to an
  # address the deployment already knows or a request that carries a usable
  # invite — otherwise the form would be a way to mail anyone. This is the flow
  # a new tenant follows: the invite comes first, and the code follows it.
  #
  # Carried on both steps, and on every sign-in rather than only a first one:
  # only the server knows which this is, and an invite an existing account does
  # not need is simply not spent.
  invite=$(mint_invite)
  curl -s -o /dev/null -c "$2" -X POST "$GATEWAY/login" \
    --data-urlencode "email=$1" --data-urlencode "invite=$invite"
  code=$(code_for "$1")
  curl -s -o /dev/null -w '%{http_code}' -b "$2" -c "$2" \
    -X POST "$GATEWAY/login" --data-urlencode "email=$1" --data-urlencode "code=$code" \
    --data-urlencode "invite=$invite"
}

DSH_LABEL='dsh.gateway.sandbox'

# The cube helper runs in the gateway container: it is the only place with the
# CubeSandbox client, the credentials for both of Cube's planes, and a route to
# them. Copied in here rather than baked into the image, so that the gateway
# carries no verification code — and copied once, because every call below runs
# in its own subshell and could not remember that it had.
if [ "$RUNTIME" = cube ]; then
  docker compose cp verify-cube.mjs gateway:/app/verify-cube.mjs > /dev/null 2>&1 \
    || { echo 'verify: could not install the cube helper in the gateway container' >&2; exit 1; }
fi

cube() {
  docker compose exec -T gateway node /app/verify-cube.mjs "$@"
}

sandbox_owners() {  # -> the owning tenant of each running sandbox, one per line
  case "$RUNTIME" in
    docker) docker ps --filter "label=$DSH_LABEL" --format "{{.Label \"$DSH_LABEL\"}}" ;;
    cube)   cube owners ;;
  esac
}

sandbox_handles() {  # -> a handle per running sandbox, one per line
  case "$RUNTIME" in
    docker) docker ps --filter "label=$DSH_LABEL" -q ;;
    cube)   cube ids ;;
  esac
}

# Scoped to one tenant, because the deployment under test is not necessarily
# empty — an operator signed in to the console has a sandbox too, and taking
# whichever came back first wrote a marker into somebody else's machine.
sandbox_handles_of() {  # sandbox_handles_of <owner> -> that tenant's handles
  case "$RUNTIME" in
    docker) docker ps --filter "label=$DSH_LABEL=$1" -q ;;
    cube)   cube ids-of "$1" ;;
  esac
}

# Fed base64-encoded so that neither `docker exec sh -c` nor envd's `bash -l -c`
# has to survive the script's own quoting. An optional third argument is shell
# prepended to the script, which is how a value known only out here — never a
# secret — reaches it.
sandbox_run_script() {  # sandbox_run_script <handle> <script path> [prelude] -> its stdout
  local encoded
  encoded=$( { printf '%s\n' "${3:-}"; cat "$2"; } | base64 | tr -d '\n')
  case "$RUNTIME" in
    docker) docker exec "$1" sh -c "echo $encoded | base64 -d | sh" ;;
    cube)   cube exec "$1" "echo $encoded | base64 -d | sh" ;;
  esac
}

sandbox_sh() {  # sandbox_sh <handle> <shell command> -> its stdout
  case "$RUNTIME" in
    docker) docker exec "$1" sh -c "$2" ;;
    cube)   cube exec "$1" "$2" ;;
  esac
}

sandbox_remove_all() {
  case "$RUNTIME" in
    # Collected into an array first: the ids have to reach `docker rm` as
    # separate arguments, which an array says without an unquoted expansion.
    # Guarded on the count because `docker rm` with none is an error.
    docker)
      local ids=()
      while IFS= read -r id; do ids+=("$id"); done < <(docker ps -aq --filter "label=$DSH_LABEL")
      [ "${#ids[@]}" -eq 0 ] || docker rm -f "${ids[@]}" > /dev/null 2>&1 || true
      ;;
    cube)   cube remove-all > /dev/null 2>&1 || true ;;
  esac
}

# How a browser is run against this deployment, shared by the two checks that
# need one. `--network host` so `$GATEWAY` means the same thing inside as out;
# `BROWSER_ADD_HOST` resolves the deployment's own name to it, for a front door
# reached by a domain that public DNS points somewhere else.
#
# An array rather than a function, because the image has to sit between the
# flags and the command and a function cannot express that.
#
# The image ships one browser build and refuses any other Playwright, so the
# version is one fact: the tag and the package the container installs are both
# derived from it, and raising it means editing this line alone.
BROWSER_VERSION=1.56.0
BROWSER_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v$BROWSER_VERSION-noble}"
BROWSER_RUN=(docker run --rm --network host)
[ -n "${BROWSER_ADD_HOST:-}" ] && BROWSER_RUN+=(--add-host "$BROWSER_ADD_HOST")
BROWSER_RUN+=(-v "$PWD:/verify" -w /verify -e "GATEWAY=$GATEWAY" -e PLAYWRIGHT_FROM=/verify/package.json)

# Playwright is a devDependency of the web workspace, so a deployment host
# generally does not have it; the container installs it when the mounted
# directory has none.
BROWSER_INSTALL="[ -d node_modules/playwright ] || npm install playwright@$BROWSER_VERSION --no-save --silent > /dev/null 2>&1"

JAR_A=$(mktemp); JAR_B=$(mktemp); JAR_NONE=$(mktemp)
trap 'rm -f "$JAR_A" "$JAR_B" "$JAR_NONE"' EXIT

# Suite failures, counted separately from the HTTP checks and reported together
# at the end.
NODE_FAIL=0

echo
echo '=== 0a. What bounds the mail this can be made to send ==='
echo '     (counters over an hour, driven directly rather than waited out)'
if docker compose cp verify-send-limit.mjs gateway:/app/verify-send-limit.mjs > /dev/null 2>&1; then
  docker compose exec -T gateway node /app/verify-send-limit.mjs || NODE_FAIL=1
else
  echo '  FAIL  could not copy the check into the gateway container'
  NODE_FAIL=1
fi

echo
echo '=== 0b. What a refresh token does when a browser wakes ==='
echo '     (the failure needs simultaneous requests, not elapsed time)'
if docker compose cp verify-refresh.mjs gateway:/app/verify-refresh.mjs > /dev/null 2>&1; then
  docker compose exec -T gateway node /app/verify-refresh.mjs || NODE_FAIL=1
else
  echo '  FAIL  could not copy the check into the gateway container'
  NODE_FAIL=1
fi

echo
echo '=== 0c. The idle sweep ==='
echo '     (a decision about elapsed time, driven directly rather than waited out)'
echo '     (runs in the gateway container, the one place with node and the sources)'
if docker compose cp verify-idle.mjs gateway:/app/verify-idle.mjs > /dev/null 2>&1; then
  docker compose exec -T gateway node /app/verify-idle.mjs || NODE_FAIL=1
else
  echo '  FAIL  could not copy the check into the gateway container'
  NODE_FAIL=1
fi

echo
echo '=== 1. Anonymous requests: private surfaces refused, public assets served ==='
check 'POST /api/host.describe without a session' 401 "$(api "$JAR_NONE" host.describe)"
check 'GET / without a session redirects to login' 303 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/")"
check 'GET /plugins/* without a session redirects' 303 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/plugins/probe/client.js")"
# A browser fetches the manifest with no credentials unless the link tag opts
# in, which this index.html does not. Gating it answered the manifest parser
# with the login page's HTML. Chromium reports that through a channel the
# browser suite's console listener never sees, so it is checked here.
check 'GET /manifest.webmanifest anonymously' 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/manifest.webmanifest")"
check 'the manifest is JSON, not the login page' 'application/manifest+json' \
  "$(curl -s -o /dev/null -w '%{content_type}' "$GATEWAY/manifest.webmanifest")"
MANIFEST_BODY=$(curl -s "$GATEWAY/manifest.webmanifest")
if printf '%s' "$MANIFEST_BODY" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  MANIFEST_JSON=parses
else
  MANIFEST_JSON=$(printf '%s' "$MANIFEST_BODY" | head -c 40)
fi
check 'the manifest body parses as JSON' 'parses' "$MANIFEST_JSON"
# nginx listens on 80 and is published on another port, so absolutising a
# redirect would send people to a URL that does not exist. Relative Location
# headers resolve against whatever origin the browser actually reached.
check 'the login redirect keeps no absolute origin' '/login' \
  "$(curl -s -D - -o /dev/null "$GATEWAY/" | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')"
# nginx is the front door. A static asset must be answered from its disk without
# a Node process in the path; routing it through the gateway measured ~26% more
# latency per request and bought nothing.
check 'static assets never reach the gateway' 0 \
  "$(docker compose logs --since 10s gateway 2>/dev/null | grep -c '/assets/')"
check 'the gateway refuses a frontend path outright' 404 \
  "$(docker compose exec -T gateway node -e 'fetch("http://localhost:8080/index.html").then(r=>console.log(r.status))' | tr -d '\r')"

echo
echo '=== 2. Login ==='
# A code is the whole credential, so a wrong one has to be worth nothing. The
# address is one that has a challenge outstanding, because a guess against an
# address with none is refused for the wrong reason.
curl -s -o /dev/null -X POST "$GATEWAY/login" --data-urlencode "email=$ALICE"
check 'a wrong code is rejected' 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GATEWAY/login" \
     --data-urlencode "email=$ALICE" --data-urlencode 'code=000000')"
check 'an address that is not one is refused' 400 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GATEWAY/login" --data-urlencode 'email=not-an-address')"
# Registration is gated, and the gate is now in front of the mail rather than
# behind it: an unknown address arriving without an invite is issued no code at
# all, so it never reaches the step that would refuse it. That is what stops the
# form being a way to send mail to strangers, and the first step still answers
# identically either way.
if [ "$(psql "SELECT current_setting('server_version_num')" > /dev/null 2>&1; echo "${REGISTRATION:-invite}")" != open ]; then
  NEWCOMER="delivered+newcomer@$EMAIL_DOMAIN"
  psql "DELETE FROM accounts WHERE email = '$NEWCOMER'" > /dev/null
  psql "DELETE FROM challenges WHERE email = '$NEWCOMER'" > /dev/null
  check 'asking without an invite answers as if it had sent' 200 \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GATEWAY/login" --data-urlencode "email=$NEWCOMER")"
  check 'but no code was issued' 0 \
    "$(psql "SELECT count(*) FROM challenges WHERE email = '$NEWCOMER'")"
  check 'and left no account behind' 0 \
    "$(psql "SELECT count(*) FROM accounts WHERE email = '$NEWCOMER'")"
fi
check 'alice registers and signs in' 303 "$(login "$ALICE" "$JAR_A")"
check 'bob registers and signs in'   303 "$(login "$BOB" "$JAR_B")"
check 'the address is now registered' 1 \
  "$(psql "SELECT count(*) FROM accounts WHERE email = '$ALICE'")"
# Signing in again must return the same account, not make another: the id is
# what a tenant's durable state is named by, so a new one on every sign-in would
# hand a returning user an empty workspace.
ALICE_ID=$(psql "SELECT id FROM accounts WHERE email = '$ALICE'")
login "$ALICE" "$JAR_A" > /dev/null
check 'signing in again keeps the same account' "$ALICE_ID" \
  "$(psql "SELECT id FROM accounts WHERE email = '$ALICE'")"

echo
echo '=== 3. Ordinary methods reach the tenant sandbox ==='
echo '     (the first call waits for the container to start and dsh to boot)'
check "alice: host.describe" 200 "$(api "$JAR_A" host.describe)"
check "bob:   host.describe" 200 "$(api "$JAR_B" host.describe)"

echo
echo '=== 4. Loopback-pinned methods survive the tunnel rewriting ==='
for method in settings.describe credentials.describe llm.discoverModels agentPreset.read; do
  check "alice: $method" 200 "$(api "$JAR_A" "$method")"
done

echo
echo '=== 5. One sandbox per tenant ==='
# Counts containers, not distinct owners. Counting owners hid a race where
# concurrent first requests each started a container for the same tenant: the
# owner set still read as expected while every container but the last was
# orphaned, dialling in and holding memory with no record pointing at it.
# Counted per tenant rather than in total. Counting distinct owners hid a race
# where concurrent first requests each started a sandbox for the same tenant:
# the owner set still read as expected while every sandbox but the last was
# orphaned, dialling in and holding memory with no record pointing at it. A
# total, meanwhile, assumes nobody else is using the deployment — which is not
# true of one an operator is signed in to.
OWNERS=$(sandbox_owners)
check 'exactly one sandbox belongs to alice' 1 "$(printf '%s\n' "$OWNERS" | grep -cx "$ALICE")"
check 'exactly one sandbox belongs to bob'   1 "$(printf '%s\n' "$OWNERS" | grep -cx "$BOB")"

echo
echo '=== 6. Inside a sandbox: reachable only by tunnel, running the artifact ==='
# Read from the backend process itself rather than from a shell beside it. Both
# runtimes start that process differently — a container entrypoint against
# envd's clean environment — and asking a shell answered about the wrong one:
# the environment every `ENV` in the image sets was absent from the backend
# under CubeSandbox, and nothing here noticed until a tenant met an approval
# prompt no browser could answer.
FACTS=$(sandbox_run_script "$(sandbox_handles_of "$ALICE" | head -1)" verify-sandbox-facts.sh)
fact() { printf '%s\n' "$FACTS" | sed -n "s/^$1=//p" | head -1; }

# The published package's entry, which is what makes DSH a dependency here
# rather than a checkout: a tenant runs the same `lib/bin.js` the registry
# ships, at the version the image was built with.
check 'dsh runs the installed package' 1 \
  "$(fact cmdline | grep -c 'node_modules/@deepseek-ai/dsh/lib/bin.js')"
# Nothing transpiles at boot. Through tsx the same entry took 9s to serve /api
# against 2s for the artifact, and that delay is also what widened the window
# where the tunnel could dial in before dsh could answer.
check 'nothing runs through tsx' 0 "$(fact tsx)"
# The backend binds loopback, so the tunnel it dials is the only way to it. A
# sandbox that bound every interface would be reachable by anything that could
# route to it, and under CubeSandbox that includes the host.
check 'the backend listens on loopback only' '0100007F:0C08' "$(fact listen)"
check 'the sandbox grants full access' danger-full-access "$(fact DSH_PERMISSION_MODE)"
check 'the sandbox runs as production' production "$(fact NODE_ENV)"
# dsh takes its sandbox policy's workspace root from the working directory, so
# starting it anywhere else would hand the tenant that directory as their
# workspace — with full access inside the sandbox, the harness's own
# installation.
# Either name is right: without a volume the working directory is /workspace,
# and with one that path is a symlink onto the volume, which is what a resolved
# cwd reports. What must never appear here is /app.
check 'the tenant workspace is their own' 1 \
  "$(case "$(fact cwd)" in /workspace|/persist/workspace) echo 1 ;; *) echo 0 ;; esac)"
check 'the gateway runs as production' production \
  "$(docker compose exec -T gateway printenv NODE_ENV | tr -d '\r')"

# The agent inside runs with full access on the tenant's behalf, so anything in
# its environment is something a prompt can be made to read back. Where the
# runtime can withhold the model credential and have CubeEgress supply it on the
# way out, the sandbox must not hold it.
if docker compose exec -T gateway node -e 'import("/app/gateway/src/egress.js").then((m)=>process.exit(m.injectsModelCredential()?0:1))' 2>/dev/null; then
  echo
  echo '=== 6b. The model credential never enters the sandbox ==='
  # The placeholder comes from the gateway rather than being restated here, and
  # the comparison happens inside the sandbox, so neither the real key nor a
  # leaked one is ever printed by a failing run.
  PLACEHOLDER=$(docker compose exec -T gateway \
    node -e 'import("/app/gateway/src/egress.js").then((m)=>console.log(m.MODEL_KEY_PLACEHOLDER))' | tr -d '\r')
  check 'the sandbox holds a placeholder, not the key' placeholder \
    "$(sandbox_run_script "$(sandbox_handles_of "$ALICE" | head -1)" verify-sandbox-secret.sh "EXPECTED='$PLACEHOLDER'")"
fi

echo
echo '=== 7-10. WebSocket downlinks, a real model turn, and tenant isolation ==='
echo '     (run inside the gateway container, the one place with ws installed)'
# The shared sign-in goes in first: the three suites import it, and it is what
# reads their code out of the deployment's own store.
docker compose cp verify-login.mjs gateway:/app/verify-login.mjs > /dev/null 2>&1 || NODE_FAIL=1
for script in verify-ws.mjs verify-turn.mjs verify-isolation.mjs; do
  docker compose cp "$script" "gateway:/app/$script" > /dev/null || { NODE_FAIL=1; continue; }
  docker compose exec -T -e GATEWAY=http://localhost:8080 -e "VERIFY_ALICE=$ALICE" -e "VERIFY_BOB=$BOB" \
    gateway node "/app/$script" || NODE_FAIL=1
done

# A status code cannot tell a working page from a blank one. This drives a real
# Chromium because the two failures that actually reached a person — a broken
# inline script and a missing boot manifest — were invisible to every check
# above, which saw nothing but 200s.
echo
# Playwright is a devDependency of the web workspace, so a developer's checkout
# has it and a deployment host generally does not — this one runs from the
# repository the images were built from, not from an install of it. Falling back
# to Playwright's own image keeps the browser suite part of the acceptance run
# on the host that actually serves the deployment, which is the host where the
# two failures it exists to catch showed up.
# The console's confirmation dialog is the page's own rather than the browser's,
# so nothing enforces that it appears, cancels, or closes except a check that
# drives it.
#
# The address is named by the operator and never inferred. Taking the
# deployment's first administrator would mean this run signs in as whoever that
# is — reading their code straight out of the database and leaving sessions
# behind under their identity. It did exactly that until this was fixed.
#
# `VERIFY_ADMIN` must already be in `GATEWAY_ADMINS`; the check below says so
# rather than letting the browser meet an unexplained 403.
ADMIN="${VERIFY_ADMIN:-}"
if [ -n "$ADMIN" ] \
   && ! docker compose exec -T gateway printenv GATEWAY_ADMINS 2>/dev/null | tr -d '\r' | tr ',' '\n' | grep -qxF "$ADMIN"; then
  echo
  echo "=== 15. The console asks before it deletes ==="
  printf '  \033[31mFAIL\033[0m  VERIFY_ADMIN (%s) is not in GATEWAY_ADMINS\n' "$ADMIN"
  NODE_FAIL=1
  ADMIN=''
elif [ -z "$ADMIN" ]; then
  echo
  echo '=== 15. The console asks before it deletes ==='
  echo '     (skipped: set VERIFY_ADMIN to an address this deployment administers)'
fi
if [ -n "$ADMIN" ]; then
  echo
  echo '=== 15. The console asks before it deletes ==='
  psql "DELETE FROM challenges WHERE email = '$ADMIN'" > /dev/null
  curl -s -o /dev/null -X POST "$GATEWAY/login" --data-urlencode "email=$ADMIN"
  ADMIN_CODE=$(code_for "$ADMIN")
  # A tenant the console can offer to delete. Alice is registered by now and is
  # not an administrator, so her row carries the button this drives.
  "${BROWSER_RUN[@]}" -e "PROBE_EMAIL=$ADMIN" -e "PROBE_CODE=$ADMIN_CODE" "$BROWSER_IMAGE" \
    sh -c "$BROWSER_INSTALL && node verify-dialog.mjs" || NODE_FAIL=1

  echo
  echo '=== 16. An action leaves the address bar alone ==='
  # A session minted here rather than signed in for: this drives the console
  # repeatedly, and asking for a code each time spends real mail.
  ADMIN_COOKIES=$(docker compose exec -T gateway node -e "
    const { connect } = await import('/app/gateway/src/db.js')
    const { Tokens } = await import('/app/gateway/src/tokens.js')
    const { Accounts } = await import('/app/gateway/src/accounts.js')
    const pool = await connect()
    const account = await new Accounts(pool).read('$ADMIN')
    const tokens = new Tokens(process.env.SESSION_SECRET, pool)
    console.log(\`dsh_gw_access=\${await tokens.issueAccess(account)}; dsh_gw_refresh=\${await tokens.issueRefresh(account)}\`)
    await pool.end()
  " 2>/dev/null | tr -d '\r' | tail -1)
  "${BROWSER_RUN[@]}" -e "PROBE_COOKIES=$ADMIN_COOKIES" "$BROWSER_IMAGE" \
    sh -c "$BROWSER_INSTALL && node verify-console-url.mjs" || NODE_FAIL=1
fi

# The browser suite runs where Chromium is, which is not where the database is, so its
# code is read here and handed in. Asking for it now is also what puts the
# address into cooldown, so the suite's own first submit lands on the code step
# without minting a second code.
curl -s -o /dev/null -X POST "$GATEWAY/login" --data-urlencode "email=$ALICE"
BROWSER_CODE=$(code_for "$ALICE")
export BROWSER_CODE BROWSER_EMAIL="$ALICE"

if node -e "require('module').createRequire('$PWD/package.json').resolve('playwright')" 2> /dev/null; then
  echo '     (browser suite runs on the host, where Playwright and Chromium live)'
  node verify-browser.mjs || NODE_FAIL=1
else
  echo "     (no local Playwright; browser suite runs in $BROWSER_IMAGE)"
  # `--network host` so `$GATEWAY` means the same thing inside as out.
  # `BROWSER_ADD_HOST` resolves the deployment's own name to it, for a front
  # door reached by a domain that public DNS points somewhere else — a LAN
  # address behind a router, say.
  "${BROWSER_RUN[@]}" -e "BROWSER_EMAIL=$BROWSER_EMAIL" -e "BROWSER_CODE=$BROWSER_CODE" "$BROWSER_IMAGE" \
    sh -c "$BROWSER_INSTALL && node verify-browser.mjs" || NODE_FAIL=1
fi

echo
echo '=== 13. The interface loads with no sandbox running ==='
echo '     (the point of serving the whole frontend from the web deployment)'
echo '     DESTRUCTIVE: removes every sandbox, ending any session open in a browser.'
sandbox_remove_all
check 'no sandbox is running' 0 "$(sandbox_handles | grep -c .)"
SHELL_HTML=$(curl -s -m 30 -b "$JAR_A" "$GATEWAY/")
check 'GET / still answers' 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 30 -b "$JAR_A" "$GATEWAY/")"
check 'it carries the boot manifest' 1 "$(printf '%s' "$SHELL_HTML" | grep -c '__DSH_BOOT__')"
BUNDLE=$(printf '%s' "$SHELL_HTML" | grep -o '/plugins/[^"?]*client\.js' | head -1)
# The sign-out control is a real client plugin, so it must appear in the graph
# the shell boots from — a path-loaded entry mounts its host half and
# contributes no client half at all, which is silent rather than loud.
check 'the sign-out plugin is in the boot manifest' 1 \
  "$(printf '%s' "$SHELL_HTML" | grep -c 'dsh-gateway-logout')"
check 'a client bundle answers too' 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 30 -b "$JAR_A" "$GATEWAY$BUNDLE")"
# The decisive part: none of the above may have started a sandbox. If the shell
# still came from one, this reads 1 and the decoupling is not real.
check 'none of that started a sandbox' 0 \
  "$(sandbox_handles | grep -c .)"
# Every frontend byte must come from the web deployment, so a path it does not
# have is a mismatched image and has to say so. Falling back to a sandbox would
# put interface bytes back on a per-tenant component and hide the mismatch.
check 'an unknown frontend path 404s, not routed to a sandbox' 404 \
  "$(curl -s -o /dev/null -w '%{http_code}' -m 30 -b "$JAR_A" "$GATEWAY/plugins/@deepseek-ai/does-not-exist/client.js")"
check 'still no sandbox after that' 0 \
  "$(sandbox_handles | grep -c .)"

if docker compose exec -T gateway node -e 'import("/app/gateway/src/persistence.js").then((m)=>process.exit(m.persists()?0:1))' 2>/dev/null; then
  echo
  echo '=== 13b. A tenant keeps their workspace when the sandbox does not ==='
  # Section 13 has just removed every sandbox, so this request builds a new
  # machine — a different VM with a different id — and the file has to be in it.
  # That is the whole claim: the sandbox is disposable and the tenant's work is
  # not.
  api "$JAR_A" host.describe > /dev/null
  MARKER="kept-$$"
  BEFORE=$(sandbox_handles_of "$ALICE" | head -1)
  sandbox_sh "$BEFORE" "printf '%s' '$MARKER' > /workspace/.verify-marker" > /dev/null
  sandbox_remove_all
  api "$JAR_A" host.describe > /dev/null
  AFTER=$(sandbox_handles_of "$ALICE" | head -1)
  check 'the sandbox really is a different one' 1 "$([ "$AFTER" != "$BEFORE" ] && echo 1 || echo 0)"
  check 'the workspace came back with it' "$MARKER" \
    "$(sandbox_sh "$AFTER" 'cat /workspace/.verify-marker 2>/dev/null')"
fi

echo
echo '=== 14. Sessions and revocations survive a gateway restart ==='
echo '     (restarts the gateway; this is the last check for that reason)'
JAR_R=$(mktemp); JAR_OUT=$(mktemp)
trap 'rm -f "$JAR_A" "$JAR_B" "$JAR_NONE" "$JAR_R" "$JAR_OUT"' EXIT
login "$ALICE" "$JAR_R" > /dev/null
login "$BOB" "$JAR_OUT" > /dev/null
# `-c` as well as `-b`: signing out clears the cookies, and a jar that was only
# read would keep presenting the ones the browser has already been told to drop.
curl -s -o /dev/null -b "$JAR_OUT" -c "$JAR_OUT" -X POST "$GATEWAY/logout"
docker compose restart gateway > /dev/null 2>&1
until curl -sf -m 2 "$GATEWAY/login" -o /dev/null; do sleep 1; done
check 'a live session still works afterwards' 200 "$(api "$JAR_R" host.describe)"
check 'a signed-out browser is unauthenticated' 401 "$(api "$JAR_OUT" host.describe)"
# The one that matters, and the reason the access token is short-lived. Signing
# out revokes every refresh token the account holds, so nothing can renew — an
# access token that outlives the click is worth at most its fifteen minutes, and
# a stolen refresh token is worth nothing at all.
check 'signing out leaves nothing to renew with' 0 \
  "$(psql "SELECT count(*) FROM refresh_tokens WHERE email = '$BOB'")"
# Sessions outlive the gateway because they are not the gateway's to keep. The
# store also expires them, which is why nothing has to sweep for stale ones.
check 'the gateway keeps no session file' 1 \
  "$(docker compose exec -T gateway sh -c 'ls /var/lib/dsh-gateway > /dev/null 2>&1 || echo 1' | tr -d '\r')"
check 'refresh tokens live in the database' 1 \
  "$(psql 'SELECT (count(*) > 0)::int FROM refresh_tokens')"
check 'and carry an expiry' 1 \
  "$(psql 'SELECT (count(*) = 0)::int FROM refresh_tokens WHERE expires_at <= now()')"

echo
if [ "$FAIL" -eq 0 ] && [ "$NODE_FAIL" -eq 0 ]; then
  printf '=== all acceptance checks passed (%d HTTP checks plus the suites above) ===\n\n' "$PASS"
  exit 0
fi
printf '=== %d HTTP checks passed, %d failed; suite failures: %d ===\n\n' "$PASS" "$FAIL" "$NODE_FAIL"
exit 1
