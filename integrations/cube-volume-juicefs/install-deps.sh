#!/usr/bin/env bash
# Install, or just report, what `cube-volume-juicefs` needs on this node.
#
# The hooks check too, but they run when a tenant is already waiting. This is
# the same question asked before a deployment starts answering requests, and
# `--check-only` makes it safe to ask on a node you are not allowed to change.
#
#   ./install-deps.sh --check-only    # report, change nothing
#   sudo ./install-deps.sh            # install what is missing
#
# JuiceFS is fetched from its GitHub releases because no distribution packages
# it. `JUICEFS_VERSION` pins which one; `JUICEFS_MIRROR` prefixes the download
# for networks that cannot reach GitHub directly.

set -euo pipefail

JUICEFS_VERSION="${JUICEFS_VERSION:-1.4.1}"
JUICEFS_MIRROR="${JUICEFS_MIRROR:-}"
CHECK_ONLY=0

[[ "${1:-}" == "--check-only" ]] && CHECK_ONLY=1

log()  { echo "[install-deps] $*"; }
have() { command -v "$1" > /dev/null 2>&1; }

report() {  # report <command> <what it is for>
  if have "$1"; then
    log "OK      $1 — $2"
    return 0
  fi
  log "MISSING $1 — $2"
  return 1
}

missing=0
report jq      "the JSON the hooks write on stdout"            || missing=1
report juicefs "mounting the filesystem volumes live in"       || missing=1
# Not a command, but the one absence that turns every attach into a mount
# failure with nothing to read.
if [[ -e /dev/fuse ]]; then
  log "OK      /dev/fuse — FUSE is available"
else
  log "MISSING /dev/fuse — load the fuse module; attach cannot mount without it"
  missing=1
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if [[ "$missing" -eq 0 ]]; then
    log "this node is ready"
  else
    log "this node is missing dependencies"
  fi
  exit "$missing"
fi
[[ "$missing" -eq 0 ]] && { log "nothing to install"; exit 0; }

[[ "$(id -u)" -eq 0 ]] || { log "ERROR: installing needs root; re-run with sudo, or use --check-only"; exit 1; }

if ! have jq; then
  log "installing jq"
  if have apt-get; then apt-get install -y -qq jq
  elif have dnf; then dnf install -y -q jq
  elif have yum; then yum install -y -q jq
  else log "ERROR: no known package manager; install jq yourself"; exit 1
  fi
fi

if ! have juicefs; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64)  arch=amd64 ;;
    aarch64) arch=arm64 ;;
    *) log "ERROR: no JuiceFS build for ${arch}"; exit 1 ;;
  esac
  url="https://github.com/juicedata/juicefs/releases/download/v${JUICEFS_VERSION}/juicefs-${JUICEFS_VERSION}-linux-${arch}.tar.gz"
  [[ -n "$JUICEFS_MIRROR" ]] && url="${JUICEFS_MIRROR%/}/${url}"
  log "fetching ${url}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/juicefs.tar.gz" "$url"
  tar -xzf "$tmp/juicefs.tar.gz" -C "$tmp" juicefs
  install -m 755 "$tmp/juicefs" /usr/local/bin/juicefs
  log "installed $(juicefs version)"
fi

log "done"
