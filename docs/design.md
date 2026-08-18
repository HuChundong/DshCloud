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
[`packages/dsh-tenant-account`](../packages/dsh-tenant-account) adds an Account page to
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

dsh is built for a host on the desk of the person using it. The browser and the
backend share a filesystem there, so a path is enough: a file worth talking
about is already reachable, and a document worth reading opens in whatever the
desktop associates with it. Moving the backend into a sandbox takes that premise
away, and several surfaces are built on it.

The harness has one signal for this — `host.describe().canOpenPath`, which is
already false here, because it asks the platform and finds Linux with no display
server. `sandbox/cordis.patch.yml` states it outright anyway, as `nativeOpen:
false` on the `api-gateway` entry: the detected answer is correct by coincidence
of the base image, and anything that later put a DISPLAY into this container
would flip it back.

Where a surface consults that signal, it already degrades: the agent-preset page
offers "show location" instead of "open location", and the deliverables row
omits "show in folder" entirely. Where a surface does not, it is a dead control
in every sandbox:

- **Settings' "Open configuration file"** gates on
  `settings.describe().hasDocument`, which reports whether the file *exists* —
  it always does — rather than whether anything can open it. `agentPreset.list`
  spells the same field `canOpenPaths()`. One of the two is wrong.
- **File links in the transcript** — the produced-files row a turn ends with,
  and the inline path references in its prose — call `openFile` unconditionally,
  and the failure is swallowed by a `.catch(() => {})`.

`dsh-sandbox-host` replaces the first with the capability it can actually
provide: a Configuration page that shows the document, since a document is what
a person here can be given, and a document does not fit in the header's action
row. The header cell it vacated is left empty — the gesture moved, it was not
hidden.

The second is not reachable from a plugin: `openFile` is injected by
`ui-conversation` into its own chat view, not offered as a slot, so replacing it
means replacing the whole view. That is an upstream issue and a documented
limitation, not a patch layer; see
[sandbox-pitfalls](sandbox-pitfalls.md).

Shadowing a cell takes a *different* `priority`, not the same one: sharing an id
at equal priority is refused outright, which fails the whole plugin rather than
the one cell. `priority` is also not `order` — order is position within a cell,
priority is the cell's shadowing rank, and the lowest renders.

## Getting a file into a sandbox

On a local host nobody uploads anything: the person names a path and the agent
reads it. Here the path they can name is on the wrong machine, so the deployment
has to produce one.

The path never appears in the composer. Writing it there was the first cut, and
it was wrong twice over: the person reads a path they did not type, in a box
that is already showing them a card for the same file. dsh has a better seat for
it — the agent inbox takes injected context, the same channel approval notices
and attached snapshots ride. A commit appends a `plugin`-sourced message to
`next-step`, which is invisible until the next turn claims it and then renders
as a context row rather than as words the person appears to have said. Taking
the card off the message retracts that notice, so the agent is never told about
a file somebody changed their mind about.

Nothing new reaches the model beyond that text: no content block, no provider
contract, no agreement with the harness about what an attachment is. (dsh's own
attachment plane is images only, and says so — generic files are deferred
upstream pending a lifecycle and provider contract.)

The card itself is rendered where dsh renders its own image thumbnails: inside
the composer card, above the textarea. No slot reaches there — that position is
the `accessory` prop on the composer bar — so the node is moved into place after
render, and the `+` menu's "附件" group is a second panel drawn above the real
one. Both are forgeries, both key on ARIA roles rather than hashed class names,
and both are reported upstream; see
[sandbox-pitfalls](sandbox-pitfalls.md).

The endpoints live on `/files`, a channel of dsh's own RPC registry, and not on
`/api`. `/api` accepts exactly one interceptor and dsh's `typert-gateway` holds
it; a second registration throws at mount. A channel of its own costs one nginx
location and one line in the gateway's routing, both of which treat it exactly
as they treat `/api` — authenticate the caller, hand it to their sandbox, know
nothing about what is on it.

Uploads are chunked at 4 MiB, and the body limit is not why. dsh accepts 160 MiB
and nginx is set to 200. The tunnel is a single WebSocket carrying every request
as base64 frames, so a file sent whole holds it for the duration and every other
call queues behind it.

