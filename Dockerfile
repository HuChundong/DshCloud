# syntax=docker/dockerfile:1
#
# The three images this deployment runs, from one context.
#
# DSH itself is installed from npm rather than built here. It is a dependency of
# this project, not part of it: nothing in this repository patches the harness,
# and what a tenant runs is the `dsh` the registry publishes. Upgrading is a
# version bump plus the acceptance run.
#
# Stages:
#   deps     one npm install, shared by everything below
#   sandbox  one tenant's dsh, beside this project's three plugins
#   shell    boot the composition once and save what it serves
#   web      nginx over the frontend build and that shell
#   gateway  the authenticating front door; no harness code at all

# The harness version this deployment runs. A build argument rather than a
# lockfile entry, so a deployment can move between published versions without
# editing a file that also pins this project's own dependencies.
#
# Declared here, before any FROM, because two stages need it and a default
# declared inside one is invisible to the others: `deps` installs this version,
# and `gateway` puts it on the login page. Each re-declares a bare `ARG
# DSH_VERSION` to bring this default into its own scope — which is the only way
# to read it after a FROM, and which is what was missing when the footer went
# blank.
ARG DSH_VERSION=0.1.1-rc.1

# ------------------------------------------------------------------- deps ----
FROM node:24-slim AS deps

ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null \
      || sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list; \
    fi

# node-pty ships no linux/arm64 prebuild and dsh's terminal sessions need it, so
# the toolchain is here and stays out of the runtime images below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ARG DSH_VERSION

# An npm registry to install from. Empty uses the public one; a deployment far
# from it names a mirror rather than waiting out ~200 packages.
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

WORKDIR /app
# `dsh-web-frontend` is named outright. cordis resolves plugins by package name
# at load time, so which packages a composition needs is not derivable from the
# dependency graph — and the frontend is not reachable from `dsh` through it.
#
# Pinned to the same version, which it was not: unpinned, npm resolves the
# `latest` tag, and upstream's `latest` for this package points at 0.0.1-rc.5
# while the harness is on 0.1.0-rc.8 — a shell four releases behind the backend
# it renders, chosen silently at build time. The two halves ship as one release
# and are installed as one.
RUN npm install --omit=dev --no-audit --no-fund \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      "@deepseek-ai/dsh-web-frontend@${DSH_VERSION}"


# Declared before any FROM that interpolates it: `FROM envd-${TARGETARCH}`
# below is resolved while the stage graph is built, not while it runs.
ARG TARGETARCH

# ----------------------------------------------------------- cube-tools ----
# Where `cube-entrypoint.sh` comes from: CubeSandbox's own base image.
#
# Pinned to amd64 because that is the only platform the tag is published for,
# and leaving it to the build platform fails outright on an arm64 host — which
# is every Apple Silicon laptop this is developed on. Only a shell script is
# taken from it, so the pin costs a pull and nothing else; the binary that has
# to match the build's architecture is compiled below instead.
FROM --platform=linux/amd64 ghcr.io/tencentcloud/cubesandbox-base:2026.16 AS cube-tools

# ---------------------------------------------------------------- envd ----
# envd, for the architecture this image is being built for.
#
# It is the same binary either way, from the same upstream at the same ref —
# only the way of getting one differs, because CubeSandbox publishes its base
# image for amd64 alone.
#
# On amd64 that published binary IS the answer, and taking it keeps the
# production build what it was: no Go toolchain, no clone, nothing between the
# server and an image it can already build offline.
#
# On arm64 there is nothing to take, and it used to not matter — the simulation
# never started envd, so an amd64 binary sat there inert. It matters now: the
# panel's whole file plane is envd, so a local build that cannot run it is a
# local build where half the product cannot be developed. `docker/Dockerfile.cube-base`
# in CubeSandbox compiles `e2b-dev/infra` at this tag, and this does the same,
# for the other architecture. Static, CGO off, no runtime dependencies.
#
# Selected by `FROM envd-${TARGETARCH}` rather than by a shell branch, so the
# stage that is not wanted is never built — an arm64 build never runs the
# amd64 image, and an amd64 build never clones anything.
FROM scratch AS envd-amd64
COPY --from=cube-tools /usr/bin/envd /envd

