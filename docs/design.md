# Design notes

English | [中文](design.zh.md)

Why this deployment is shaped the way it is. The [README](../README.md) covers
what it is and how to run it.

## Why nginx is the front door

The frontend derives both its API base and its WebSocket URL from
`location.origin`, so everything has to arrive on one origin. That origin is
nginx: it answers `index.html`, the client bundles, and the hashed assets from
disk, and proxies only what needs a session — `/api`, `/login`, `/logout` — to
the gateway. Every request stays same-site, so no CORS layer is involved.

The gateway sat in front at first, which put a Node process in the path of every
static byte: a cold load fetches index.html and 37 client bundles, and routing
them through it measured ~26% more latency per request while buying nothing.

The shell still needs a session — an unauthenticated visitor who loaded it would
watch it retry a 401 forever, since the frontend knows nothing about this login
page — so nginx gates `/`, `/index.html`, and `/plugins/*` with `auth_request`
against the gateway's `/_auth`, which answers a status and no body.

## The frontend does not need a sandbox

The Vite build is a shell, not a standalone application: only a dsh host
injects `window.__DSH_BOOT__`, the entry graph naming the client plugin bundles
and their revisions, and only a dsh host serves those bundles under `/plugins`.
Serving the build alone gives a page that loads every asset and then fails to
boot.

They do not have to come from a *running* one. The graph describes a
composition, not a tenant — every sandbox here runs the same image and serves
byte-identical output — so [`web/harvest-shell.mjs`](../web/harvest-shell.mjs)
boots that composition once during the build and saves what it serves. The web
deployment then holds the whole frontend, and the interface loads whether or
not the caller's sandbox is running. Only `/api` needs one.

The harvest runs in the sandbox image, not the builder, and that is
load-bearing: the composition adapts to its environment. A host with a native
directory dialog composes `directory-picker-native` where a Linux container
composes `directory-picker-browse`, and the bundle revisions differ too, so
harvesting anywhere else would ship a frontend whose plugin set does not match
the backend it talks to.

There is no fallback from the web deployment to a sandbox. A path the web
deployment does not have 404s, because the only thing a miss can mean is a web
image that does not match the sandbox image, and answering it from a sandbox
would both hide that and put interface bytes back on a per-tenant component.

That also removed the one frontend path which was not a static artifact.
`/plugins/events` is the client hot-reload channel: the browser opens it and
holds it, expecting a live host to push rebuild notices. Nothing rebuilds these
bundles while a tenant is signed in, so the row is switched off in
[`sandbox/cordis.patch.yml`](../sandbox/cordis.patch.yml) — applied to the harvest
and the sandbox alike, or the harvested manifest would name a composition the
backend does not run.

What needs a session is the app surface — `/`, `/index.html`, `/plugins/*` —
not the shell assets, which carry nothing of any tenant's. Gating those
protects nothing and breaks the requests a browser makes without credentials by
design: a `<link rel="manifest">` sends none unless the tag opts in, which this
`index.html` does not, so a redirect to `/login` arrives at the manifest parser
as HTML.

## Why the sandbox dials outward

The sandbox needs no inbound reachability, no published port, and no dsh
configuration change: dsh keeps its default loopback binding and its default
empty `trustedHosts`.

It also has a consequence worth stating plainly. dsh guards `/api` with a fence
that pins its configuration methods — `settings.*`, `credentials.*`,
`agentPreset.*`, `host.pickDirectory`, `host.openPath`, `llm.discoverModels` —
to loopback callers, and a declared `trustedHosts` authority cannot reach them.
Because the tunnel client replays every request across the sandbox's own
loopback interface, those methods keep working, so the frontend's Settings and
Models pages stay functional. A deployment that instead exposed the sandbox
port would serve ordinary methods and answer 403 for all of them.

The same rewriting disarms the fence, which is a confused-deputy defense (DNS
rebinding and cross-site), never an authentication layer — dsh ships none and
records remote-deployment authentication as deferred work. **Authentication at
the gateway is therefore the only thing protecting an agent that runs shell
commands.** Everything under `/api`, HTTP and WebSocket alike, is refused
before it can reach a tunnel unless it carries a valid session.

## DSH is a dependency, not part of this

