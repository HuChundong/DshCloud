# JuiceFS-backed volume plugin

English | [中文](README.zh.md)

A CubeSandbox VolumePlugin that gives every tenant a persistent, quota-bounded
directory whose data lives in an S3-compatible object store.

## Why this exists

Sandboxes are disposable and tenants are not. The deployment's first answer was
a host mount per tenant — a plain directory on the sandbox host — which returned
their files but bounded nothing: one `dd` filled the host disk and took every
tenant, and CubeSandbox itself, with it. Access was isolated; capacity was not.

## Why JuiceFS and not an S3 mount

The obvious implementation mounts each volume's prefix with s3fs or `rclone
mount`. Both were tried and both are unusable, for a reason that is not about
speed: they translate filesystem calls into object calls, and S3 has no hard
link. The harness replaces its session log atomically by linking a temporary
file over the real one, so every turn ended immediately with

```
EIO: i/o error, link '…/session.jsonl.zstd.<tmp>' -> '…/session.jsonl.zstd'
```

and no assistant message at all — the model answered and the log write did not
survive.

That is a property of those mounts, not of object storage. JuiceFS is a
filesystem that happens to keep its data in an object store: **metadata lives in
a transactional database**, so hard links, atomic rename, and file locks all mean
what they mean, while the object store only ever holds blocks. Measured on this
deployment: `ln` produces `links=2`, `ln -f` replaces atomically, `flock`
returns.

## Why one mount and many binds

Attach is on the path of a tenant's first request, and CubeSandbox restores a
sandbox from a snapshot in about half a second. Anything that copies, downloads,
or starts a process there becomes the slowest thing in the system — an earlier
version fetched a per-tenant disk image on attach and took **8 seconds**, a
sixteenfold regression measured against the same template with no volume.

So one JuiceFS client is mounted per node, once, and every volume is a bind
mount of one directory inside it. A bind mount is a syscall: **attach costs
0.06 seconds** and no bytes move. Startup with a volume is back to 0.4–1.4s,
which is the platform's number rather than this plugin's.

A sandbox sees only its own directory, because only that directory is bound
into it.

## Capacity

Two ceilings, both JuiceFS's to enforce:

- **Whole deployment** — the `--capacity` the filesystem was formatted with.
- **Per tenant** — a directory quota, set by this plugin at `create`. Writing
  past it fails with `EDQUOT` inside that tenant's own sandbox and affects
  nobody else. Verified by writing 3 GiB into a 2 GiB volume.

One figure per tenant, not one per account: CubeSandbox hands a plugin a volume
id and a name and nothing else, in any hook, so there is no capacity to receive
and nowhere a per-account one could come from. Raising `VOLUME_CAPACITY_GB`
applies to volumes created afterwards; existing ones keep the figure they were
created with until `juicefs quota set` is run against them.

The two ceilings are independent, so the per-tenant figure times the number of
tenants may exceed the filesystem's own — 5 GiB each passes 100 GiB at twenty
tenants. That is oversubscription, not a misconfiguration: the deployment
ceiling still holds, and the tenant who writes last is the one who meets it.

Deleted data is reclaimed after JuiceFS's trash retention, so freed space
returns a day later rather than at once.

## Performance

A network filesystem with durable metadata will not match a local disk, and the
gap is worth knowing before tuning it. Measured on one node, per small-file
create, against a local disk at 0.06ms:

| | create | repeat `stat` |
|---|---|---|
| everything default | 38ms | 1.0ms |
| `WRITEBACK=on`, local cache, 30s metadata timeouts | 20ms | 0.007ms |
| and `synchronous_commit=off` on the metadata database | 8ms | 0.007ms |
| and Redis as the metadata engine | 3ms | 0.14ms |

What each one buys:

- **`WRITEBACK=on`** is the largest single change the plugin can make. Without
  it every `close` waits for an object upload; with it the write is acknowledged
  once staged on local disk. The cost is that a node lost before its backlog
  drains takes that data with it while the metadata still lists the file.
- **`CACHE_DIR` / `CACHE_SIZE_MB`** are always passed, because JuiceFS's own
  defaults put a 100 GiB cache in the mounting user's home directory — root's,
  since Cubelet runs the hook — on whatever filesystem that lands on.
- **The metadata timeouts** extend a cache that already exists rather than
  creating one: a repeated `stat` costs 0.007ms against 1.0ms cold even at the
  1s default. Raising them helps a workload that revisits files seconds apart,
  and is safe only where one directory has one writer. That holds here, since a
  volume is attached to its tenant's single sandbox; it stops holding if two
  nodes ever write one volume.

Two levers are deliberately not the plugin's:

- **`synchronous_commit`** belongs to the metadata database, so Installing turns
  it off there rather than here. Each durable commit costs a WAL fsync —
  measured at 2.9ms against 0.33ms without — and a file create spends several.
  What it gives up is the last fraction of a second of metadata on an unclean
  shutdown; a deployment that cannot accept that leaves it at the default and
  keeps the 20ms row above.
- **The metadata engine** is `META`, so Redis needs no code change. It is not a
  cache in front of Postgres — JuiceFS has no such mode — but a different
  filesystem, reached by `juicefs dump` and `juicefs load` with the volumes
  unmounted. It trades Postgres's durability for memory-resident metadata.

## What this is and is not good for

JuiceFS is a filesystem, so the usual caveat about object-storage mounts does
not apply: random writes do not rewrite whole objects, `rename` is not a
copy-then-delete, and locks work across nodes. A session log, a SQLite file, or
a build cache is fine here.

The dependency that replaces it is the metadata database. Every node that mounts
must reach it, and a client that loses it keeps its mount in the table while
answering `EIO` to every call — which is why the plugin checks that the shared
mount can be *read* rather than that it exists, and replaces it when it cannot.
Losing the database is losing every volume at once, so it belongs wherever the
deployment's other durable state is backed up.

`refCount` is per node: two sandboxes on one node share the single client, and
the same volume on a second node mounts its own.

## Checking a node

```sh
./install-deps.sh --check-only    # reports jq, juicefs, /dev/fuse; changes nothing
sudo ./install-deps.sh            # installs what is missing
```

The hooks check the same things, but they run when a tenant is already waiting.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| `unknown driver: juicefs` | CubeMaster's `volume_plugins` is missing the entry, or it was not restarted |
| `no plugin registered for driver "juicefs"` | Cubelet is missing the same-name entry, or it was not restarted |
| `missing on this node: juicefs` | run `install-deps.sh` there |
| every call returns `EIO` | the metadata database is unreachable; the plugin replaces the mount once it is back |
| every attach hangs ~30s, then CubeSandbox answers create with `408` | the shared mount is wedged. `timeout 5 ls $SHARED_MOUNT` to confirm, then read the JuiceFS client's log — a metadata database that has gone *missing* rather than merely unreachable looks like this |
| attach fails to mount | `ls /dev/fuse`, then run the mount by hand to read JuiceFS's own error |
| a tenant sees `EDQUOT` | their volume is full — `juicefs quota get $META --path /volumes/<id>` |

## Installing

**The metadata database is the filesystem.** Not a cache of it and not a copy:
lose it and every tenant's files are gone, however intact the object store is.
So think once about where it lives before pointing `META` at anything.

Pointing it at the deployment's own Postgres works and is one fewer thing to
run — and it means `docker compose down -v`, which is an ordinary thing to do
to a deployment, destroys every tenant's files as a side effect. That has
happened here: the volume was dropped during a rebuild, the shared mount
wedged, every attach hung for 30 seconds, and CubeSandbox answered every
create with a `408` that says nothing about why. If it does live there, say so
where the teardown is written down, because nothing about the command mentions
JuiceFS.

```sh
# once, anywhere that can reach both the database and the object store
createdb -h host -U user juicefs

