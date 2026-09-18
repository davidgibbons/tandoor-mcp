#!/usr/bin/env bash
set -euo pipefail

# Fetches Tandoor's OpenAPI schema (drf-spectacular, default path /api/schema/)
# and writes it reformatted, so the committed diff shows semantic drift rather
# than reflow noise. Needs TANDOOR_URL in the environment.

: "${TANDOOR_URL:?Set TANDOOR_URL to your Tandoor instance, e.g. https://recipes.example.com}"

mkdir -p specs
curl -fsSL "${TANDOOR_URL%/}/api/schema/" -o /tmp/tandoor-spec-raw.json

node -e "
const fs = require('node:fs');
const doc = JSON.parse(fs.readFileSync('/tmp/tandoor-spec-raw.json', 'utf8'));
fs.writeFileSync('specs/tandoor.json', JSON.stringify(doc, null, 2) + '\n');
"

rm -f /tmp/tandoor-spec-raw.json
echo "Wrote specs/tandoor.json"