FROM golang:1.25.4-bookworm AS envd-arm64
# Kept in step with CubeSandbox's `ENVD_REF_DEFAULT`. Raising it here without
# raising it there gives sandboxes an envd their CubeMaster was not built
# against.
ARG ENVD_REF=2026.16
RUN git clone --depth 1 --branch "$ENVD_REF" https://github.com/e2b-dev/infra.git /src/infra
WORKDIR /src/infra/packages/envd
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
      go build -a -ldflags '-s -w' -o /envd . \
    && /envd -version

FROM envd-${TARGETARCH} AS envd

# ----------------------------------------------------------- agent-build ----
# The small resident tools a sandbox runs for the gateway.
#
# Rust because of where this runs. A sandbox is one machine per tenant, so
# everything resident in it is paid for once per tenant — and what this
# replaced was `node -e '<script>'`, 21MB of resident memory and a second of
# start-up to poll a local HTTP endpoint every five seconds. This is a static
# binary with no dependencies: 1.5MB resident, and it starts in the time it
# takes to open a socket.
#
# Built natively, on the architecture it will run on. Each platform builds its
# own — the deployment is amd64 and builds there — so there is no
# cross-compilation to arrange and nothing to download: the native target's
# standard library is already in the image, the crate has no dependencies, and
# `--offline` states both rather than discovering them.
#
# Cross-compiling was tried and is worse for this. `rustup target add` fetches a
# standard library for the other target, which is a network round trip that
# takes longer than everything else here put together and is the one thing that
# can fail on a slow link.
#
# The binary is NOT run here. That check belongs in the `sandbox` stage, which
# is the image it will actually run in: a binary that cannot execute there is a
# build failure rather than a sandbox that quietly reports nothing.
FROM rust:1.89-bookworm AS agent-build
WORKDIR /agent
COPY sandbox/agent/Cargo.toml ./
COPY sandbox/agent/src ./src
RUN cargo build --release --offline && install -Dm755 target/release/dsh-agent /out/dsh-agent

# ---------------------------------------------------------- panel-build ----
# The right-hand panel's browser half, bundled.
#
# The only package here that is built rather than served verbatim, because it
# is the only one with a dependency the shell does not provide: the terminal's
# renderer. Bundling it into the plugin rather than dropping it beside the
# shell is what keeps the plugin a plugin — one that another dsh deployment
# could install without first being told to place a file somewhere.
#
# `package.json` first and the sources after, so a change to the panel's code
# does not reinstall its toolchain.
FROM node:24-slim AS panel-build

ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

WORKDIR /panel
# `/dsh-icons`, because the panel declares it as `file:../dsh-icons` relative to
# this WORKDIR. It carries the glyphs the harness set has no drawing for; the
# rest of the panel's icons are the shell's own and arrive through the module
# table at runtime, so nothing of them is installed here.
COPY packages/dsh-icons /dsh-icons
COPY packages/dsh-artifact-panel/package.json ./
RUN npm install --no-audit --no-fund
COPY packages/dsh-artifact-panel/build.mjs ./
COPY packages/dsh-artifact-panel/src ./src
RUN npm run build

# ---------------------------------------------------------------- sandbox ----
FROM node:24-slim AS sandbox

# The resident tools, before anything that might want them. See `agent-build`
# for why they are a compiled binary rather than a script.
#
# Run once, here, because here is the target architecture: a binary built for
# the other one answers `exec format error`, and this is the last moment that
# is a build failure rather than a sandbox that quietly reports nothing.
COPY --from=agent-build /out/dsh-agent /usr/local/bin/dsh-agent
RUN dsh-agent 2>&1 | grep -q 'unknown command'

ARG APT_MIRROR=
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null \
      || sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list; \
    fi