The harness is installed from npm at a pinned version. Nothing here patches it:
this deployment's two additions — the tunnel that carries a sandbox's `/api`
traffic, and the sign-out control the frontend otherwise has no reason to offer
— are cordis plugins, named in [`sandbox/cordis.patch.yml`](../sandbox/cordis.patch.yml)
and resolved out of the profile's `node_modules` like any other. Upgrading DSH
is a version bump and an acceptance run.

Every image is a target of [`Dockerfile`](../Dockerfile) with the
repository root as its build context. One `npm install` in the `deps` stage is
shared by all of them, and the toolchain that builds `node-pty` stays in that
stage rather than shipping in what runs.

`@deepseek-ai/dsh-web-frontend` is installed by name alongside `dsh` rather than
arriving through it. cordis resolves plugins by package name at load time, so
which packages a composition needs is not derivable from the dependency graph —
the frontend is not reachable from the CLI through it, and a composition that
needs another package will need naming here too.

What a tenant runs is the artifact: `lib/bin.js` under plain Node, the same
entry the npm package ships as `dsh`.

## The front door serves TLS

The client plugins call `crypto.randomUUID`, which is undefined on a page served
over plain HTTP to anything but `localhost`. A deployment reached at a LAN or
public address therefore has to be HTTPS or it fails on load, and nginx listens
on both 80 and 443 — neither redirecting to the other, since nginx knows the
port it listens on rather than the one the container publishes.

By default the web container generates a self-signed certificate for `TLS_SAN`
on first start, which makes the page a secure context at the cost of a browser
warning. `compose.tls.yml` replaces it with a real one: acme.sh issues over
DNS-01 and renews on its own, which is also the only challenge available to a
deployment that cannot use ports 80 and 443 — a certificate names a host, not a
port, so it is equally valid on 8443.

## Registering and signing in

There are no passwords. A visitor types an address, the deployment mails a
six-digit code, and answering it both registers the address the first time and
signs it in every time. That removes the two things a password deployment has to
get right and never quite does — storing them, and recovering them — and it is
why there is no "forgot password" anywhere: an address that cannot receive mail
is not one this deployment can do anything about.

The code is the whole credential, so it is guarded like one. Six digits over
five attempts and one code per address per minute, spent on first correct use,
compared in constant time, and answered identically whether or not the address
has an account — asking for a code is not also a way to ask who has registered.

Registration is gated on an invite. `REGISTRATION=open` removes the gate; left
alone, a new address needs an unused code, and a returning one needs nothing —
the invite bought the account, not each session. It is checked after the mailed
code rather than before, so the first step answers identically for every
address: asking a stranger for an invite and a returning tenant for nothing
would make the form a way to ask who is registered.

A session is then two tokens. The access token is a signed JWT the gateway
verifies without asking anything, which keeps the store off the path of every
`/api` call — and, for exactly that reason, cannot be taken back, so it lasts
fifteen minutes. The refresh token is opaque, recorded in Postgres, and rotates on
use; revoking it is what makes signing out, suspension, and deletion take
effect. Fifteen minutes is therefore the honest answer to how long a revoked
session can still reach a shell.

Renewal happens in the gateway, not the browser. The frontend is dsh's own
shell: it knows nothing about these tokens and would meet an expired one as a
401 it retries forever. So the gateway renews on whatever request notices — and
on nginx's `auth_request` too, which is how a tab left open overnight gets a
working session from a reload instead of a login page.

## One store

Accounts, invites, refresh tokens, and the sign-in codes outstanding right now
all live in Postgres. Redis held them first and was removed rather than kept
alongside: nothing was left in it once accounts had to be durable, and a second
store means a second backup, a second failure mode, and two answers to "is this
deployment's data safe" instead of one.

Losing an account is worse than losing a session. A tenant's workspace is named
by their account id, so an account that vanishes takes their files with it even
though the files are still on the disk.

Sign-in codes are the only short-lived rows and expire by a column rather than
by the store, so a row that outlived its use is already invisible to every read
and the sweep is housekeeping rather than correctness.

## The user console

`GATEWAY_ADMINS` names the addresses that administer the deployment. They get
`/admin`: who has registered, when, whether their sandbox is running, the invite
codes and who used them, and a box to mint more. Two things can be done about an
account. Suspending keeps the account and everything it owns, and
revokes its tokens and sandbox so it takes effect now rather than at the next
sign-in. Deleting takes the account, its sessions, and its sandbox. Anyone else
gets 404 there — the console is not something a tenant needs to know exists.

