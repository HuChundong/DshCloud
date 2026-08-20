#!/bin/bash
# Start one tenant's dsh backend and the tunnel that reaches it.
#
# bash, not sh: `wait -n` is a bash builtin and the image's /bin/sh is dash.
#
# dsh keeps its default loopback binding: nothing outside this container may
# talk to it, and the tunnel client's loopback-rewritten requests are what carry
# browser traffic in. That is also what keeps the loopback-pinned configuration
# methods (settings.*, credentials.*, agentPreset.*, host.*) reachable.
set -eu

# The image's own environment. Sourced rather than inherited because only one
# of the two ways this is started passes it on: a container gets the image's
# `ENV`, but envd — which starts this under CubeSandbox — hands its processes a
# clean environment instead. Sourcing makes both paths identical, and is a
# no-op on the one that already had it.
# shellcheck source=/dev/null  # written by the image build, absent from the tree
. /app/sandbox/env.sh

# The tenant's own state, all of it under one mount.
#
# One CubeSandbox volume is attached at `/mnt`, backed by a prefix in an
# S3-compatible bucket whose store is a fixed-size filesystem — so a tenant's
# writes are bounded by something other than the host's free space.
#
# THE PATHS DO NOT DEPEND ON WHETHER THAT VOLUME EXISTS. With one, `/mnt` is
# the volume and everything under it survives the sandbox; without one — the
# Docker simulation — `/mnt` is the image's writable layer and it does not.
# That is the only difference. It is written this way on purpose: every path
# that existed only when a volume did, or only when one did not, was a path
# whose failure was discovered in production. The workspace used to be a
# symlink into the volume and a real directory without one, and `find` does
# not follow a symlink named on its command line — so the canvas found nothing
# in production and everything in the simulation.
#
# Nothing is linked or bound out to a second name. Which path the workspace has
# was always ours to choose: dsh takes its workspace root from the working
# directory it is started in, and `DSH_HOME` is an environment variable. So
# both are simply told where they already are.
mkdir -p "$WORKSPACE" "$DSH_HOME"

# The one thing here that belongs to the IMAGE rather than to the tenant.
#
# `profiles/` holds the composed web profile, this project's plugins, and
# `node_modules` linked into /src, and the harness hardcodes its location at
# `$DSH_HOME/profiles` — so a directory that is half the tenant's and half the
# image's is not a choice this can avoid. It is a link back to the image's own
# copy, remade on every boot, so an upgrade can never leave a stale profile or
# a dangling link behind.
#
# It sits inside DSH_HOME and not inside the workspace, which is what keeps it
# out of everything that walks the tenant's files.
ln -sfn "$IMAGE_DSH_HOME/profiles" "$DSH_HOME/profiles"

# env.sh is what the acceptance suite and every probe read to learn the
# environment the backend runs with, and DSH_HOME has just moved. Corrected
# rather than left to disagree.
sed -i "s|^export DSH_HOME=.*|export DSH_HOME=$DSH_HOME|" /app/sandbox/env.sh

# Carry the workspace registry across a change of mount point.
#
# Grouping is by recorded absolute path, so a registration made when the volume
# was mounted somewhere else points at a directory that no longer exists — and
# its sessions, still present and still listed, show up ungrouped. Run before
# the backend so it never reads the stale registry. Idempotent, and a failure
# here is not worth refusing to start over: the worst it costs is the grouping
# this repairs.
node /app/sandbox/migrate-storage-paths.mjs "$DSH_HOME" "$WORKSPACE" || \
  echo "sandbox: workspace registry migration failed; grouping may be stale"

# The harness as the registry publishes it. DSH is a dependency of this
# deployment rather than part of it, so a tenant runs the same `lib/bin.js` the
# npm package ships as `dsh`, at the version the image was built with.
#
# Started from the tenant's workspace, not from wherever the harness lives. dsh
# takes its sandbox policy's workspace root from the process's working
# directory, so starting it anywhere else would make that directory the tenant's
# workspace — and with full access inside the container, the agent's default
# working directory would have been the harness's own installation.
cd "$WORKSPACE"
node "$DSH_BIN" web --patch /app/sandbox/cordis.patch.yml --port 3080 &
DSH_PID=$!

# The tunnel is a plugin in the composition above, not a second process, so
# there is one thing to wait on and nothing to keep in step with it.
wait "$DSH_PID"