# What a tenant's agent reaches for, and nothing that built the tree it runs.
#
# The base already has grep, sed, awk, find, xargs, diff, tar, and gzip. What is
# added is what an agent asks for and does not find, in four groups:
#
#   search and text     rg, fd, jq, less, tree, patch, file
#   fetch and archive    curl, unzip, zip, p7zip-full, zstd, xz-utils,
#                        libarchive-tools
#   documents and data   sqlite3, poppler-utils, plus the Python stack below
#   reachability         dnsutils, iputils-ping, iproute2, netcat-openbsd
#
# `make` because repositories are entered through it. `fontconfig` and
# `fonts-wqy-microhei` because a chart with CJK labels renders as boxes without
# them, and this deployment's tenants write Chinese. `libmagic1` and `libgomp1`
# are runtime dependencies of the wheels below, not tools in their own right.
#
# Measured while trimming, because two of these are not obvious: `libgl1` costs
# 41 packages and 49 MB of downloads for an OpenGL stack that nothing here uses
# — matplotlib draws through Agg — and `unar` costs 18 packages of GNUstep to
# read archives `bsdtar` already reads. Both are in the list this borrows from,
# for a runtime this one does not have.
#
# Still left out, and why: `wget` (curl covers it), `rsync` (nothing here copies
# between hosts), `openssh-client` (clones go over https), editors and `htop`
# (an agent edits through its tools, not through a TUI), `pandoc`, `ffmpeg` and
# `imagemagick` (each costs more than the conversions it would add), a compiler
# (every wheel below is prebuilt for this platform; a source build is the one
# thing a tenant has to install for itself), and database drivers (`pip` is
# here now, and one deployment's databases are not another's).
#
# `tzdata` is here so the timezone below resolves to something on a slim base.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git ca-certificates procps tzdata make \
       curl jq ripgrep fd-find less tree patch file \
       unzip zip p7zip-full zstd xz-utils libarchive-tools \
       sqlite3 poppler-utils \
       dnsutils iputils-ping iproute2 netcat-openbsd \
       fontconfig fonts-wqy-microhei \
       python3 python3-venv libmagic1 libgomp1 \
  && ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

# A Python an agent can actually install into.
#
# Debian 12 marks its system Python externally managed (PEP 668), so
# `pip install` there fails by design and `--break-system-packages` is a way of
# saying the design was wrong. A virtualenv on PATH answers both halves: the
# stack below is present without asking, and a tenant who needs something else
# gets an ordinary `pip install` that cannot damage the distribution's Python.
#
# What is in it is what an agent is asked to do with files it is given —
# spreadsheets, PDFs, tabular data, charts, archives — and nothing about any
# particular business.
#
# Deliberately absent, each measured in the built image before it was cut:
# `pyarrow` (152 MB, and duckdb reads and writes parquet in 58), `plotly`
# (42 MB, and what a chat window can show is the static image matplotlib
# already draws), `zstandard` (23 MB for what the `zstd` binary above does to
# files), scipy and scikit-learn (together more than everything kept), and
# every database driver — one deployment's databases are not another's. Each is
# one `pip install` away, through the mirror configured below.
ENV VIRTUAL_ENV=/opt/agent-python
ENV PATH=/opt/agent-python/bin:$PATH
#
# The index is written to /etc/pip.conf rather than passed on the command line,
# so a tenant's own `pip install` reaches the same mirror this build did. A
# deployment far from PyPI that only mirrored the build would leave every
# tenant waiting on the default index.
#
# Name one the build host can reach rather than one that is merely nearby. A
# university mirror answered 403 to this deployment's machine while the cloud
# mirror beside it answered in 0.1s, and what pip reports for a refused index
# is "no matching distribution found for pandas" — a sentence about the package,
# for a problem with the index.
ARG PIP_INDEX_URL=
RUN if [ -n "$PIP_INDEX_URL" ]; then \
      printf '[global]\nindex-url = %s\n' "$PIP_INDEX_URL" > /etc/pip.conf; \
    fi
# What the agent can reach for, as an argument rather than a fixed list.
#
# The default is the deployment's answer and the only one a tenant should ever
# meet. It is an argument so that a build which is not for tenants can ask for
# less: this is the slowest step in the image by a wide margin, and a checkout
# being exercised for its gateway and its frontend does not need pandas to find
# out whether a page renders. Set it empty and the environment is still created
# and still on PATH — there is simply nothing in it.
ARG AGENT_PYTHON_PACKAGES="pandas duckdb sqlalchemy tabulate \
       openpyxl xlsxwriter xlrd pyxlsb odfpy \
       pdfplumber pillow matplotlib \
       lxml beautifulsoup4 markdownify jinja2 \
       python-magic py7zr rarfile charset-normalizer requests"
