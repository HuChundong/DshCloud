#!/bin/sh
# Make sure the front door has a certificate, then serve.
#
# Generated here rather than baked into the image: a certificate in an image is
# the same certificate — and the same private key — for everyone who pulls it.
# Generated only when absent, so mounting a real certificate over
# /etc/nginx/tls replaces this one and nothing overwrites it.
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

exec nginx -g 'daemon off;'
