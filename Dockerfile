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

# The harness version this deployment runs. A build argument rather than a
# lockfile entry, so a deployment can move between published versions without
# editing a file that also pins this project's own dependencies.
ARG DSH_VERSION=0.1.0-rc.7

# An npm registry to install from. Empty uses the public one; a deployment far
# from it names a mirror rather than waiting out ~200 packages.
ARG NPM_REGISTRY=
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

WORKDIR /app
# `dsh-web-frontend` is named outright. cordis resolves plugins by package name
# at load time, so which packages a composition needs is not derivable from the
# dependency graph — and the frontend is not reachable from `dsh` through it.
RUN npm install --omit=dev --no-audit --no-fund \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      "@deepseek-ai/dsh-web-frontend"


# ---------------------------------------------------------------- sandbox ----
FROM node:24-slim AS sandbox

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
RUN python3 -m venv "$VIRTUAL_ENV" \
  && pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir --retries 5 --timeout 120 \
       pandas duckdb sqlalchemy tabulate \
       openpyxl xlsxwriter xlrd pyxlsb odfpy \
       pdfplumber pillow matplotlib \
       lxml beautifulsoup4 markdownify jinja2 \
       python-magic py7zr rarfile charset-normalizer requests \
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
COPY sandbox/entrypoint.sh sandbox/cordis.patch.yml ./sandbox/
RUN chmod +x /app/sandbox/entrypoint.sh

# The entry a tenant's backend runs: the same `lib/bin.js` the npm package ships
# as `dsh`, named explicitly so the entrypoint does not depend on PATH.
ENV DSH_BIN=/app/node_modules/@deepseek-ai/dsh/lib/bin.js

# The tenant's workspace is also their home, so the in-app directory picker
# opens on it rather than on an empty /root.
ENV DSH_HOME=/root/.dsh
ENV HOME=/workspace

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
# `--install-links` because the default for a local path is a symlink back to
# it, and Node then resolves the plugin's own dependencies from where the link
# points rather than from the profile — which left the frame protocol
# unresolvable and the tunnel plugin dead on its first import. Copies put the
# plugin and everything it needs under the profile, where the registry looks.
RUN npm install --omit=dev --no-audit --no-fund --install-links \
      --prefix /root/.dsh/profiles/web \
      /src/packages/dsh-gateway-tunnel \
      /src/packages/dsh-sandbox-host \
      /src/packages/dsh-tenant-account \
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
RUN for name in PATH DSH_BIN DSH_HOME HOME DSH_PERMISSION_MODE NODE_ENV \
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
# has no envd and overrides both the entrypoint and the command.
COPY --from=ghcr.io/tencentcloud/cubesandbox-base:2026.16 /usr/bin/envd /usr/bin/envd
COPY --from=ghcr.io/tencentcloud/cubesandbox-base:2026.16 /usr/local/bin/cube-entrypoint.sh /usr/local/bin/cube-entrypoint.sh

RUN mkdir -p /workspace
WORKDIR /workspace
EXPOSE 49983
ENTRYPOINT ["/usr/local/bin/cube-entrypoint.sh"]

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
COPY web/harvest-shell.mjs sandbox/harvest.patch.yml ./web/
RUN node web/harvest-shell.mjs /shell

# -------------------------------------------------------------------- web ----
# The whole frontend: hashed assets from the published build, plus the composed
# shell. Nothing here is per-tenant, so the interface loads and renders whether
# or not the caller's sandbox is running — only `/api` needs one.
FROM nginx:alpine AS web
# For the self-signed certificate the entrypoint generates when none is mounted.
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules/@deepseek-ai/dsh-web-frontend/dist /usr/share/nginx/html
COPY --from=shell /shell /usr/share/nginx/html
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
COPY gateway/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && rm -rf /root/.npm
COPY gateway ./gateway
ENV PORT=8080
EXPOSE 8080
CMD ["node", "gateway/src/server.js"]
