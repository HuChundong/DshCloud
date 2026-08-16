#!/bin/sh
# Whether the backend inside this sandbox holds a placeholder where the model
# credential would be. Reads `EXPECTED` from the prelude `verify.sh` prepends.
#
# The comparison happens here, inside the sandbox, and the answer is one word.
# A run that fails is a run where the real credential reached a tenant's
# machine, and reporting that by printing it would put it in a terminal, a CI
# log, and whatever collects either.

for p in /proc/[0-9]*; do
  grep -qa 'lib/bin.js' "$p/cmdline" 2>/dev/null || continue
  key=$(tr '\0' '\n' < "$p/environ" | sed -n 's/^DEEPSEEK_API_KEY=//p')
  if [ "$key" = "$EXPECTED" ]; then echo placeholder; else echo 'some other value'; fi
  break
done
