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

# `X-Forwarded-Proto` decides whether the gateway marks its token cookies
# `Secure`. It is trustworthy only because nothing but this nginx can reach the
# gateway's port.
location = /login   { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
location = /logout  { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
location /login-assets/ { proxy_pass http://gateway; proxy_set_header Host $host; }
location = /whoami  { proxy_pass http://gateway; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }

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
}

location @login { return 303 /login; }

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
  error_page 401 = @login;
  try_files /index.html =404;
  add_header Set-Cookie $renew_access;
  add_header Set-Cookie $renew_refresh;
  add_header Cache-Control "no-store";
}

location = /index.html {
  auth_request /_auth;
  auth_request_set $renew_access $upstream_http_x_renew_access;
  auth_request_set $renew_refresh $upstream_http_x_renew_refresh;
  error_page 401 = @login;
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

location / {
  try_files $uri =404;
}
