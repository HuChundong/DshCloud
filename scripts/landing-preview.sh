#!/usr/bin/env bash
# The landing page, served with a dev server that reloads as it is edited.
#
# This used to stage the page by hand — a temporary directory of symlinks
# standing in for the copies the Dockerfile and the Pages workflow each make —
# because the page could not be opened from the tree: it names the gateway's
# marks by their real path, and a browser opening the file directly resolved
# those against the filesystem rather than against a root.
#
# Vite resolves them, so there is nothing to stage. What runs here is the same
# build definition the image and the published page are built from, which is
# the point: a preview assembled its own way is a preview that can disagree
# with both of them.
#
# Usage: scripts/landing-preview.sh [port]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${1:-8100}"

cd "$root/web/landing"
# First run in a fresh checkout, and after a dependency changes. `npm ci` is
# quiet about the ordinary case where nothing has.
[ -d node_modules ] || npm ci --no-audit --no-fund

exec npm run dev -- --port "$port" --strictPort
