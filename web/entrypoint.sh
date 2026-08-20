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

exec nginx -g 'daemon off;'
