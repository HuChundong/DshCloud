# AGENTS.md

English | [中文](AGENTS.zh.md)

How to work in this repository. Each rule is here because breaking it cost
something; [docs/sandbox-pitfalls.md](docs/sandbox-pitfalls.md) has the
receipts.

## DSH is a dependency, and stays one

**Never patch, vendor, or fork the harness.** It arrives from npm at the version
pinned by `DSH_VERSION` in the `Dockerfile`, and what a tenant runs is the
`lib/bin.js` the registry publishes. A change that only works against a modified
harness is not a change this project can ship.

Upgrading is a version bump, a rebuild, and an acceptance run — in that order,
and the acceptance run is not optional. The harness surfaces this project
depends on (`window.__DSH_BOOT__`, `/plugins`, the loopback-pinned configuration
methods) are not versioned APIs, so an upgrade is only known-good once the suite
says so.

If the harness genuinely cannot do what is needed, the answer is an upstream
issue and a documented limitation here — not a patch layer that silently forks.

## Everything added to DSH is a cordis plugin

Two plugins exist today: `dsh-gateway-tunnel` carries a sandbox's `/api` traffic
out to the gateway, and `dsh-gateway-logout` adds the sign-out control. A third
belongs beside them, not inside the harness.

Four rules, each of which has broken:

- **Name plugins, never paths.** `cordis.patch.yml` refers to a plugin by
  package name. The client-module registry resolves a plugin's `package.json`
  from the config tree's baseUrl and scans only what it can resolve by name — a
  path-loaded plugin mounts its host half and contributes **no client half at
  all**, silently.
- **Install into the profile, not into `/app`.** Node resolves a plugin's own
  dependencies by walking up from where the plugin is, which never reaches
  `/app/node_modules`.
- **Use `--install-links`.** `npm install <local path>` symlinks back to the
  source, and Node then resolves the plugin's dependencies from the link target
  rather than from the profile.
- **Depend on siblings.** A plugin's dependency on another package in
  `packages/` is `file:../<name>`. Deeper relative paths only hold if every
  image copy reproduces the tree's depth, and one did not.

None of these fail the build. All of them fail on the first `import`, which is
what `scripts/check-images.sh` exists to catch.

## Directories mean something

```
Dockerfile              all three images, one npm install
gateway/  web/  sandbox/    one directory per image
packages/               npm packages this repository owns
integrations/           stands alone; could leave without changing a line here
verify/                 the acceptance suite — needs a deployment
scripts/                repository gates — need only the tree or the images
docs/                   design notes and pitfalls, English default
```

The rules that are not obvious from the listing:

- **`integrations/` imports nothing from this repository.** A thing in there
  talks only to the platform it integrates with, so it can move to its own
  repository without a line changing. `cube-volume-juicefs` is a CubeSandbox
  VolumePlugin: it knows about CubeSandbox and JuiceFS, and nothing about
  DshCloud. If something in `integrations/` needs to reach into this project,
  it is not an integration and belongs elsewhere.
- **`packages/` holds packages, named for themselves.** The directory name is
  the package name, because `cordis.patch.yml` refers to the package and a
  reader should not have to map between the two.
- **`gateway/` carries no harness code.** It authenticates every tenant and
  holds the Docker socket, which is host-root-equivalent. Adding
  `@deepseek-ai/*` to it puts a tenant's runtime inside the one process that
  must not run tenant code; CI asserts its absence.
- **`scripts/` may not need a deployment; `verify/` may.** A check that can be
  decided from the tree or the built images belongs in `scripts/` and runs in
  CI. A check that needs a live deployment, a CubeSandbox installation, or real
  model tokens belongs in `verify/` and runs against a deployment.

## What to run before pushing

CI runs the first three. Run them locally when the change touches what they
cover, rather than all of them every time:

```sh
npx oxlint                     # JavaScript
node scripts/check-docs.mjs    # links, bilingual pairing, section alignment
scripts/check-images.sh        # after a build: what resolves, and what loads
```

**A change to behaviour needs the acceptance suite, against a real deployment:**

```sh
cd verify && SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh
```

It spends real model tokens and removes every sandbox, so it belongs on a
deployment you are willing to disturb. CI cannot run it, which is exactly why a
green CI is not evidence that a behaviour change works.

Changing the sandbox image also means a new CubeSandbox template — a template is
a snapshot taken at creation, so pointing an existing one at a new image leaves
every sandbox restoring the old snapshot. See "Running on CubeSandbox" in the
[README](README.md).

## Documentation

Every page is a pair: `X.md` in English and `X.zh.md` in Chinese, each linking
to the other, with the same `##` sections in the same order. English is the
default and the one a reader lands on. `scripts/check-docs.mjs` enforces all of
it.

Write what is true now. Rationale that outlives the code goes in
[docs/design.md](docs/design.md); a failure that cost debugging time goes in
[docs/sandbox-pitfalls.md](docs/sandbox-pitfalls.md), **including the wrong
conclusion that preceded the right one** — that is the part a reader cannot
reconstruct from the code.

Prefer the measurement to the adjective. "38 ms per small-file create against
0.06 ms on local disk" survives a rewrite; "slow" does not.

## Secrets

`.env.example` is the only member of its family in the tree; `.gitignore`
covers `.env` and `.env.*`, and CI fails on a tracked environment file or on
anything shaped like a credential. Every CubeEgress installation generates its
own root CA, so `sandbox/egress-ca/*.crt` is gitignored and dropped in by the
operator.

The model credential is deployment-owned and reaches a sandbox only under
CubeSandbox, where CubeEgress substitutes it in flight. Nothing should ever put
it into a sandbox's environment, a log line, or a session event.
