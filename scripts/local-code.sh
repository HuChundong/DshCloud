#!/bin/sh
# The verification code this deployment just minted, read from its own database.
#
# For a local run, where mail does not leave: `RESEND_API_KEY` is a placeholder,
# the send fails, and the code is already stored by then — `verification.open`
# writes the challenge before anything is handed to the mail provider. So the
# code is real and answerable; only its delivery is missing.
#
# Never against a deployment real people sign in to. Printing a live code
# bypasses the one thing the address is meant to prove, and the acceptance
# suite carries the same rule for the same reason.
set -eu

if [ "${SANDBOX_RUNTIME:-docker}" != "docker" ]; then
  echo "local-code: refusing to read codes from a deployment that is not the local simulation" >&2
  exit 2
fi

docker compose exec -T postgres psql -U "${POSTGRES_USER:-dsh}" -d "${POSTGRES_DB:-dsh}" -tAc \
  "SELECT email || '  ' || code || '  (' || date_trunc('second', expires_at - now()) || ' 后过期)'
     FROM challenges WHERE expires_at > now() ORDER BY expires_at DESC" \
  | sed 's/^/  /'
