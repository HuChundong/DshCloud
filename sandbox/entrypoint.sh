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

# Point the tenant's own state at their volume, when they have one.
#
# One CubeSandbox volume is attached at `/persist`, backed by a prefix in an
# S3-compatible bucket whose store is a fixed-size filesystem — so a tenant's
# writes are bounded by something other than the host's free space. Without the
# volume every path below stays where it was and the sandbox is ephemeral,
# which is what the Docker simulation gets.
#
# Symlinks rather than mounting `$DSH_HOME` itself, because only part of that
# directory is the tenant's. `profiles/` is built into the image — it holds the
# composed web profile, the sign-out plugin, and `node_modules` symlinks into
# /src — so a mount over it would shadow the image's copy with a stale one and
# leave dangling links after an upgrade.
#
# `/workspace` is a symlink into the volume rather than a second mount: a volume
# is attached at one path, and the tenant's files and the harness's state are
# both theirs and belong on the same one.
if [ -d /persist ]; then
  mkdir -p /persist/workspace /persist/dsh
  for entry in sessions storages attachments skills .agent-presets; do
    mkdir -p "/persist/dsh/$entry"
  done
  # The files are linked without being created: dsh writes through the link, and
  # the target appears on the volume the first time it does.
  for entry in sessions storages attachments skills .agent-presets \
               settings.yaml .credentials.yaml AGENTS.md .anonymous-user-id cordis.patch.yml; do
    ln -sfn "/persist/dsh/$entry" "$DSH_HOME/$entry"
  done
  # Replaced rather than mounted over, so the working directory below resolves
  # to the volume. The image's /workspace is empty, so nothing is lost.
  rmdir /workspace 2>/dev/null && ln -sfn /persist/workspace /workspace
fi

# The harness as the registry publishes it. DSH is a dependency of this
# deployment rather than part of it, so a tenant runs the same `lib/bin.js` the
# npm package ships as `dsh`, at the version the image was built with.
#
# Started from the tenant's workspace, not from wherever the harness lives. dsh
# takes its sandbox policy's workspace root from the process's working
# directory, so starting it anywhere else would make that directory the tenant's
# workspace — and with full access inside the container, the agent's default
# working directory would have been the harness's own installation.
cd /workspace
node "$DSH_BIN" web --patch /app/sandbox/cordis.patch.yml --port 3080 &
DSH_PID=$!

# The tunnel is a plugin in the composition above, not a second process, so
# there is one thing to wait on and nothing to keep in step with it.
wait "$DSH_PID"
