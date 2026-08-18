#!/bin/sh
# Which of the promised tools a tenant's agent can actually reach.
#
# Run with the backend's own PATH prepended by the caller, because that is the
# only version of the question that matters: envd starts the backend with a
# clean environment, so anything installed outside the default directories —
# the Python virtualenv in particular — exists only if the entrypoint's
# environment file carried PATH across.
#
# Fed to the sandbox base64-encoded, so that neither `docker exec sh -c` nor
# envd's `bash -l -c` has to survive the quoting.

for tool in python pip officecli rg fd jq sqlite3 pdftotext bsdtar; do
  command -v "$tool" > /dev/null 2>&1 || printf '%s ' "$tool"
done
# The skill root travels the same way the tools do — through the environment
# file envd's clean start would otherwise drop.
test -f "${DSH_BUNDLED_SKILL_DIR:-/nowhere}/officecli/SKILL.md" || printf 'officecli-skill '
echo