RUN python3 -m venv "$VIRTUAL_ENV" \
  && pip install --no-cache-dir --upgrade pip \
  && if [ -n "$AGENT_PYTHON_PACKAGES" ]; then \
       pip install --no-cache-dir --retries 5 --timeout 120 $AGENT_PYTHON_PACKAGES; \
     else \
       echo 'build: AGENT_PYTHON_PACKAGES is empty; the agent gets a bare environment'; \
     fi \
  && find "$VIRTUAL_ENV" -name '__pycache__' -type d -prune -exec rm -rf {} + \
  && rm -rf /root/.cache/pip

# Matplotlib without a display, and with a writable place for its font cache.
# Absent both, the first chart an agent draws either fails to pick a backend or
# rebuilds the font cache into a directory it may not own.
ENV MPLBACKEND=Agg
ENV MPLCONFIGDIR=/root/.config/matplotlib

# OfficeCLI: one binary that reads and writes the formats people actually
# attach — xlsx, docx, pptx, pdf — without a headless office suite behind it.
# The Python stack above reads those formats; this is what edits them.
#
# Pinned by version AND checksum, from the vendor's own CDN because it answers
# from inside China where GitHub releases often do not. `OFFICECLI_SKIP_UPDATE`
# because a tenant's sandbox must not fetch a new binary for itself: what runs
# here is what the template was built from, and egress is fenced anyway.
ARG OFFICECLI_VERSION=v1.0.144
ARG OFFICECLI_SHA256_AMD64=32ef7a21a54a4ca6c9806bf5e9f3d32bfb1291017329c55044cb2aac71822eb8
ARG OFFICECLI_SHA256_ARM64=56ec2c3114b66f6490888b6778cbb8413a65911a26cacc7207f29e13424966da
ARG TARGETARCH
ENV OFFICECLI_SKIP_UPDATE=1
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) asset=officecli-linux-x64;   sum="$OFFICECLI_SHA256_AMD64" ;; \
      arm64) asset=officecli-linux-arm64; sum="$OFFICECLI_SHA256_ARM64" ;; \
      *) echo "unsupported OfficeCLI architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 -o /usr/local/bin/officecli \
      "https://d.officecli.ai/releases/download/${OFFICECLI_VERSION}/${asset}"; \
    echo "${sum}  /usr/local/bin/officecli" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/officecli; \
    officecli --version

# The skill that tells an agent how to drive it.
#
# Written by the binary rather than by this repository: OfficeCLI ships its own
# agent skill and updates it with itself, so a copy kept here would be a second
# source of truth that silently ages against the version pinned above. The
# format is the one dsh's filesystem provider reads — a directory holding a
# `SKILL.md` with `name` and `description` frontmatter — because that is also
# Claude Code's, which is the flavour asked for here.
#
# `skills install` writes into whichever agent homes it detects, so it is given
# a scratch one and the result is moved where this deployment wants it.
#
# Only the base skill. The specialized ones (pitch-deck, financial-model,
# morph-ppt, …) are reachable from the binary at the moment they are needed —
# `officecli load_skill <name>` prints any of them — so putting all eleven in
# the catalog would spend a description line in every request for ten skills a
# tenant may never open.
ENV DSH_BUNDLED_SKILL_DIR=/opt/dsh-skills
RUN set -eux; \
    scratch=$(mktemp -d); \
    mkdir -p "$scratch/.claude" "$DSH_BUNDLED_SKILL_DIR"; \
    HOME="$scratch" officecli skills install; \
    mv "$scratch/.claude/skills/officecli" "$DSH_BUNDLED_SKILL_DIR/officecli"; \
    rm -rf "$scratch"; \
    grep -q '^name: officecli$' "$DSH_BUNDLED_SKILL_DIR/officecli/SKILL.md"

