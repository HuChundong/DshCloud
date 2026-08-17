# What running an agent in a sandbox actually costs

English | [中文](sandbox-pitfalls.zh.md)

Every entry here is something that broke this deployment, with the symptom that
surfaced it and the measurement or error that settled it. They are grouped by
which layer they belong to, because that is what determines who can fix them.

Several are recorded with the wrong conclusion that preceded the right one.
Those are the useful ones: the failure was never where it looked.

## The template is a snapshot of the image *running*

A CubeSandbox template is not the image. It is a snapshot taken while the image
runs, restored for every tenant — so whatever a `CMD` starts is frozen into it,
started before any tenant exists and identical in every sandbox restored from
it.

The first version put the backend in `CMD`. Sandboxes came up with a backend
that had been started in another machine's lifetime, holding another machine's
state, and exited immediately. The instinct — bake more into the template so
startup is faster — is exactly backwards: a template cannot hold anything that
is only knowable when a tenant arrives.

The image therefore declares no `CMD`. `cube-entrypoint.sh` waits on envd, and
the gateway starts each tenant's backend through envd's process API with the
identity that only exists at creation.

**Corollary that cost a second round:** `POST /templates/{id}` does not pick up
a new image. Pointing an existing template at one leaves every sandbox restoring
the snapshot it already had. A new image means a new template, every time.

## envd hands its processes a clean environment

Once the backend moved from `CMD` to envd, every `ENV` in the Dockerfile
silently stopped reaching it. The backend ran with `HOME=/root` and no
permission mode — which is to say it ran with approval prompts that no browser
could answer, in a container that exists to be written in.

Nothing failed loudly. The sandbox started, the tunnel dialled, and the first
tool call hung on a prompt with nowhere to go.

The image now projects its own environment into a file the entrypoint sources,
written from the values rather than restated, so it cannot drift from the `ENV`
lines that remain their single home:

```dockerfile
RUN for name in DSH_BIN DSH_HOME HOME DSH_PERMISSION_MODE NODE_ENV \
                NODE_EXTRA_CA_CERTS TZ; do \
      printf 'export %s=%s\n' "$name" "$(printenv "$name")"; \
    done > /app/sandbox/env.sh
```

`TZ` joined that list late, and only because someone would have noticed every
file dated eight hours off.

## The network denies the infrastructure that runs it

CubeSandbox allows public egress by default and denies the private ranges
alongside it, so a sandbox cannot use its internet access to reach the
infrastructure hosting it. The gateway sits on one of those ranges, so a sandbox
could reach the model API and not the thing that started it.

Its address is allowed back in explicitly, at creation, in the same call that
attaches the network policy. An address, not a name: a DNS name in `allowOut` is
only honoured alongside a `0.0.0.0/0` deny-all, which would take everything else
down with it.

## The model credential can be withheld, but not conditionally

CubeEgress terminates TLS to rewrite the `Authorization` header, so the sandbox
holds a placeholder and the real key never enters it. This matters because the
agent inside runs with full access on the tenant's behalf: anything in its
environment, its filesystem, or its process table is something a prompt can be
made to read back. A key that is never there cannot be read back.

Two constraints came out of trying to be clever with it:

- **Interception requires trust.** CubeEgress mints a leaf certificate for the
  requested SNI, so the sandbox must trust that installation's root — and Node
  verifies against its own bundled roots and ignores the system store, so
  installing the CA is not enough without `NODE_EXTRA_CA_CERTS`.
- **Injection cannot be conditional.** The intent was to inject only when the
  request carries the placeholder, so a tenant configuring their own key would
  not have it overwritten. `ngx.req.clear_header` always runs first, so by the
  time the rule can look, there is nothing left to look at.

## S3 is not a filesystem, and the agent notices immediately

