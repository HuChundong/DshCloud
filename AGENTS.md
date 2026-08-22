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

**There is exactly one exception, and it is `web/patch-loopback.mjs`.** DSH
decides whether the settings plane is reachable from `location.hostname`, so
every tenant of a deployment reached by a domain name keeps no preference at
all — not the theme, not the language, not the conversation settings. The lock
is deliberate upstream and correct there: `trustedHosts` is a DNS-rebinding
fence, not authentication, so the configuration plane stays loopback-only until
a real authentication layer exists. This deployment is that layer, and the
tunnel already makes the server accept these writes; only the browser declines
to send them. Configuration cannot express it, composition cannot reorder around
it, and flipping the flag from a plugin lands after `ui-theme` has already
bound. The script carries the full argument and the evidence for each of those.

Two things keep it from becoming a habit. It fails the image build when it stops
matching, rather than letting a release ship with settings quietly back in
memory; and `scripts/check-images.sh` asserts it against the bytes nginx will
serve. **Add nothing beside it.** A second patch is a sign this project has
started forking the harness, which is the thing the rule above exists to
prevent — and the first one is only here because upstream is closed to it.

## Everything added to DSH is a cordis plugin

Three plugins exist today, and which one a change belongs in is decided by one
question: **take the gateway away — is this still needed?**

- `dsh-gateway-tunnel` carries a sandbox's `/api` traffic out to the gateway.
  It follows the transport.
- `dsh-sandbox-host` supplies what a browser needs when the backend is on a
  machine the person cannot reach: the `/files` upload channel, and the settings
  document read back instead of handed to a desktop that is not there. Every
  line of it survives the gateway's removal, which is why it is not more surface
  on the other two — and why it would be usable by anyone running dsh remotely.
- `dsh-tenant-account` is who is signed in, how to sign out, the way in to the
  console, and the onboarding steps a deployment with its own sign-in page has
  already said. None of it means anything without the gateway.

A fourth belongs beside them, not inside the harness. A change that fits none of
the three is a sign the question above has a new answer, not that one of them
should grow a second subject — `dsh-gateway-logout` was renamed when it had
three.

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

## Do not implement somebody else's protocol

**If an official client exists for a wire protocol, use it.** envd — the
daemon every sandbox platform in this family embeds — was spoken here by a
hand-written Connect implementation worked out by experiment: which calls frame
themselves in envelopes, which are plain JSON, what a failure looks like. 735
lines of it, every one ours to keep right against a daemon somebody else
releases. The official client already knew all of it.

The reason it took so long to adopt was not the protocol. It was one line of
addressing: a sandbox was reached through the proxy's virtual-host routing, a
`Host` header the standard client cannot send because `Host` is forbidden in
fetch. The proxy also routes by path. **A workaround that only hand-written
code can perform is a workaround that locks you out of every standard tool** —
which is worth noticing before it costs a rewrite, not after.

Three things are deliberately NOT taken from that client, and each has a
reason that outlives whoever reads this:

- `files.watchDir` — envd cannot watch a network filesystem, and a tenant's
  workspace is one. The sandbox's own Rust watcher exists for that.
- `getMetrics` — polling per sandbox is what the push model replaced. Two
  thousand sandboxes make a poll a load problem.
- `pause`/`resume` — persistence is external, so destroying a sandbox loses
  the working set and not the files. Pausing is a later decision, not a
  missing migration.

`check-e2b-conformance.mjs` measures what the configured platform actually
does, rather than what it says it does, and names the divergences already
adapted to. A new one fails it.

## Icons come from the harness

**Do not draw an icon that `@deepseek-ai/dsh-client-ui-primitives` already
carries.** It has 70, MIT, drawn from the same figma source as the rest of the
interface, and every browser half of every plugin can `require` it from the
shell's module table exactly the way it requires React. The panel was already
requiring that module for `MarkdownText` and `CodeBlock` while hand-drawing
nineteen Lucide glyphs beside it, and the result was three icon styles in one
window: the harness's filled 16-grid outlines, a 24-grid set at stroke 2, and a
16-grid set at stroke 1.4.

What the harness has no drawing for lives in `packages/dsh-icons`, and it is
**taken, not drawn**. Sixteen glyphs, extracted from Lucide by `extract.mjs`
and stamped with the version they came from. Drawing them here was tried and
the result was the thing this rule exists to prevent: ten icons made beside
everything else this deployment does, sitting next to seventy a designer made.

Lucide because of the two measures that decide whether a glyph belongs beside
another. Its line weighs 2/24 of its box against the harness's 1.3/16 — two per
cent apart, which is why a 24-grid set can stand in a 16-grid interface with
nothing rescaled. And it is stroked rather than solid, which is the harness's
own construction expressed the other way round; `extract.mjs` refuses a glyph
whose weight drifts more than a tenth from upstream's.

Two traps, both of which cost a rebuild to find. Lucide draws with the whole
primitive vocabulary — a head is a `<circle>`, a frame is a `<rect>` — so an
extractor that reads `d` attributes drops parts of a drawing **without saying
so**: `users` arrived as a body with no head and nothing failed. And a name
that matches is not a meaning that matches, in both directions: `copy` and
`copy-text` are two buttons side by side and must not become one glyph, while
the harness's own `IconCodeOutline16` draws a hash. Read the drawing, not the
name.