# A file create spends several metadata commits, and each durable one costs a
# WAL fsync — 2.9ms against 0.33ms without, which is most of what a create
# costs once WRITEBACK is on. Scoped to this database, so the deployment's
# accounts and tokens keep their default durability. The trade is the last
# fraction of a second of metadata on an unclean shutdown; see Performance.
psql -h host -U user -d postgres \
  -c "ALTER DATABASE juicefs SET synchronous_commit = off"

juicefs format --storage s3 --bucket http://<endpoint>/<bucket> \
  --access-key <key> --secret-key <secret> --capacity 100 \
  postgres://user:pass@host:5432/juicefs?sslmode=disable dsh-volumes

# on every CubeMaster and Cubelet node
install -m 755 cube-volume-juicefs /usr/local/services/cubetoolbox/CubeMaster/plugin/
install -m 755 cube-volume-juicefs /usr/local/services/cubetoolbox/Cubelet/plugin/
install -m 600 volume-juicefs.conf /usr/local/services/cubetoolbox/CubeMaster/plugin/
install -m 600 volume-juicefs.conf /usr/local/services/cubetoolbox/Cubelet/plugin/
```

```yaml
# CubeMaster conf.yaml
volume_plugins:
  - name: juicefs
    type: binary
    binary_path: /usr/local/services/cubetoolbox/CubeMaster/plugin/cube-volume-juicefs
```

```toml
# Cubelet config.toml
[[plugins."io.cubelet.internal.v1.storage".volume_plugins]]
  name        = "juicefs"
  type        = "binary"
  binary_path = "/usr/local/services/cubetoolbox/Cubelet/plugin/cube-volume-juicefs"
```

Both names must match, and both components must be restarted. Node
dependencies: `juicefs` and `jq`.

The metadata database must be reachable from every node that mounts. A client
that loses it keeps its mount in the table and answers `EIO` to every call, so
the plugin checks that the shared mount can be *read* rather than that it exists,
and replaces it when it cannot.

## The contract

Four hooks, one subprocess per call, one JSON line on stdout. `create` and
`destroy` are CubeMaster's; `attach` and `detach` are Cubelet's, and carry a
node-local `refCount` — attach at 0 is the first sandbox on this node, detach at
0 is the last. The shipped Tencent COS example is the reference for all of it.
