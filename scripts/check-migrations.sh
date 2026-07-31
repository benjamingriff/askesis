#!/usr/bin/env sh
set -eu

original=$(mktemp)
cleanup() { rm -f "$original"; }
trap cleanup EXIT INT TERM
cp database/migrations/atlas.sum "$original"

if command -v atlas >/dev/null 2>&1; then
  atlas migrate hash --dir file://database/migrations
else
  docker run --rm \
    -v "$PWD/database:/workspace/database" \
    -w /workspace/database \
    arigaio/atlas:1.2.3 \
    migrate hash --dir file://migrations
fi

cmp "$original" database/migrations/atlas.sum