The obvious way to give each tenant persistent storage is to mount their prefix
of an S3 bucket. Both s3fs and `rclone mount` were tried. Both are unusable, for
a reason that has nothing to do with speed: they map filesystem calls onto object
calls, and S3 has no hard link.

The harness replaces its session log atomically by linking a temporary file over
the real one. Every turn ended immediately with

```
EIO: i/o error, link '…session.jsonl.zstd.tmp' -> '…session.jsonl.zstd'
```

and no assistant message at all.

**The wrong conclusion:** that persistent storage on object storage was out of
reach. It was not. JuiceFS is a filesystem that happens to keep its data in an
object store — the metadata lives in a transactional database, so links, atomic
rename, and file locks all mean what they mean, and the object store only ever
holds blocks. The mistake was reasoning from "S3 cannot do this" to "this cannot
be done on S3", when the fix was to stop asking S3 the question.

## A volume that has to be fetched is not a volume

The first JuiceFS version created a disk image per volume and attached it at
sandbox creation. It worked, and it destroyed the thing the platform is for.

| | attach |
|---|---|
| no volume | 0.39s, 0.53s |
| disk image per attach | 7.92s, 8.29s |
| one shared mount, bind per volume | 0.06s |

A sandbox restores from a snapshot in under half a second. Anything on the
attach path that copies, downloads, or starts a process is then the slowest
thing in the system — by an order of magnitude.

So one JuiceFS client is mounted once per node, and every volume is a bind mount
of one directory inside it. A bind mount is a syscall: no bytes move, and a
sandbox sees only its own directory.

## Two ways a mount lies about being mounted

Both cost a debugging round, and both have the same shape: the question you
would naturally ask is one of the calls that fails.

**A client that lost its metadata database** keeps its mount in the table and
answers `EIO` to every call. `mountpoint` says yes. The check has to be a read
that would fail, and the repair has to be an unmount — mounting over a dead
mount does nothing.

**A bind made from a client that has since been replaced** answers `ENOTCONN` to
everything, and nothing rebuilds it: the mount table still lists it, so attach
skips it and hands the sandbox a dead mount. The tenant's backend then fails at
`mkdir '/workspace'`, which surfaces as a 500 from `session.create`.

That one took three attempts because every probe is itself a failing call:

- `mountpoint -q` reports such a bind as **not** mounted, so the obvious guard
  never fires.
- `mkdir -p` on it fails with `ENOTCONN`, which under `set -e` ends the hook
  before it can repair anything.

The detection that works reads `/proc/self/mounts` — which the kernel answers
from memory — and pairs it with one call that would fail:

```sh
if grep -qF " ${mnt} " /proc/self/mounts && ! ls "$mnt" > /dev/null 2>&1; then
    umount -l "$mnt"
fi
```

## The plugin contract is narrower than the product needs

A CubeSandbox VolumePlugin receives, in every hook, a volume id and a name.
There is no capacity, no size, no custom parameters — and the documentation is
explicit that a plugin must locate its backend resources from the volume id
alone, taking its configuration from files and environment.

This was verified three ways before believing it: the documented parameter
tables, the shipped Tencent COS example's own argument parser, and an API call
carrying `capacity` and `labels` that arrived with both dropped.

The consequence is that per-tenant quotas cannot come from the platform. One
figure covers every tenant until upstream passes one at create. Two designs that
route around it — the gateway setting quotas directly, or the plugin asking the
gateway — were both rejected as worse than waiting: the first puts a 120 MB
binary and metadata-database credentials into the component that authenticates
tenants, and the second couples a generic plugin to one product's HTTP surface.

## Defaults sized for a workstation, on a shared node

JuiceFS defaults its cache to 100 GiB in the mounting user's home directory.
Cubelet runs the hook as root, so that is `/root/.juicefs/cache`, on whatever
filesystem `/` happens to be — a place no operator chose, with a ceiling nobody
set, on the disk everything else shares.

