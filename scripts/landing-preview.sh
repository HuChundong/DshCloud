#!/usr/bin/env bash
# The landing page, assembled the way both of its deployments assemble it, and
# served locally.
#
# It exists because the page cannot be opened from the tree: it references its
# images as `assets/…`, and they live in `docs/assets`. Opening
# `web/landing/index.html` directly shows the page with every screenshot
# missing, which reads as a broken page rather than an unassembled one — so
# this stages the same two copies the Dockerfile and the Pages workflow make.
#
# Usage: scripts/landing-preview.sh [port]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${1:-8100}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

# Symlinks rather than copies, which is the difference between a preview and a
# snapshot: copies are taken once, so every edit made while this is running is
# invisible until it is restarted — which reads as "the change did nothing".
# `python3 -m http.server` follows them.
# Everything the page directory holds, by glob rather than by name: a file
# added there — a font, an image — would otherwise be missing from the preview
# only, which is the most confusing place for it to be missing from.
ln -s "$root"/web/landing/* "$out/"
ln -s "$root/docs/assets" "$out/assets"
ln -s "$root/gateway/assets/mark.svg" "$out/mark.svg"
ln -s "$root/gateway/assets/wechat-qr.webp" "$out/wechat-qr.webp"

echo "landing page on http://localhost:${port}/ — ctrl-c to stop"
cd "$out"
python3 -m http.server "$port" --bind 127.0.0.1
