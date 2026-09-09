#!/usr/bin/env sh
set -eu

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://askesis_test:askesis_test@127.0.0.1:55432/askesis_test}"
expected='postgres://askesis_test:askesis_test@127.0.0.1:55432/askesis_test'
if [ "$TEST_DATABASE_URL" != "$expected" ]; then
  echo "Refusing to run: TEST_DATABASE_URL must target the disposable local Askesis test database." >&2
  exit 1
fi

cleanup() {
  docker compose --profile test rm -sf postgres-test >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker compose --profile test up -d --wait postgres-test
docker compose --profile test run --rm --no-deps \
  -e DATABASE_URL='postgres://askesis_test:askesis_test@postgres-test:5432/askesis_test?sslmode=disable' \
  migrate migrate apply --env local
docker compose --profile test run --rm --no-deps \
  -e PGHOST=postgres-test \
  -e PGDATABASE=askesis_test \
  -e PGUSER=askesis_test \
  -e PGPASSWORD=askesis_test \
  seed sh /workspace/database/seed/seed.sh

NODE_ENV=test CLERK_SECRET_KEY=sk_test_fixture CLERK_PUBLISHABLE_KEY=pk_test_fixture DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @askesis/api fixture:publish
NODE_ENV=test CLERK_SECRET_KEY=sk_test_fixture CLERK_PUBLISHABLE_KEY=pk_test_fixture DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @askesis/api fixture:publish
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @askesis/api test:db

docker compose exec -T postgres-test psql \
  --username askesis_test --dbname askesis_test --set ON_ERROR_STOP=1 \
  < database/tests/plan-version-invariants.sql