Both are now explicit and always passed. The size bounds the read cache only;
staged writes share the directory and are bounded by the free-space floor
instead, which is worth knowing before setting it to something small.

## Where the time actually went

The instinct was that metadata reads were the bottleneck — every `stat` going to
Postgres. Measured, that was wrong. Per small-file operation, against a local
disk at 0.06 ms:

| | create | `stat` cold | `stat` warm |
|---|---|---|---|
| everything default | 38.13 ms | 1.0 ms | 0.007 ms |

Metadata caching already worked: a repeated `stat` was 140× faster than a cold
one. The earlier reading that suggested otherwise was a shell loop, where
forking `stat` once per file cost more than the filesystem did.

The real cost was writes, in two layers:

- **Every `close` waited for an object upload.** `--writeback` acknowledges once
  the block is staged locally: 38 ms → 17 ms.
- **Every durable metadata commit waited for a WAL fsync** — 2.93 ms against
  0.33 ms without, and a file create spends several: 17 ms → 8.5 ms.

Raising the metadata timeouts extends a cache that already existed rather than
creating one. It is safe here only because a volume is attached to its tenant's
single sandbox — one directory, one writer.

## The harness has opinions about where it is started

Two of them cost real debugging:

- **dsh takes its sandbox policy's workspace root from the process's working
  directory.** Starting it from the checkout made the harness source tree the
  tenant's workspace — with full access inside the container, the agent's
  default working directory was the code its own sandbox runs.
- **cordis resolves plugins by package name at load time**, so which packages a
  composition needs is not derivable from the dependency graph. `pnpm prune
  --prod` removed workspace links the built entry imports. Later, installing
  from npm, `@deepseek-ai/dsh-web-frontend` turned out not to be reachable from
  the CLI package and has to be named outright.

And one that produced a plugin which loaded and did nothing visible: **the
client-module registry resolves a plugin's package.json from the config tree's
baseUrl**, and scans only what it can resolve by name. A plugin loaded by path
mounts its host half and contributes no client half at all.

`npm install <local path>` has the same failure with a different cause: it
symlinks back to the source, and Node then resolves the plugin's own
dependencies from where the link points rather than from the profile. The shared
frame protocol became unresolvable and the tunnel plugin would have died on its
first import. `--install-links` copies instead.

Both of these build cleanly. Neither shows up until something calls `resolve()`.

## Idle is not the same as unrequested

Sandboxes are reclaimed after a quiet period, because each one is a machine's
worth of memory held for one person. The first version measured that from when a
request last *started*.

An agent turn is started by one request and then answers over a WebSocket the
browser opened before it began. A turn that runs longer than the TTL ages out
its own sandbox, and the sweep destroys it mid-answer — while the tenant is
watching output arrive.

Judging on tunnel traffic fixes it, and is only usable because the protocol
carries no heartbeat: every frame is a request, a response, or a session event,
so silence is real silence and an abandoned browser tab still ages out on time.
If a keepalive is ever added to either end, this signal stops reclaiming
anything.

## The one capability signal, and the surfaces that ignore it

The harness knows perfectly well that a container has no desktop:
`host.describe().canOpenPath` asks the platform and finds Linux with no display
server. Two surfaces consult it and degrade correctly — the agent-preset page
offers "show location" instead of "open location", and the deliverables row
omits its "show in folder" action. The rest do not, and each is a control that
cannot work in any sandbox:

- Settings' "Open configuration file" gates on `settings.describe().hasDocument`,
  which is computed as `documentPath !== undefined` — whether the file exists,
  which it always does. The identically named field on `agentPreset.list` is
  computed as `canOpenPaths()`. One spelling is wrong, and it is not obvious
  from either call site which.
- `ui-conversation` passes an `openFile` into its chat view that calls
  `host.openPath` unconditionally, so every produced-file chip and every inline
  path reference in a closing message is a dead link. The failure is swallowed
  by a `.catch(() => {})` whose comment says the native application will surface
  its own error — which is true, and there is no native application.

