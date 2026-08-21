# The site itself, included by both the HTTP and the HTTPS server so that the
# two differ only in how they are reached.

root /usr/share/nginx/html;

# dsh accepts request bodies up to its own 160 MiB default; nginx must not
# become the component that refuses an upload the backend would have taken.
client_max_body_size 200m;

# Keep redirects relative. Absolutising them uses the port nginx listens on
# rather than the one the browser reached, so a container published on any
# other port sends people to a URL that does not exist — the unauthenticated
# redirect landed on http://localhost/login instead of :8080.
absolute_redirect off;

# ---- session-bearing surface: proxied, never served from disk ----

# Every one of these overwrites `X-Forwarded-For`, and that is a rule rather
# than a habit.
#
# The gateway reads the LAST hop of that header as the caller, which is right
# only because exactly one proxy sits in front and appends the peer it actually
# received the connection from. Where a location did NOT set the header, the
# client's own value went upstream untouched — so the last hop was whatever the
# caller had written there. `/login` was one of those, and the send limit that
# allows twenty codes an hour is keyed on exactly that value: a header changed
# per request was a fresh bucket per request, and the limit did not exist.
#
# It has to be repeated in each block rather than set once above them, because
# `proxy_set_header` does not merge across levels — a location that declares
# any header of its own inherits none of the outer ones. Setting it at the
# server level would therefore have applied to nothing here, since every
# location sets `Host`. `scripts/check-forwarded.mjs` compares this file
# against itself so a route added later cannot quietly be the next `/login`.

# The agent plane. Long reads: a prompt holds its response open while the
# model works, and the default 60s would cut it.
location /api/ {
  proxy_pass http://gateway;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  # The two downlinks arrive here as upgrades; without these they are answered
  # as ordinary requests and the frontend never gets its event streams.
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  proxy_buffering off;
}

# The file plane. A second location rather than a widened `/api/`, because it is
# a second channel: `dsh-sandbox-host` registers `/files` with dsh's own RPC
# channel registry, which `/api` could not host — that channel accepts exactly
# one interceptor and dsh's `typert-gateway` already holds it.
#
# No upgrade headers: nothing here is a WebSocket. The timeouts match `/api/`
# anyway, since a chunk crosses the same tunnel and a tenant on a slow link
# should not have an upload cut at sixty seconds. `client_max_body_size` above
# already covers a chunk many times over.
location /files/ {
  proxy_pass http://gateway;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  proxy_buffering off;
}

