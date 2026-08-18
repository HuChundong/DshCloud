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

  # The harness's state directory MOVES onto the volume, rather than being
  # assembled out of one symlink per entry.
  #
  # It was the latter until a tenant reported that settings did not survive a
  # restart, and the reason is worth keeping: dsh writes settings.yaml with
  # writeFileAtomic, which renames a temporary file over the target — and a
  # rename replaces the SYMLINK rather than writing through to its referent.
  # Upstream does that on purpose and says so: refusing to follow a link is
  # what stops a planted one from redirecting a privileged write. So the first
  # save turned the link into an ordinary file in the container's writable
  # layer, and every setting after it died with the sandbox. Directories
  # survived because a rename inside one does not touch the directory itself,
  # which is why sessions and skills persisted and settings did not.
  #
  # profiles/ is the one thing here that belongs to the image — the composed
  # web profile and this project's plugins, with node_modules linked into /src
  # — so it points back at the image's copy. Recreated on every boot, so an
  # upgrade cannot leave a stale profile or a dangling link behind.
  ln -sfn "$DSH_HOME/profiles" /persist/dsh/profiles
  DSH_HOME=/persist/dsh
  export DSH_HOME
  # env.sh is what the acceptance suite and every probe read to learn the
  # environment the backend runs with, and it has just stopped being right
  # about this one. Corrected rather than left to disagree.
  sed -i "s|^export DSH_HOME=.*|export DSH_HOME=$DSH_HOME|" /app/sandbox/env.sh
  # The tenant's files, moved onto the volume.
  #
  # This was `rmdir /workspace && ln -sfn`, on the stated grounds that the
  # image's /workspace is empty — and it stopped being empty. HOME is
  # /workspace, so the npm the image build runs left a .npm cache there, rmdir
  # refused a non-empty directory, the `&&` swallowed it, and every tenant's
  # files went to the container's writable layer and died with the sandbox.
  # The session directory names recorded the whole thing: early ones read
  # --persist-workspace-1234--, later ones --workspace-DSH--.
  #
  # So: no precondition on the directory being empty, and no silent branch.
  # Whatever the image left there is moved across on the first boot with a
  # volume, and the link is then remade unconditionally.
  if [ ! -L /workspace ]; then
    if [ -d /workspace ]; then
      # Dotfiles included, and a name that cannot collide with a tenant's.
      find /workspace -mindepth 1 -maxdepth 1 -exec mv -n {} /persist/workspace/ \; 2>/dev/null || true
      rm -rf /workspace
    fi
    ln -sfn /persist/workspace /workspace
  fi
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
