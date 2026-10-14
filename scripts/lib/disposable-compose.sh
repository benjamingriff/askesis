# Source from a repository-root test script. Each invocation owns its project.
test_root=$(pwd)
test_project="askesis-test-$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
test_file="${DISPOSABLE_COMPOSE_FILE:-compose.yaml}"
test_temporary=$(mktemp -d)
export TEST_DATABASE_PORT="${TEST_DATABASE_PORT:-$(node scripts/lib/free-port.mjs)}"
export SMOKE_WEB_PORT="${SMOKE_WEB_PORT:-$(node scripts/lib/free-port.mjs)}"

# Optional explicit subnet for machines whose automatic Docker pools are exhausted.
# The operator must check LAN/VPN/Docker routes first; Docker rejects pool overlaps.
if [ -n "${TEST_NETWORK_SUBNET:-}" ]; then
  node -e 'const s=process.argv[1]; if(!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/(?:[1-9]|[12][0-9]|30)$/.test(s) || s.split("/")[0].split(".").some(x=>+x>255)) process.exit(1); process.stdout.write(JSON.stringify({networks:{default:{ipam:{config:[{subnet:s}]}}}}))' "$TEST_NETWORK_SUBNET" > "$test_temporary/network.json" || { rm -rf "$test_temporary"; exit 1; }
fi

test_compose() {
  if [ -n "${TEST_NETWORK_SUBNET:-}" ]; then
    docker compose --env-file /dev/null --project-name "$test_project" -f "$test_root/$test_file" -f "$test_temporary/network.json" --profile test "$@"
    return
  fi
  docker compose --env-file /dev/null --project-name "$test_project" -f "$test_root/$test_file" --profile test "$@"
}

test_cleanup() {
  result=$?
  trap - EXIT INT TERM
  # Only generated images in this unique project; shared tagged base images remain.
  if ! test_compose down --volumes --remove-orphans --rmi local; then
    echo "Cleanup failed for $test_project; retry docker compose --env-file /dev/null -p $test_project -f $test_root/$test_file --profile test down --volumes --remove-orphans --rmi local" >&2
    result=1
  fi
  remaining=$(docker ps -aq --filter "label=com.docker.compose.project=$test_project") || result=1
  if [ -n "$remaining" ]; then
    echo "Containers remain in $test_project; cleanup did not complete." >&2
    result=1
  fi
  rm -rf "$test_temporary"
  exit "$result"
}
trap test_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