# `X-Forwarded-Proto` decides whether the gateway marks its token cookies
# `Secure`. It is trustworthy only because nothing but this nginx can reach the
# gateway's port.
location = /login   { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
location = /logout  { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
location /login-assets/ { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
location = /whoami  { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
# The deployment's terms, data notice and safe-use policy. Anonymous: they are
# what someone reads before agreeing to them on the sign-in form, which is
# before they have an account. A prefix, because there are three of them and
# `/policy` itself redirects to the first.
location /policy { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }

# The tenant's own name and picture, and closing the account. A prefix rather
# than the exact match this was: `/profile/delete` is a second path on the same
# handler, and an exact match sent it to `try_files` and a 404 — with a curl
# aimed straight at the gateway passing, which is the confusing kind of broken.
location /profile { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
# The tenant's own sandbox environment. A prefix rather than an exact match:
# `/secrets` lists and writes, `/secrets/delete` removes.
location /secrets { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
# Throwing away this tenant's own machine. Removing a container is slower than
# a request usually is, so it gets the long read timeout rather than the 60s
# default — a timeout here would report failure for something that worked.
location = /sandbox/restart {
  proxy_pass http://gateway;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 5m;
}

# Two streams the panel keeps open: the sandbox's own numbers, and the changes
# under its workspace. One location, because they are the same kind of thing —
# a long-lived response the gateway writes to when it has something to say. One sample per sandbox is taken by
# the gateway and fanned out to whoever is watching, so this connection stays
# open and says nothing for seconds at a time — hence the long read timeout,
# and `proxy_buffering off`, without which nginx holds each event until it has
# collected enough of them to be worth forwarding.
location ~ ^/sandbox/(stats|watch)$ {
  proxy_pass http://gateway;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  proxy_buffering off;
  proxy_cache off;
}

# The panel's terminal. A WebSocket, so it needs the upgrade headers the two
# `/api` downlinks get; without them nginx answers the handshake as an ordinary
# request and the shell never opens. The long timeouts are what a terminal is:
# an idle prompt sends nothing for as long as nobody types.
location = /sandbox/pty {
  proxy_pass http://gateway;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  proxy_buffering off;
}

# The right-hand panel's file plane: listing a directory, describing a path, and
# a file's own bytes. Two locations rather than one, because they are two kinds
# of answer — JSON about the workspace, and the bytes of one file in it.
#
# A prefix match, and that is the point of writing them out: the only other
# `/sandbox` rule here is `location = /sandbox/restart`, an EXACT match, so it
# does not cover these. Without these blocks the requests never reach the
# gateway at all — they fall through to `try_files` and come back 404, while a
# curl aimed straight at the gateway passes and suggests everything is fine.
location /sandbox/fs/ {
  proxy_pass http://gateway;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

# The bytes. The long read timeout matches `/api/`: the file crosses CubeProxy
# from inside a sandbox, and a tenant on a slow link should not have a preview
# cut at sixty seconds. `proxy_buffering off` so a large file starts arriving
# rather than being spooled here first.
#
# The security headers this serves under are set by the gateway, per response,
# because they depend on what is being served. Nothing is added or overridden
# here — an nginx-level `add_header` would silently replace the whole set.
# An HTML preview and everything it pulls in. A separate location from
# `/sandbox/raw/` because it authenticates differently: the frame it loads in is
# sandboxed to an opaque origin and sends no cookies, so the URL carries a
# short-lived signed ticket instead. Same proxy settings; the difference is
# entirely in what the gateway accepts.
location /sandbox/preview/ {
  proxy_pass http://gateway;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  proxy_buffering off;
}

location /sandbox/raw/ {
  proxy_pass http://gateway;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  proxy_buffering off;
}

# The administrator's console. Served by the gateway, which is the only
# component that knows who administers this deployment; an ordinary caller is
# answered 404 there rather than 403.
location /admin {
  proxy_pass http://gateway;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

# ---- the gate ----

# Resolves the session cookie without returning a body. `internal` keeps it
# off the public surface: it exists only to answer auth_request.
location = /_auth {
  internal;
  proxy_pass http://gateway/_auth;
  proxy_pass_request_body off;
  proxy_set_header Content-Length "";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  # A subrequest carries its own URI, not the one being gated. The gateway needs
  # the original to tell the application shell apart from the plugin bundles
  # behind the same gate: only the shell is worth charging a database read to
  # ask whether its tenant has finished signing up.
  proxy_set_header X-Original-URI $request_uri;
}

location @login { return 303 /login; }

# Someone who has not signed in and did not arrive at `/login` on purpose. They
# used to be sent straight to the sign-in form, which asks for an invite code
# from a stranger who has not yet been told what any of this is; they meet the
# landing page instead, and reach the form from a button on it.
#
# Only `/` and the shell document redirect here. A 401 on `/api` stays a 401:
# an application that lost its session needs a status its client can act on,
# not a page it will try to parse as JSON.
# Serving, not redirecting: this is what `/` gives a stranger, and it has to
# arrive at `/` for the address to mean anything.
#
# `root` rather than `alias`, because a named location cannot carry an alias —
# nginx refuses the configuration outright.
location @front_door {
  root /usr/share/nginx/front-door;
  try_files /index.html =404;
  add_header Cache-Control "no-cache";
}

# And the way back to it, for an address that needs a session and did not find
# one.
location @home { return 303 /; }

# Signed in, but not finished signing up. The gate answers 403 for that, and
# only for the shell document, so an account that has never chosen a name meets
# the profile page instead of an application it is halfway into.
location @profile { return 303 /profile; }

# Carry a renewal back to the browser. The gateway renews an expired access
# token during auth_request — the frontend is dsh's own shell and knows nothing
# about this deployment's tokens, so it can neither refresh nor notice — but
# nginx discards a subrequest's own `Set-Cookie`. These name the two cookies
# separately because the one variable that could carry them holds only the
# first header of a given name. `add_header` emits nothing when its value is
# empty, so the ordinary case where nothing was renewed adds nothing.
#
# Included per gated location: `auth_request_set` is evaluated where the
# auth_request that filled it ran.


# ---- the front door and the application ----

# The address people type. Which of the two things it serves depends on whether
# they have a session, and that question is asked of the gateway rather than
# guessed from a cookie's presence — an expired token has to be renewed or
# refused, which only it can do.
#
# A stranger gets the landing page AT THIS ADDRESS rather than a redirect to
# one. The front door is what `/` means to someone who has not been here, and a
# hop through /welcome/ only told them the address they typed was not the real
# one.
location = / {
  auth_request /_auth;
  error_page 401 = @front_door;
  error_page 403 = @profile;
  # Signed in and finished signing up: this address is not where the
  # application lives, so say where it does.
  #
  # Reached through try_files rather than a plain `return`, and that is not
  # style. `return` runs in the rewrite phase, which is BEFORE access — so a
  # return here answers every visitor and auth_request never runs at all. The
  # named file is never meant to exist; missing it is how this arrives at the
  # redirect, in the content phase, after the check.
  try_files /does-not-exist @to_app;
}

location @to_app { return 303 /app; }

# The application. Its own address, so that "am I signed in" is answered by
# which page you are on rather than by what the same URL happened to serve.
#
# The document is upstream's build and names its own assets absolutely — from
# /assets and /plugins — so serving the document from here changes nothing
# about where those come from.
location = /app {
  auth_request /_auth;
  auth_request_set $renew_access $upstream_http_x_renew_access;
  auth_request_set $renew_refresh $upstream_http_x_renew_refresh;
  # A stranger who typed /app meets the front door, at the address that is the
  # front door.
  error_page 401 = @home;
  error_page 403 = @profile;
  root /usr/share/nginx/html;
  try_files /index.html =404;
  add_header Set-Cookie $renew_access;
  add_header Set-Cookie $renew_refresh;
  add_header Cache-Control "no-store";
}

# The shell document under its own name, for anything that still asks for it.
location = /index.html { return 303 /app; }

# Source maps, which nothing here publishes.
#
# The shell's own plugins reference a `.map` beside each bundle and upstream
# ships none, so every page load asks for a dozen files that were never built.
# They already 404; what this changes is that they stop writing a line into the
# error log each time, where they sit among things that actually went wrong and
# make that log worth less.
#
# A regex location, so it wins over the `/plugins/` prefix below without having
# to be repeated inside it. `/landing/` is `^~` and is not affected — if this
# deployment ever does publish maps, they will be under a prefix that opts out.
location ~ \.map$ {
  access_log off;
  log_not_found off;
  return 404;
}

location /plugins/ {
  auth_request /_auth;
  error_page 401 = @login;
  add_header Cache-Control "no-cache";
}

# ---- public shell assets ----

# Hashed filenames, identical for every tenant, carrying nothing of theirs.
# Anonymous by necessity as much as by choice: a browser fetches the manifest
# with no credentials unless the tag opts in, and this index.html does not.
location /assets/ {
  # One header rather than `expires`, which emits a Cache-Control of its own —
  # and `immutable` besides, so a reload does not spend a conditional request
  # asking about a file whose name already answers the question.
  add_header Cache-Control "public, max-age=31536000, immutable";
  add_header Cache-Control "public, immutable";
}

# nginx's bundled mime.types has no entry for .webmanifest, so it would ship
# as application/octet-stream. `default_type` rather than a `types` block: a
# server-level `types` block replaces the inherited map wholesale.
location = /manifest.webmanifest {
  default_type application/manifest+json;
}

# ---- this deployment's own brand ----

# The mark and the tab icon, for the application shell's brand plugin and for
# anything else that has to show whose deployment this is. Anonymous, static,
# and in a root of their own rather than in the shell's — see the landing page
# below for why that matters.
location /brand/ {
  alias /usr/share/nginx/brand/;
  # Revalidated, not cached for a period. The name here has to stay fixed —
  # `packages/dsh-brand/client.js` writes it as a constant, and that file is
  # served to the browser as it was written rather than rewritten by a build,
  # so nothing can put a hash in it. A fixed name and a period of caching is
  # the arrangement where replacing the mark leaves the old one on screen for
  # up to that period, which is what it did.
  #
  # So: names that carry a hash are immutable, and names that do not are
  # revalidated. The cost is a conditional request per load, answered 304 with
  # no body. `scripts/check-assets.mjs` holds both halves of that rule.
  add_header Cache-Control "no-cache";
}

# ---- the landing page ----

# Anonymous, and it has to be: it is what someone sees before they have an
# account. It sits in its own root rather than under the shell's, because the
# shell's root is upstream's published build and a file added beside it is one
# release away from colliding with a name that build starts using.
#
# Its references are relative — `./landing/…` — so that the same bytes serve
# from the site root on GitHub Pages and from `/` here. That is `base: './'` in
# `web/landing/vite.config.js`, and it is why the asset prefix below is its own
# name rather than the shell's `/assets/`: two roots, one document, and no path
# that is only correct in one of them.
# The address the front door used to have. Kept so a link someone saved still
# arrives, and permanent because it is not coming back.
location = /welcome  { return 301 /; }
location /welcome/   { return 301 /; }

# The front door again, at an address a signed-in tenant can reach.
#
# `/` is not one: it asks the gateway who is calling and sends anyone with a
# session to `/app`, which is right for the front door and wrong for the one
# section of it a tenant has a reason to open — what the tiers are. A link to
# `/#plans` from inside the application lands on the application.
#
# So the same document, unauthenticated, at its own name. No `auth_request`
# here on purpose: the page says the same thing to everyone, and asking would
# only reintroduce the redirect this exists to avoid.
#
# `= /plans` and not `/plans/`: with no trailing slash the document's relative
# references — `./landing/…` — resolve against `/`, which is where they are
# served from. A trailing slash would resolve them against `/plans/` and every
# asset on the page would 404.
# Byte for byte what `@front_door` serves, headers included: two addresses for
# one document, and a difference between them would be a difference nobody
# asked for.
location = /plans {
  root /usr/share/nginx/front-door;
  try_files /index.html =404;
}

# Everything the front door names — its stylesheet, its script, its fonts and
# every picture on it — each under a name carrying its own content hash.
# `vite build` writes them into this one directory and rewrites every reference
# to them from the document it parsed, so a reference cannot be left behind
# pointing at a name nothing serves.
#
# Cached forever, and that is the whole reason for the hashing. These were
# served for an hour under fixed names, which is the arrangement where replacing
# a picture changes nothing a visitor sees until the hour is up — and where the
# only way to learn whether a deployment took your new screenshots is to wait.
# A different picture is now a different URL, so it arrives on the first load
# and the old one is never asked about again.
#
# `root` rather than `alias`, and a prefix rather than a regex: the URI already
# begins with the directory the files sit in, so nginx appends the whole of it
# and there is no capture to leave out — which is the mistake that answers 404
# for every file. `^~` settles it here without any regex location being tried.
location ^~ /landing/ {
  root /usr/share/nginx/front-door;
  # One header, not two: `expires` emits its own Cache-Control, so pairing the
  # two sends the field twice and leaves which one wins to the client.
  add_header Cache-Control "public, max-age=31536000, immutable";
}

location / {
  try_files $uri =404;
}