# pnpm and yarn, for a repository that is entered through one of them. Corepack
# ships with node; enabling it costs two shims rather than two installs.
#
# The registry is written to npm's global config rather than to a home
# directory: `HOME` is the tenant's volume, so a per-user npmrc would be
# something every sandbox writes for itself and nothing the image can promise.
# pnpm reads the same file.
ARG NPM_REGISTRY=
RUN corepack enable \
 && if [ -n "$NPM_REGISTRY" ]; then npm config set --location=global registry "$NPM_REGISTRY"; fi

ENV NODE_ENV=production

# The clock a tenant's agent reads. Containers default to UTC, so a sandbox
# would date every file and every log an hour count away from the person using
# it.
ARG TZ=UTC
ENV TZ=${TZ}
RUN ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime && echo "$TZ" > /etc/timezone

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY sandbox/entrypoint.sh sandbox/migrate-storage-paths.mjs sandbox/cordis.patch.yml ./sandbox/
RUN chmod +x /app/sandbox/entrypoint.sh

# The entry a tenant's backend runs: the same `lib/bin.js` the npm package ships
# as `dsh`, named explicitly so the entrypoint does not depend on PATH.
ENV DSH_BIN=/app/node_modules/@deepseek-ai/dsh/lib/bin.js

# Everything of the tenant's lives under one mount, and the paths are the same
# whether or not a volume is attached — see `sandbox/entrypoint.sh` for why that
# sameness is the point rather than a convenience.
ENV MOUNT=/mnt
ENV WORKSPACE=/mnt/workspace

# Where the IMAGE keeps its own harness home. Only `profiles/` in here is ever
# used at runtime: the entrypoint links it into the tenant's DSH_HOME, because
# the harness hardcodes that location and that one directory belongs to the
# image rather than to the tenant.
ENV IMAGE_DSH_HOME=/root/.dsh

# THE BUILD RUNS AGAINST THE IMAGE'S HOME. Everything below that composes a
# profile writes into it — `--dump-config` materializes the flat fallback
# `profiles/node_modules`, and the plugin install fills `profiles/web`. Pointing
# DSH_HOME at the mount this early sent both into a directory that only exists
# at runtime, and the image shipped a profile the harness could not boot.
# It is switched to the tenant's home further down, before `env.sh` records it.
ENV DSH_HOME=$IMAGE_DSH_HOME

# The tenant's workspace is also their home, so the in-app directory picker
# opens on it rather than on an empty /root.
ENV HOME=/mnt/workspace

# The container is the sandbox. Asking a tenant to approve each file write and
# each command would be guarding the inside of a box that exists to be written
# in — and the approval prompt has nowhere to go in a headless container. The
# boundary that matters is the container itself, plus the gateway in front of it.
ENV DSH_PERMISSION_MODE=danger-full-access

# The CubeEgress root, when the operator has dropped one in. It is what makes
# credential injection possible: CubeEgress terminates TLS to rewrite the
# `Authorization` header, so a sandbox that does not trust its root gets a
# certificate error rather than a model answer. The directory always exists and
# is usually empty, because every installation's root is its own.
COPY sandbox/egress-ca/ /usr/local/share/ca-certificates/
RUN find /usr/local/share/ca-certificates -type f ! -name '*.crt' -delete \
    && update-ca-certificates

# Node verifies against its own bundled roots and ignores the system store, so
# installing the root above is not enough on its own — the harness is a Node
# process.
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Warm the web profile at build time; it otherwise initializes on first boot,
# putting that work on the path of the tenant's first request. It also creates
# the profile directory the plugins below are installed into.
RUN node "$DSH_BIN" web --dump-config > /dev/null 2>&1 || true

