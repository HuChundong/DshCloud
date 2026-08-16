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
