#!/bin/sh
# Make sure the front door has a certificate and knows its public address, then
# serve.
#
# The certificate is generated here rather than baked into the image: a
# certificate in an image is the same certificate — and the same private key —
# for everyone who pulls it. Generated only when absent, so mounting a real
# certificate over /etc/nginx/tls replaces this one and nothing overwrites it.
set -eu

CERT=/etc/nginx/tls/server.crt
KEY=/etc/nginx/tls/server.key

if [ ! -s "$CERT" ] || [ ! -s "$KEY" ]; then
  # The names the deployment is reached by. A browser rejects a certificate
  # that does not carry the address in the URL bar outright — there is no
  # warning to click through — so a LAN deployment must name its address here.
  SAN="${TLS_SAN:-DNS:localhost,IP:127.0.0.1}"
  echo "web: generating a self-signed certificate for ${SAN}" >&2
  mkdir -p "$(dirname "$CERT")"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -subj '/CN=dsh' -addext "subjectAltName=${SAN}" \
    -keyout "$KEY" -out "$CERT" 2>/dev/null
fi

# Send plain HTTP to the TLS site — but only where that address is known.
#
# nginx sees the port it listens on, which is 443 inside the container, and not
# the one the container publishes, which is whatever the host chose. So it
# cannot work the redirect out for itself: a bare `https://$host$request_uri`
# would send every visitor to port 443, where this deployment is not. The
# public port therefore has to be told to it, and until it is, plain HTTP keeps
# serving the site rather than redirecting somewhere that will not answer.
#
# The host is carried over from the request instead of being configured, so a
# deployment reached by several names keeps whichever one the visitor used.
REDIRECT=/etc/nginx/redirect.inc
if [ -n "${HTTPS_PORT:-}" ]; then
  # 443 is left off the URL: naming the default port is noise in the address
  # bar, and some clients compare origins as text.
  PORT=":${HTTPS_PORT}"
  [ "$HTTPS_PORT" = 443 ] && PORT=""
  echo "web: plain HTTP redirects to https://<host>${PORT}" >&2
  # `$host` and `$request_uri` belong to nginx, and the backslashes are what
  # keep this shell from reading them as its own. 301 rather than 302: the
  # scheme is not going back, and a permanent redirect is the one a browser
  # remembers, so a returning visitor never makes the plain request at all.
  cat > "$REDIRECT" <<EOF
return 301 https://\$host${PORT}\$request_uri;
EOF
else
  : > "$REDIRECT"
fi

# The operator's console, on its own name.
#
# Written here rather than kept in the image, for the same reason the redirect
# is: the deployment decides whether it is published at all and under what
# name, and a deployment that decided nothing gets an empty file and no vhost.
#
# It is a separate server block rather than a path on the main one, and that is
# the point: a request for any other name never reaches it, so the console is
# not one path traversal or one misordered location away from the surface every
# tenant is on.
ADMIN=/etc/nginx/admin.inc
if [ -n "${ADMIN_DOMAIN:-}" ]; then
  echo "web: the operator console answers on https://${ADMIN_DOMAIN}" >&2
  # `$` escaped where it belongs to nginx and not to this shell.
  cat > "$ADMIN" <<EOF
upstream admin_console { server ${ADMIN_UPSTREAM:-admin:8091}; keepalive 4; }

server {
  listen 443 ssl;
  http2 on;
  server_name ${ADMIN_DOMAIN};
  ssl_certificate ${ADMIN_TLS_CERT:+$ADMIN_TLS_CERT}${ADMIN_TLS_CERT:-/etc/nginx/tls/server.crt};
  ssl_certificate_key ${ADMIN_TLS_KEY:+$ADMIN_TLS_KEY}${ADMIN_TLS_KEY:-/etc/nginx/tls/server.key};
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:SSL:10m;

  # Nothing here is for a crawler, and nothing here is large.
  client_max_body_size 64k;
  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;

  # Refused before the console does any work, and \`nodelay\` so that refusing
  # is what it does. Without it nginx queues an over-rate request instead of
  # rejecting it — which sounds gentler and is not: it delayed every step of a
  # legitimate sign-in to the configured interval, and signing in is three
  # requests, so the console appeared to hang rather than to be busy.
  location = /sign-in {
    limit_req zone=admin_signin burst=10 nodelay;
    proxy_pass http://admin_console;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  # Served here rather than proxied: the console asks for the same three faces
  # the tenants' pages do, and they are files in this image. Proxying them
  # would ask the console for a font it has no reason to hold.
  location /fonts/ {
    root /usr/share/nginx/html;
    access_log off;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable" always;
  }

  location / {
    proxy_pass http://admin_console;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF
else
  : > "$ADMIN"
fi

exec nginx -g 'daemon off;'
