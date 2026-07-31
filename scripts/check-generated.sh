#!/usr/bin/env sh
set -eu

temporary=$(mktemp -d)
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT INT TERM

cp packages/api-client/openapi.json "$temporary/openapi.json"
cp packages/api-client/src/schema.ts "$temporary/schema.ts"

pnpm generate:openapi

cmp "$temporary/openapi.json" packages/api-client/openapi.json
cmp "$temporary/schema.ts" packages/api-client/src/schema.ts