# This project's own halves of the composition, installed into the profile
# rather than into /app.
#
# That is where they have to be: the client-module registry resolves a plugin's
# package.json from the config tree's baseUrl — this directory — and Node
# resolves their own dependencies by walking up from here, which never reaches
# /app/node_modules. Installed rather than copied in, so `ws` and the shared
# frame protocol land beside them.
#
# `packages/` comes over whole: the tunnel plugin depends on the frame protocol
# as `file:../tunnel-protocol`, which only resolves if its sibling arrives at
# the same depth.
COPY packages /src/packages
# The panel's built browser half, which `packages/` does not carry: it is
# derived, so it is not committed, and it is produced by the stage above.
COPY --from=panel-build /panel/lib /src/packages/dsh-artifact-panel/lib
# `--install-links` because the default for a local path is a symlink back to
# it, and Node then resolves the plugin's own dependencies from where the link
# points rather than from the profile — which left the frame protocol
# unresolvable and the tunnel plugin dead on its first import. Copies put the
# plugin and everything it needs under the profile, where the registry looks.
RUN npm install --omit=dev --no-audit --no-fund --install-links \
      --prefix "$IMAGE_DSH_HOME/profiles/web" \
      /src/packages/dsh-gateway-tunnel \
      /src/packages/dsh-sandbox-host \
      /src/packages/dsh-tenant-account \
      /src/packages/dsh-artifact-panel \
      /src/packages/dsh-brand \
  && rm -rf /root/.npm /src

# Project the environment above into a file the entrypoint sources.
#
# Under CubeSandbox the backend is started through envd, and envd gives the
# processes it starts a clean environment rather than the image's — so every
# `ENV` above silently stopped reaching the backend when the start moved there.
#
# Written from the values rather than restated, so this cannot drift from the
# `ENV` lines that remain the single home for them. It must stay the last thing
# after them.
#
# `PATH` is in the list for the same reason as the rest, and it was left out
# once: the Python virtualenv lives at /opt/agent-python/bin, which only the
# image's PATH names, so a tenant's agent found `officecli` in /usr/local/bin
# and no `python` at all. Anything installed outside the default directories
# has to be reachable through this file or it does not exist to the backend.
#
# WHICH LAYOUT THIS IMAGE WAS BUILT FOR.
#
# The volume records the layout it was last brought to; the entrypoint compares
# the two and does nothing when they agree, which is every boot but the first
# after an upgrade. Raise this by one whenever the shape of what is stored
# changes, and add the matching step in `migrate-storage-paths.mjs` — the two
# are read together and neither is useful alone.
#
#   1  volume at /persist, workspace reached through a symlink
#   2  volume at /mnt, workspace and DSH_HOME as real directories under it
ENV SANDBOX_LAYOUT_VERSION=2

# The tenant's harness state, on the mount beside their files. Set HERE, after
# everything that composes a profile has run against the image's own home and
# before this file records what the backend will start with.
ENV DSH_HOME=/mnt/dsh

RUN for name in PATH DSH_BIN DSH_HOME IMAGE_DSH_HOME MOUNT WORKSPACE SANDBOX_LAYOUT_VERSION HOME DSH_PERMISSION_MODE NODE_ENV \
                NODE_EXTRA_CA_CERTS TZ VIRTUAL_ENV MPLBACKEND MPLCONFIGDIR \
                OFFICECLI_SKIP_UPDATE DSH_BUNDLED_SKILL_DIR; do \
      printf 'export %s=%s\n' "$name" "$(printenv "$name")"; \
    done > /app/sandbox/env.sh

# envd is what makes this image usable as a CubeSandbox template: the only
# endpoint CubeMaster and CubeProxy speak to inside a sandbox, and the one the
# gateway starts this tenant's backend through.
#
# No CMD, deliberately. A CubeSandbox template is a *snapshot* of this image
# running, restored for every tenant, so whatever a CMD started would be frozen
# into it — started before any tenant exists, and identical in every sandbox
# restored from it. `entrypoint.sh` needs an identity that only exists at
# creation, so the gateway starts it through envd instead. The Docker simulation
# now keeps this entrypoint and passes `entrypoint.sh` as the command, so it
# gets the same envd on the same port and the file plane has one implementation
# rather than one per runtime.
COPY --from=envd /envd /usr/bin/envd
COPY --from=cube-tools /usr/local/bin/cube-entrypoint.sh /usr/local/bin/cube-entrypoint.sh