Two surfaces cannot require the harness set, and they are the reason that
package exists rather than being only a handful of paths. The gateway's pages
are Node writing HTML into template literals and the landing page is a static
document; neither has a module table or a React runtime, so both take markup
from `dsh-icons` instead. The glyphs they borrow from the harness are mirrored
into `mirrored.js` by `mirror.mjs`, stamped with the release they came from,
and `check-icons.mjs` fails a `DSH_VERSION` bump that did not come back through
the generator.

Two client halves — `dsh-tenant-account` and `dsh-sandbox-host` — carry three
drawn glyphs inline. That is not a preference: the shell's module loader reads
those files as source with `require` bound to its own table, so there is no
build step to resolve a sibling package through. `check-icons.mjs` holds those
bytes to the original.

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
  HamsterHQ. If something in `integrations/` needs to reach into this project,
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

CI runs all five. Run them locally when the change touches what they cover,
rather than all of them every time:

```sh
npx oxlint                     # JavaScript
node scripts/check-docs.mjs    # links, bilingual pairing, section alignment
node scripts/check-uploads.mjs # the upload store, from the tree alone
node scripts/check-icons.mjs   # one icon set, and its copies
scripts/check-images.sh        # after a build: what resolves, and what loads
```

**A change to behaviour needs the acceptance suite, against a real deployment:**

```sh
cd verify && SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh
```

It signs in as the addresses it is given and no others, and **never point one at
a person's real address** — the suite reads verification codes straight out of
the database, so doing so signs in as them and leaves sessions under their
identity.

The console checks no longer take an address at all. The console is its own
service with its own credential, so the suite mints an operator session inside
it rather than borrowing an administrator's. `VERIFY_ADMIN_URL` says where that
service is, defaulting to `http://localhost:8091`; with no admin service running
those two checks are skipped.

It spends real model tokens and removes every sandbox, so it belongs on a
deployment you are willing to disturb. CI cannot run it, which is exactly why a
green CI is not evidence that a behaviour change works.

Changing the sandbox image also means a new CubeSandbox template — a template is
a snapshot taken at creation, so pointing an existing one at a new image leaves
every sandbox restoring the old snapshot. See "Running on CubeSandbox" in the
[README](README.md).

## The deployment tracks the repository

A deployment host is a checkout, not a copy. It updates with `git pull`, which
is also what makes "which commit is running there" a question with an answer —
the previous arrangement was rsync from a laptop, and the host silently held a
`verify.sh` two commits behind the fix it needed.

```sh
ssh <host> 'cd /path/to/dshcloud && git pull --ff-only'
```

Read-only access is a GitHub deploy key on the host; nothing there can push.
`.env` and `sandbox/egress-ca/*.crt` are gitignored and belong to the host, so a
pull never touches them.

**A pull is not a deployment.** What tenants run is the images, and under
CubeSandbox the template built from them — so a change to anything under
`gateway/`, `web/`, `sandbox/`, or `packages/` reaches nobody until it is
rebuilt, and a sandbox change also needs a new template. A change to `verify/`,
`scripts/`, or `docs/` takes effect on pull alone.

**A rebuild is not one either.** `docker compose build` moves the `:latest` tag;
a container already running keeps the image it was created from, and `stop` then
`start` restarts that same container. Use `up -d` — which recreates a container
whose image has moved — and never `restart` or `stop`/`start` after a build.
Nothing warns about this: the build succeeds, the service comes back healthy,
the logs look right, and the old code is still serving. Check the container
against the tag when it matters:

```sh
docker inspect <container> --format '{{.Image}}'   # must equal
docker images -q --no-trunc <image>:latest
```

**Run the gates before committing, not after.** `git config core.hooksPath
.githooks` enables a pre-commit hook that runs everything fast enough to run
every time: the lint, the plugin load, and the language and asset checks. It is
there for one mistake made five times — prose written into a template literal
with a backtick in it, which ends the string and breaks the file. Every time,
one of those checks would have said so in under a second, and twice it was
committed and pushed anyway because the output had scrolled past.

**Building `web` does not move the sandbox tag.** The `shell` stage is
`FROM sandbox`, so building `web` builds the sandbox stage and the browser
halves of the plugins reach nginx — while `hamsterhq-sandbox:latest` keeps
pointing at whatever it pointed at before, and the CubeSandbox template keeps
pointing at an older tag still. A plugin therefore lives in two places at once,
and building only `web` updates one of them. That is fine for a change to a
`client.js`, which the browser fetches from nginx; it silently does nothing for
a change to a plugin's node half, which runs inside the sandbox. Check rather
than assume:

```sh
docker inspect hamsterhq-sandbox:latest --format '{{.Created}}'   # against
docker inspect hamsterhq-web:latest --format '{{.Created}}'
```

To align them: `--profile build build`, tag and push the sandbox image, create a
NEW template from it (never update the old one — a template is a snapshot taken
at creation), point `CUBE_TEMPLATE_ID` at the new alias, and `up -d`.

**`down -v` reaches further than this deployment.** The postgres volume holds
accounts, and on a host where JuiceFS was installed against the same database
server it holds the volume filesystem's metadata too — which is not a copy of
tenants' files but the only record of where they are. Removing it leaves the
object store full of blocks nothing can name, wedges the shared mount, and
turns every sandbox creation into a `408` that mentions none of this. Check
before removing volumes, not after:

```sh
docker exec <postgres> psql -U <user> -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')"
```

Anything there that the deployment did not create is somebody else's, and this
project's own `db.js` creates exactly one.

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
