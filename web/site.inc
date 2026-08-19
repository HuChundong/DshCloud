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
location = /login   { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
location = /logout  { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
location /login-assets/ { proxy_pass http://gateway; proxy_set_header Host $host; }
location = /whoami  { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
# The tenant's own name and picture. Served by the gateway because the account
# is the gateway's, and because it has to work before a sandbox exists — an
# account reaches it on the way in, before it has ever loaded the shell.
location = /profile { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
# The tenant's own sandbox environment. A prefix rather than an exact match:
# `/secrets` lists and writes, `/secrets/delete` removes.
location /secrets { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
# Throwing away this tenant's own machine. Removing a container is slower than
# a request usually is, so it gets the long read timeout rather than the 60s
# default — a timeout here would report failure for something that worked.
location = /sandbox/restart {
  proxy_pass http://gateway;
  proxy_set_header Host $host;
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
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;
  proxy_buffering off;
}

location /sandbox/raw/ {
  proxy_pass http://gateway;
  proxy_set_header Host $host;
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
location @landing { return 303 /welcome/; }

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


# ---- the application shell ----

# index.html and the client bundles are the application, so they need a
# session: an unauthenticated visitor who loaded the shell would watch it
# retry a 401 forever, because the frontend has no notion of this login page.
location = / {
  auth_request /_auth;
  auth_request_set $renew_access $upstream_http_x_renew_access;
  auth_request_set $renew_refresh $upstream_http_x_renew_refresh;
  error_page 401 = @landing;
  error_page 403 = @profile;
  try_files /index.html =404;
  add_header Set-Cookie $renew_access;
  add_header Set-Cookie $renew_refresh;
  add_header Cache-Control "no-store";
}

location = /index.html {
  auth_request /_auth;
  auth_request_set $renew_access $upstream_http_x_renew_access;
  auth_request_set $renew_refresh $upstream_http_x_renew_refresh;
  error_page 401 = @landing;
  error_page 403 = @profile;
  add_header Set-Cookie $renew_access;
  add_header Set-Cookie $renew_refresh;
  add_header Cache-Control "no-store";
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
  expires 1y;
  add_header Cache-Control "public, immutable";
}

# nginx's bundled mime.types has no entry for .webmanifest, so it would ship
# as application/octet-stream. `default_type` rather than a `types` block: a
# server-level `types` block replaces the inherited map wholesale.
location = /manifest.webmanifest {
  default_type application/manifest+json;
}

# ---- the landing page ----

# Anonymous, and it has to be: it is what someone sees before they have an
# account. It sits in its own root rather than under the shell's, because the
# shell's root is upstream's published build and a file added beside it is one
# release away from colliding with a name that build starts using.
#
# The trailing slash is load-bearing. The page references its images relatively
# — `assets/…`, no leading slash — so that the same bytes serve from the site
# root on GitHub Pages and from here. Reached at `/welcome`, the browser would
# resolve those against `/` and ask the shell's root for them; the exact-match
# redirect below is what stops that, and it is why `@landing` names the slashed
# form directly rather than relying on nginx to add it.
location = /welcome { return 303 /welcome/; }

# `try_files` with a literal path rather than `alias` pointed straight at the
# document. Aliasing the file looks tidier and does not work: this location's
# URI ends in a slash, so the index module runs first and asks for
# `…/index.htmlindex.html`, which nginx reports as a 500 and an alert about a
# path that is not a directory.
location = /welcome/ {
  alias /usr/share/nginx/landing/;
  try_files /index.html =404;
  # One document, edited in place and never hashed, so a cached copy is a stale
  # copy. It revalidates rather than refetching: the page is small, and the 304
  # costs less than the redirect that brought the visitor here.
  add_header Cache-Control "no-cache";
}

# The images. A short expiry rather than the shell's `1y, immutable`: these
# filenames are `screenshot-workspace.png`, not a content hash, so the same
# name means something different after every redesign.
location /welcome/ {
  alias /usr/share/nginx/landing/;
  expires 1h;
}

location / {
  try_files $uri =404;
}