The sharpest evidence that this is an oversight rather than a decision: the
deliverables package gates its "show in folder" action on `canOpenPath` and does
not gate the file chips two lines above it.

The wrong conclusion first: this was read as something to hide, and the
sign-out plugin shadowed the Settings action with an empty cell for several
weeks. Hiding a control is the right move only when nothing can replace it. Here
something could — the document itself — and the shadowing had also quietly
attached a third subject to a package named for one, which is what eventually
forced the split into `dsh-sandbox-host` and `dsh-tenant-account`.

What is genuinely out of reach is the chat view's `openFile`: it is injected by
the package that owns the view, not offered as a slot, so a plugin can only
replace the whole view. Reported upstream at
[discussion 2729](https://github.com/deepseek-ai/deepseek-harness/discussions/2729) — dsh has issues
disabled and its CONTRIBUTING names Discussions as where bugs go, and says
external pull requests are not being accepted, so a report is the whole of what
this project can do about it.

## The shared `/api` channel takes exactly one interceptor

dsh offers two ways to add RPC endpoints: `connection.rpc.intercept('/api', …)`,
which claims endpoints on the channel the browser already talks to, and
`connection.rpc.handle('/<name>', …)`, which registers a channel of your own.
The first is obviously better — no new route, no gateway change, no nginx
location — and it is unavailable. There is room for one interceptor on `/api`,
and dsh's own `typert-gateway` takes it in the base bundle. A second
registration throws at mount.

That failure would have been loud, which is the only good thing about it: it
lands during composition rather than on the first upload. But it is invisible
from the contract — `intercept` is a documented public method and nothing in its
signature says it is single-occupancy — so the design was written against it
before a read of `rpc-host.ts` said otherwise.

A channel of one's own turned out to be the better shape anyway. `/files` is
visibly its own plane at every layer it crosses: an nginx location, a branch in
the gateway's routing, a route in the sandbox. Endpoints hidden inside `/api`
would have been none of those things.

Note also what the channel name may be: `/^\/[A-Za-z0-9._~-]+$/`. One segment.
`/api/files` is not a legal channel, so a plane cannot be nested under another.

## A service you did not inject fails where you use it, not where you mount

The tunnel plugin injects `connection` and `apiProxy`, and calls
`ctx.setTimeout` in one place: the redial after a dropped tunnel. cordis refuses
a service the reading context did not inject — and refuses it at the read, not
at the mount — so that one line threw, inside a WebSocket close handler where
nothing catches it, taking the tenant's whole backend process down with the
tunnel.

It survived for weeks because of what it looked like from outside: a sandbox
that restarts when the gateway does. That is close enough to what one expects of
a gateway restart that nobody asked why, and the acceptance suite agreed — it
restarts the gateway and then checks a live session still works, which it does,
because the gateway rebuilds the sandbox it just killed.

It surfaced from a throwaway probe that booted the sandbox image against a
gateway URL that could not connect. The first close arrived in milliseconds
instead of never, and the process died in the logs.

Two things generalize. A dependency used on one rare path is a dependency the
happy path cannot prove, so `inject` has to be read against every use of `ctx`,
not against the ones the plugin performs at startup. And a failure that
resembles a normal event is the kind that lasts: "restarts with the gateway"
needed no explanation, so it never got one.

## The composer has seats around it, not inside it

An attachment feature needs three things the composer does not offer, and each
one sits next to something it does offer.

- **The `+` menu takes exactly one source.** `inputTriggers.registerSource` is
  the documented way to add a group, and `+` calls
  `toggleSource('command', …)`, which seeds the menu with that one name. A
  registered source therefore appears when the person types `/` and never under
  `+` — which is where a person looks for "add something to this message".
- **The card position is a prop, not a slot.** dsh's image thumbnails render
  through `accessory` on the composer bar's owner props, inside the card above
  the textarea. Every input region a plugin can take is outside the card.
- **A user message can only be replaced whole.** `conversation.chat.node` key
  `user` can be shadowed, but `UserMessageNodeView` delegates to
  `UserStyleBubble` and `MessageIconActions`, neither exported — so drawing an
  attachment as a chip in the sent message means reimplementing the transcript's
  most common row.

Two of the three are answered here by forgery: a second panel drawn above the
real `+` menu, and a container of this plugin's own placed where the image rail
sits, filled through a React portal.

The card started as the second half of that sentence done wrong — React's own
node, moved. It froze the page, and only on the gesture that matters: upload,
then send. React still believes a moved node is a child of the container it
rendered it into, so the first unmount — the composer is rebuilt on the
blank-to-active flip — calls `removeChild` on a node that is no longer there,
throws, and throws again on every retry. A portal inverts the ownership: React
renders into a container whose position it does not own, and this side owns
nothing React renders.
Both key on ARIA roles (`[role=listbox]`, `aria-expanded`, the textarea) rather
than on hashed CSS-module names, and both copy the real element's *computed*
style instead of restating it, so a theme change or an upstream restyle carries
across. Neither survives a change to the composer's shape, and both go away the
day the seats exist.

The third was not forged. Reported with the others at
[discussion 2741](https://github.com/deepseek-ai/deepseek-harness/discussions/2741).

## Writing into the draft is not the same as telling the agent

The first cut of the upload wrote the committed path into the composer draft,
reasoning that a path is exactly what a person on a local host would have typed.
It reads wrong: the person watches a path they did not write appear in a box
that is already showing them a card for the same file, and the path is then
theirs to accidentally edit or half-delete.

The seat that was wanted already existed. `agent.inbox.append('next-step', …)`
takes an injected message whose `source.kind` is not `user`, which the queue
projects as `context` — invisible until the turn claims it, then rendered as a
context row rather than as words the person appears to have said.
`agent-instructions` and `goal-round-driver` both use it. `inbox.remove(id)` is
the retraction, so taking the card off the message takes the notice with it.

What made this hard to see: the draft is the only part of the composer a plugin
can write, so it looks like the only way to reach the model. The inbox is on the
other side of the same session, and reaching it needs nothing but the session id
the client already has.

## What generalizes

- **A snapshot cannot hold what is only knowable later.** Everything
  tenant-specific has to arrive after restore.
- **A clean environment is a silent one.** Anything that re-parents a process —
  envd here — drops what the image set, and nothing reports it.
- **Ask a different question when the answer is "cannot".** S3 has no hard link;
  a filesystem over S3 does.
- **The attach path is the start path.** Sub-second restore is worth nothing if
  attach takes eight seconds.
- **Probes fail the same way the thing being probed does.** Detect through
  something the kernel answers from memory, then confirm with a call that would
  fail.
- **Measure before optimizing, and distrust the measurement.** The first
  benchmark said metadata was slow; it was measuring `fork`.
- **A green build proves nothing about resolution.** Symlinks, relative `file:` paths,
  and name-resolved plugins all build fine and fail at first import.
- **Hide a control only when nothing can replace it.** "Open configuration file"
  had a replacement — the file's contents — and hiding it delayed finding that
  for weeks.
- **A public method is not necessarily an available one.** `rpc.intercept` is
  documented, exported, and already taken.
- **The seat you can reach is not always the seat you want.** The draft is the
  only writable part of the composer, which is why it took two tries to look for
  the agent inbox.
- **Never move a node React rendered.** Give React a container and a portal
  instead; a stolen node survives until the first unmount and then freezes the
  page.
- **Read `inject` against every use of `ctx`, not the ones at startup.** A
  service used on one rare path is one the happy path cannot prove.
- **A failure that looks like a normal event is the kind that lasts.** "The
  sandbox restarts when the gateway does" needed no explanation, so it never
  got one.