# The tenant's workspace, and nothing else in it.
#
# HOME is the workspace, so every npm and corepack call above wrote a cache
# here. A build artefact is not something a tenant should find in their files,
# and with a volume attached this directory is shadowed by the mount anyway —
# what is emptied here is what the Docker simulation would otherwise start
# with.
RUN mkdir -p "$WORKSPACE" "$DSH_HOME" \
 && rm -rf "$WORKSPACE"/.[!.]* "$WORKSPACE"/* 2>/dev/null || true
WORKDIR /mnt/workspace
EXPOSE 49983
ENTRYPOINT ["/usr/local/bin/cube-entrypoint.sh"]

# ---------------------------------------------------------------- landing ----
# Build the front door.
#
# `vite build`, which is the whole of it. There used to be a script here that
# copied the tree, hashed each asset and rewrote the references by string
# substitution; a bundler does that from the document it parsed, so it cannot
# leave a reference behind pointing at a name nothing serves.
#
# The names matter for one reason: an asset whose URL changes with its content
# can be cached forever, and one whose URL does not cannot be cached at all
# without going stale. Replacing a screenshot used to leave the old one on
# screen for an hour; now it is a different URL and arrives on the first load.
FROM node:24-alpine AS landing
# The repository's own shape, because the page names the gateway's marks by
# their real path — `../../gateway/assets/hamster.svg`. One file per mark in the
# tree, so a replacement reaches the front door and the sign-in page together,
# rather than a copy beside each page that shows one.
WORKDIR /src/web/landing
# The same mirror the other stages take, for the same reason: a build behind a
# slow or unreachable public registry should fail in one place or none.
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
# Manifest first: the dependency install is then cached against it and does not
# re-run because a screenshot changed.
# `/src/packages/dsh-icons`, because the page declares it as
# `file:../../packages/dsh-icons` relative to this WORKDIR. Its build writes the
# icons into the document, so the set has to be here before `npm ci`.
COPY packages/dsh-icons /src/packages/dsh-icons
COPY web/landing/package.json web/landing/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY gateway/assets /src/gateway/assets
COPY web/landing ./
RUN npm run build

# ------------------------------------------------------------------ shell ----
# Boot the composition once and save what it serves: index.html carrying the
# boot manifest, and every client bundle that manifest names.
#
# Derived from `sandbox`, and that is load-bearing. The composition adapts to
# its environment — a host with a native directory dialog composes
# `directory-picker-native` where a Linux container composes
# `directory-picker-browse`, and the bundle revisions differ too. Harvesting
# anywhere but the image the sandboxes run would ship a frontend whose plugin
# set does not match the backend it talks to.
FROM sandbox AS shell
WORKDIR /app
COPY web/harvest-shell.mjs sandbox/harvest.patch.yml web/patch-loopback.mjs ./web/
# Harvested against the IMAGE's harness home, not the tenant's.
#
# `DSH_HOME` points at the mount, where `profiles/` is a link the entrypoint
# makes at boot — and nothing has booted here. Overridden for this one command
# rather than by moving the profile, because these are the same directory: at
# runtime the tenant's `$DSH_HOME/profiles` links straight back to this one, so
# what is harvested is what the backend will serve.
RUN DSH_HOME="$IMAGE_DSH_HOME" node web/harvest-shell.mjs /shell
# The one patch this repository applies to the harness, and the only one. It
# enables the settings plane for browsers that are not on loopback — which is
# every tenant of a deployment reached by a domain name. `web/patch-loopback.mjs`
# carries the whole argument, including why the three plugin-shaped fixes are
# closed. It fails this build if it stops applying, rather than letting a
# release ship with settings silently back in memory.
RUN node web/patch-loopback.mjs /shell

# -------------------------------------------------------------------- web ----
# The whole frontend: hashed assets from the published build, plus the composed
# shell. Nothing here is per-tenant, so the interface loads and renders whether
# or not the caller's sandbox is running — only `/api` needs one.
FROM nginx:alpine AS web
# For the self-signed certificate the entrypoint generates when none is mounted.
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules/@deepseek-ai/dsh-web-frontend/dist /usr/share/nginx/html
COPY --from=shell /shell /usr/share/nginx/html
# The landing page, which is what an anonymous visitor to `/` is shown. Its own
# root rather than a directory under the shell's, because the shell's root is
# upstream's published build and anything added to it is one npm release away
# from colliding with a name that build starts using.
#
# Named for what it is rather than for the URL its assets sit under: those are
# served from `/landing/`, and a directory of that name here would have to be
# reached at `landing/landing`.
COPY --from=landing /src/web/landing/dist /usr/share/nginx/front-door
# This deployment's own mark and tab icon for the application shell, whose brand
# plugin points at it.
# And the same file again for the application shell, whose brand plugin points
# at it. Its own root rather than the shell's, for the reason the landing page
# has one: the shell's root is upstream's published build, and a file added
# beside it is one release away from colliding with a name that build starts
# using.
COPY gateway/assets/hamster.svg /usr/share/nginx/brand/hamster.svg
COPY gateway/assets/favicon.svg /usr/share/nginx/brand/favicon.svg
# The deployment's WeChat code, for the same reason and from the same place: the
# sign-in page's footer and the landing page's footer show one account, and one
# file is how they cannot come to show two.
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
# Not under conf.d: everything matching conf.d/*.conf is included at the http
# level, and this is a fragment of a server block.
COPY web/site.inc /etc/nginx/site.inc
COPY web/entrypoint.sh /docker-entrypoint-dsh.sh
EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint-dsh.sh"]

# ---------------------------------------------------------------- gateway ----
# Deliberately node:24-alpine and not the deps stage: the gateway authenticates
# every tenant and holds the Docker socket, so it carries no harness code and
# none of the build toolchain.
FROM node:24-alpine AS gateway
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi
ENV NODE_ENV=production
WORKDIR /app
# `/packages/tunnel-protocol`, because the gateway declares it as
# `file:../packages/tunnel-protocol` relative to this WORKDIR. One copy of the
# frame protocol, depended on by both ends rather than duplicated into each.
COPY packages/tunnel-protocol /packages/tunnel-protocol
# And `/packages/dsh-icons`, declared the same way. It is path data and a string
# helper with no dependencies of its own — the gateway's pages cannot ask a
# module table for the harness's components the way a plugin can, because there
# is no shell here to ask.
COPY packages/dsh-icons /packages/dsh-icons
COPY gateway/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && rm -rf /root/.npm
COPY gateway ./gateway
# The harness version the login page footer names. It is the pin at the top of
# this file rather than anything the gateway can read for itself: this image
# deliberately carries no `@deepseek-ai` code — CI asserts its absence — so the
# one place that knows which release a tenant is about to run is the argument
# that installed it. A deployment can still override it in the environment.
ARG DSH_VERSION
ENV DSH_VERSION=${DSH_VERSION}
ENV PORT=8080
EXPOSE 8080
CMD ["node", "gateway/src/server.js"]

# ----------------------------------------------------------------- admin ----
# The operator's console, built as its own image because it is deployed as its
# own service — its own port, its own domain, its own credential, and an
# expectation that tenants cannot reach it at all. It used to be a route on the
# gateway, kept private by answering 404 to everyone else, which is hiding
# rather than isolating.
#
# It carries the gateway's source because it shares the modules that own
# accounts, invites, settings and the pages' chrome. One codebase, two entry
# points, two images — which is what makes the split real without duplicating
# the things both sides read.
#
# What it does NOT carry is any way to reach a sandbox: no tunnel protocol, no
# E2B client, no websockets. Its dependency list is `jose`, `pg` and the icons,
# and that shortness is the separation showing up somewhere it can be checked.
FROM node:24-alpine AS admin
ENV NODE_ENV=production
WORKDIR /app
COPY packages/dsh-icons /packages/dsh-icons
COPY admin/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && rm -rf /root/.npm
COPY admin ./admin
COPY gateway/src ./gateway/src
# The marks and faces the pages inline. `page-assets.js` hashes them at boot
# and throws on one it cannot find, so a missing file here is a service that
# does not start rather than a page with a hole in it.
COPY gateway/assets ./gateway/assets
ARG DSH_VERSION
ENV DSH_VERSION=${DSH_VERSION}
ENV ADMIN_PORT=8091
EXPOSE 8091
CMD ["node", "admin/server.js"]