Administrators are not offered either action against their own account. Both
would work, and the second would take away the only way back in.

## What a tenant keeps

Under CubeSandbox a tenant's workspace and history outlive their sandbox. Each
gets one volume, created through CubeSandbox's API and attached at `/persist` by
the driver in [`integrations/cube-volume-juicefs/`](../integrations/cube-volume-juicefs/README.md): one JuiceFS
filesystem holds every tenant's directory, with its metadata in Postgres and its
blocks in an S3-compatible store.

Host directories came first and bounded nothing: one `dd` filled the host disk
and took every tenant with it. A volume has two ceilings instead — the filesystem's
own capacity and a per-directory quota — and JuiceFS enforces both, rather than
anything the gateway would have to be trusted to count.

`entrypoint.sh` links the parts of dsh's home that are the tenant's onto the
volume and leaves the rest where the image put it. Not `profiles/`: it holds the
composed web profile, the sign-out plugin, and `node_modules` symlinks into
`/src`, so persisting it would shadow the image's copy with a stale one and
leave dangling links after an upgrade.

Writes are acknowledged before they reach the object store. The driver stages a
block on local disk and uploads it in the background, and the metadata database
commits without waiting for its own fsync — together that is a small-file write
at 9ms rather than 38ms, at the cost of the last moment of work if the node
itself is lost. [`integrations/cube-volume-juicefs/README.md`](../integrations/cube-volume-juicefs/README.md#performance)
has the measurements and the settings that undo it.

A sandbox is reclaimed once `SANDBOX_IDLE_TTL_MS` passes with its tunnel quiet.
Quiet, not unrequested: one agent turn can run for hours and streams its answer
over a socket opened before it began, so judging on requests alone would destroy
the sandbox with that turn's work still inside it. Nothing in the tunnel is a
heartbeat, so an abandoned browser tab holds its socket open in silence and is
still reclaimed on time.

Volumes are named by account id rather than by address, so an address deleted
and registered again gets an empty one rather than the previous holder's files.
Deleting an account destroys its volume, which is the only moment that is right
— a reclaimed sandbox must leave it alone, since keeping it is the point.

## The tunnel is a plugin, not a process

It runs inside the dsh process it serves, inserted into the composition by
[`sandbox/cordis.patch.yml`](../sandbox/cordis.patch.yml). A patch layer targets
existing ids, so adding a plugin takes an explicit `insert` list.

What that buys is not mainly the ~22 MB a second Node runtime cost per sandbox.
It is that `inject: ['connection', 'apiProxy']` *states* when the `/api` surface
exists, where a separate process could only probe for it — and dialled too early
twice before that probe was right, once before the socket accepted connections
and once before the API plane was mounted. The gateway releases held browser
requests the moment a tunnel appears, so both reached a person.

Requests still cross the loopback interface rather than being handed to the
route's handler in memory. dsh's loopback pin lives inside the shared fetch
handler, so an in-memory call would have to construct an equivalent request
anyway, while also reaching past the route's body limits and composition. One
loopback round trip buys behaviour identical to a browser's.

## Header rewriting

The tunnel replays browser requests against local dsh with three changes, each
required by a distinct arm of the fence:

| Header | Rewrite | Without it |
|---|---|---|
| `Host` | set to the dsh loopback authority | 403 — the authority is neither loopback nor trusted |
| `Origin` | removed | 403 — an attached Origin must equal the Host authority |
| `sec-fetch-site` | removed | 403 — an explicit `cross-site` marker is refused outright |

The gateway's session cookie is stripped as well: authentication is settled at
the gateway, and forwarding the cookie would place one tenant's session token
inside a container that tenant's own agent can read.

WebSocket upgrades pass the same fence, so `/api/events.mux` and
`/api/events.host` need the identical rewriting; the client additionally drops
the browser's `sec-websocket-*` headers so the local handshake key is the one
`ws` minted and can verify.

## Where session state lives

Sessions are kept in Postgres, so the gateway holds no disk state and a restart
does not sign anyone out — an open tab cannot recover from that on its own,
because the frontend retries a 401 indefinitely rather than returning to a login
page it knows nothing about. Expiry is a column every read filters on rather
than a store's own eviction, so a row that outlived its use is already invisible
and deleting it is housekeeping.

A server-side store rather than a self-validating token, because logout has to
actually revoke. A signed stateless cookie stays valid until it expires and
nothing can take it back, which is the wrong property for a session that reaches
a shell.

## The account section

Sign-out is the deployment's, not dsh's: the harness has no notion of the
gateway's tenants, so nothing in its own composition can end a session.
[`packages/dsh-gateway-logout`](../packages/dsh-gateway-logout) adds an Account page to
Settings — the caller's name from `/whoami`, and a control that posts to
`/logout`, which revokes the session and releases their sandbox.

It is a real client plugin, registered into `settings.section` beside the
shipped pages. Three things make that work, and each fails silently rather than
loudly if missed: the package is installed into the profile's `node_modules`,
because the client-module registry resolves a plugin's package.json from the
config tree's baseUrl and scans only what it can resolve by name; its `exports`
must include `./package.json`, or that resolution is blocked by the exports
gate; and the browser half is written against `window.__ModuleLoader__`, whose
`require` is the shell's module table — which is where React comes from, so the
package needs no build step and never resolves through node_modules.

A plugin loaded by path, as the tunnel is, mounts its host half and contributes
no client half at all.

## What a container cannot do

Settings ships an "Open configuration file" action that asks the host to open
the settings file on a desktop. There is none in a container, and dsh says so —
`host.describe` reports `canOpenPath: false` — but the control does not consult
that, so it stayed visible and answered every click with "Could not open
configuration file". The account plugin shadows that cell with nothing. Every
setting the file holds is editable in the sections beside it, so a tenant here
loses nothing.

Shadowing takes a *different* `priority`, not the same one: sharing an id at
equal priority is refused outright, which fails the whole plugin rather than the
one cell. `priority` is also not `order` — order is position within a cell,
priority is the cell's shadowing rank, and the lowest renders.

## Permissions inside a sandbox

Sandboxes run with `DSH_PERMISSION_MODE=danger-full-access`, which the base
bundle reads for both the file policy and the approval policy: full access, and
no approval prompts. Asking a tenant to approve each write and each command
would be guarding the inside of a box that exists to be written in, and the
prompt has nowhere to appear in a headless container. The boundaries that
matter are the container and the gateway in front of it.

## Isolation

One user gets one sandbox. Nothing multiplexes two users into one dsh process,
because dsh has no tenant concept: its `/api` surface is single-occupancy and
its session store is process-wide. Isolation between tenants is container
isolation, and the gateway allocates every tunnel stream id, so a sandbox can
only answer streams opened for its own tenant.

## Verifying it

```sh
./verify.sh                                              # the Docker simulation
SANDBOX_RUNTIME=cube COMPOSE_FILE=compose.yml:compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh                  # CubeSandbox
```

It signs two tenants in and checks the properties the deployment exists to
provide: unauthenticated calls and upgrades are refused, each tenant gets their
own sandbox, the backend listens on loopback so the tunnel is the only way to
it, the loopback-pinned configuration methods survive the tunnel rewriting, both
`/api` downlinks open, a real model turn completes, and neither tenant can list,
read, or prompt into the other's sessions. Where the runtime withholds the model
credential, it also checks that the sandbox holds only the placeholder.

It runs against either runtime. Everything it asks about a sandbox goes through
four functions, because the two runtimes share nothing to inspect: under
`docker` a sandbox is a container on the host it runs from, and under `cube` it
is a machine only the gateway container can reach — so those calls go through a
helper copied into it. What it asks is read from the backend process itself
rather than from a shell beside it, since the two runtimes start that process
differently and a shell answered about the wrong one.

It also removes every sandbox and checks that `/` still answers with its boot
manifest, that a client bundle still answers, that an unknown frontend path
404s rather than reaching a sandbox, and that none of it started one — the
property the frontend split exists to provide.

It then drives a real Chromium: sign in, boot the page with no console or page
errors, choose a workspace, send a message, and read the model's answer out of
the DOM. That suite exists because a status code cannot tell a working page
from a blank one — the two failures that actually reached a person, a broken
inline script and a missing boot manifest, were invisible to every HTTP check.

One check starts no sandbox: the idle sweep decides on elapsed time, so it is
driven directly with both of its clocks handed in, rather than waited out for
the length of a TTL.

The `ws`-dependent suites run inside the gateway container. The browser suite
runs on the host when Playwright is installed there and in Playwright's own
image otherwise, which is what lets it run on a deployment host rather than only
on a developer's checkout. Both spend real model tokens.
