#!/usr/bin/env bash
set -euo pipefail

# Writes Tandoor's OpenAPI schema to specs/tandoor.json, reformatted so the
# committed diff shows semantic drift rather than reflow noise. Generates it
# from the latest official image by default; set TANDOOR_URL to fetch from a
# running instance instead.

raw="$(mktemp)"
trap 'rm -f "$raw"' EXIT

if [[ -n "${TANDOOR_URL:-}" ]]; then
    curl -fsSL "${TANDOOR_URL%/}/api/schema/" -o "$raw"
else
    docker run --rm --pull always \
        -e SECRET_KEY=schema-only -e DB_ENGINE=django.db.backends.sqlite3 -e POSTGRES_DB=/tmp/db.sqlite3 \
        --entrypoint sh vabene1111/recipes:latest \
        -c 'cd /opt/recipes && venv/bin/python manage.py spectacular --format openapi-json --file /tmp/s.json >/dev/null 2>&1 && cat /tmp/s.json' \
        > "$raw"
fi

mkdir -p specs
node -e "
const fs = require('node:fs');
const doc = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
fs.writeFileSync('specs/tandoor.json', JSON.stringify(doc, null, 2) + '\n');
" "$raw"

echo "Wrote specs/tandoor.json"