Bytes land in a staging file and become visible only on commit — a half-written
file an agent could pick up reads as a complete one — and they are published by
hard link, which fails on collision rather than overwriting. Two files of one
name uploaded on one day are two files. The destination is
`<workspace>/uploads/<date>/`, and `/workspace` is a symlink onto the tenant's
volume whenever they have one, so an upload outlives the sandbox that received
it.

## What a tenant's agent is given

The sandbox is where the work happens, so what is installed in it is the
difference between an agent that can answer a question about an attached
spreadsheet and one that can only describe the file. It ships:

- the search and text tools an agent reaches for — `rg`, `fd`, `jq`, `tree`,
  `patch`, `file`, `less`;
- archives in both directions — `unzip`, `zip`, `7z`, `zstd`, `bsdtar`;
- documents — `pdftotext`, `sqlite3`, and `officecli`, one binary that reads
  and writes xlsx, docx, pptx and pdf without a headless office suite behind
  it;
- reachability — `dig`, `ping`, `ip`, `nc`, which is the first thing anyone
  debugs in a sandbox whose whole architecture is dialling out;
- a Python with pandas, duckdb, the spreadsheet and PDF readers, pillow and
  matplotlib already in it;
- and a CJK font, because a chart with Chinese labels renders as boxes without
  one and nothing about that failure says "font".

OfficeCLI carries its own agent skill, and the image installs it into a bundled
skill root of its own (`DSH_BUNDLED_SKILL_DIR`) rather than into
`$DSH_HOME/skills` — that one is a symlink onto the tenant's volume, so an
image-owned copy there would be shadowed by whatever they have. Written by the
binary at build time rather than kept in this repository, because OfficeCLI
updates the skill with itself and a copy here would age silently against the
version pinned in the `Dockerfile`. Only the base skill: the specialized ones
are printed on demand by `officecli load_skill <name>`, so putting all eleven in
the catalog would spend a description line in every request for ten skills a
tenant may never open. The bundled root ranks below the tenant's own, so a skill
they write under the same name wins.

Python is a virtualenv on `PATH`, not the system interpreter. Debian marks that
one externally managed, so `pip install` there fails by design and
`--break-system-packages` is a way of saying the design was wrong. The venv
gives a tenant an ordinary `pip install` that cannot damage the distribution's
Python — and both package managers carry the deployment's mirror *into* the
image (`/etc/pip.conf`, npm's global config), so a tenant's own install reaches
the same mirror the build did rather than waiting out the public index.

The cost is the number that matters: the image went from 617 MB to 1050 MB, and
a CubeSandbox template is a snapshot of it. That is why the list is shorter than
the one it was borrowed from. Measured in the built image and then cut:
`pyarrow` (152 MB, and duckdb reads parquet in 58), `plotly` (42 MB, and what a
chat window shows is the static image matplotlib already draws), `libgl1` (41
packages of OpenGL that nothing here draws through), `unar` (18 packages of
GNUstep for archives `bsdtar` reads). Each is one install away.

Not taken at all: database drivers, because one deployment's databases are not
another's; and a compiler, because every wheel here is prebuilt for this
platform and a source build is the one thing a tenant has to arrange itself.

## The sidebar's foot

Two things live there, and which package owns which follows the same question
as everything else: take the gateway away, is this still needed?

The **sandbox row** — a status dot and three rings for CPU, memory and disk —
belongs to `dsh-sandbox-host`, because a sandbox is what it describes. The
figures come from `/proc` and `statfs` inside the sandbox, over the same
`/files` channel the uploads use, polled every five seconds while somebody is
looking. A push would have cost a frame kind in the tunnel protocol and
per-tenant state in the gateway; a poll costs one small round trip and nothing
when no tab is open.

Whether the sandbox is RUNNING is deliberately not part of that answer. A
sandbox that is not running answers nothing at all, and the gateway already
says so with a 503 — so the state is read from whether the call arrives, which
is the only version of the question that is not a guess.

The **account row** belongs to `dsh-tenant-account`, and it takes the seat the
Settings control used to have. That is not a decoration: the shell's Settings
button IS the `settings.trigger` seat, wrapped by the owner in the button that
opens the panel. Filling that seat with the account row is what demotes
Settings from a first-class control to one line in the menu behind it, while
leaving the panel and every section in it untouched. The menu opens the panel
by clicking the owner's own button — `open` is local state inside the settings
shell, with no service and no event to reach it, so the click is the only seam
there is.

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
