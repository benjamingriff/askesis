#!/usr/bin/env sh
set -eu

. ./scripts/lib/disposable-compose.sh
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://askesis_test:askesis_test@127.0.0.1:${TEST_DATABASE_PORT}/askesis_test}"
expected="postgres://askesis_test:askesis_test@127.0.0.1:${TEST_DATABASE_PORT}/askesis_test"
if [ "$TEST_DATABASE_URL" != "$expected" ]; then
  echo "Refusing to run: TEST_DATABASE_URL must target the disposable local Askesis test database." >&2
  exit 1
fi

test_compose --profile test up -d --wait postgres-test
test_compose --profile test run --rm --no-deps \
  -e DATABASE_URL='postgres://askesis_test:askesis_test@postgres-test:5432/askesis_test?sslmode=disable' \
  migrate migrate apply --env local
test_compose --profile test run --rm --no-deps \
  -e PGHOST=postgres-test \
  -e PGDATABASE=askesis_test \
  -e PGUSER=askesis_test \
  -e PGPASSWORD=askesis_test \
  seed sh /workspace/database/seed/seed.sh

NODE_ENV=test CLERK_SECRET_KEY=sk_test_fixture CLERK_PUBLISHABLE_KEY=pk_test_fixture DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @askesis/api fixture:publish
NODE_ENV=test CLERK_SECRET_KEY=sk_test_fixture CLERK_PUBLISHABLE_KEY=pk_test_fixture DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @askesis/api fixture:publish
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @askesis/api test:db "$@"

test_compose exec -T postgres-test psql \
  --username askesis_test --dbname askesis_test --set ON_ERROR_STOP=1 \
  < database/tests/plan-version-invariants.sql
