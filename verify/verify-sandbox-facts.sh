#!/bin/sh
# What the acceptance run needs to know from inside a tenant's sandbox, as
# `key=value` lines.
#
# Read from `/proc` rather than from a shell's own environment, because the
# question is what the backend process actually runs with. Under CubeSandbox the
# backend is started by envd with an environment the acceptance run's own shell
# never has, so asking that shell would answer about the wrong process.
#
# Fed to the sandbox base64-encoded, so that neither `docker exec sh -c` nor
# envd's `bash -l -c` has to survive the quoting.

for p in /proc/[0-9]*; do
  grep -qa 'lib/bin.js' "$p/cmdline" 2>/dev/null || continue
  echo "cmdline=$(tr '\0' ' ' < "$p/cmdline")"
  # dsh takes its sandbox policy's workspace root from the working directory.
  # Reported as the path it resolves to, which is now one name: the workspace
  # is a real directory on the tenant's mount. It used to be a symlink onto the
  # volume, so a resolved cwd printed either of two names depending on whether
  # a volume existed. What is being checked is that this is the tenant's own
  # directory rather than the harness's installation.
  echo "cwd=$(readlink "$p/cwd")"
  # PATH among them, because the tools an agent reaches for are only on it if
  # the entrypoint's environment file carried it: envd starts this process with
  # a clean environment, and anything installed outside the default directories
  # — the Python virtualenv, in particular — is invisible without it.
  tr '\0' '\n' < "$p/environ" | grep -E '^(DSH_PERMISSION_MODE|NODE_ENV|PATH|DSH_BUNDLED_SKILL_DIR)='
  break
done

# The listening address of the backend's own port (3080 is 0C08 in the hex
# `/proc/net/tcp` uses). Loopback — 0100007F — is what makes the tunnel the only
# way in: a sandbox that bound every interface would be reachable directly by
# anything that could route to it.
echo "listen=$(sed -n 's/^ *[0-9]*: \([0-9A-F]*:0C08\) .*/\1/p' /proc/net/tcp | head -1)"

# Nothing should transpile at boot: through tsx the same entry took 9s to serve
# /api against 2s for the artifact.
#
# `ts[x]` matches the same processes without matching this grep's own command
# line, which is itself in `/proc` while it runs and otherwise makes the count
# read 1 forever.
echo "tsx=$(grep -lsa 'ts[x]/esm' /proc/[0-9]*/cmdline 2>/dev/null | wc -l | tr -d ' ')"
