#!/usr/bin/env bash
set -euo pipefail

BINARY=${1:-}
BACKUP=${2:-}
[[ -x "$BINARY" && -f "$BACKUP" ]] || { echo "Usage: $0 /path/to/swartzit-server /path/to/swartzit.dump" >&2; exit 2; }
DB_USER=${SWARTZIT_DB_USER:-swartzit}
DB_NAME=${SWARTZIT_DB_NAME:-swartzit}
DB_HOST=${SWARTZIT_DB_HOST:-/var/run/postgresql}
TEST_DB="swartzit_preflight_$$_$(date +%s)"
TEST_PORT=${SWARTZIT_PREFLIGHT_PORT:-18081}
TEST_URL="http://127.0.0.1:${TEST_PORT}/health"
as_postgres() { if [[ "$(id -u)" -eq 0 ]]; then runuser -u postgres -- "$@"; else sudo -n -u postgres "$@"; fi; }
cleanup() {
  [[ -n "${TEST_PID:-}" ]] && kill "$TEST_PID" >/dev/null 2>&1 || true
  as_postgres dropdb --if-exists -h "$DB_HOST" "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
as_postgres createdb -h "$DB_HOST" -O "$DB_USER" "$TEST_DB"
as_postgres pg_restore -h "$DB_HOST" -U "$DB_USER" -d "$TEST_DB" --no-owner --exit-on-error "$BACKUP"
TEST_DATABASE_URL="postgres://$DB_USER@/$TEST_DB"
runuser -u swartzit -- env DATABASE_URL="$TEST_DATABASE_URL" BIND_ADDR="127.0.0.1:$TEST_PORT" ORIGIN="http://127.0.0.1:$TEST_PORT" "$BINARY" > /tmp/swartzit-preflight.log 2>&1 &
TEST_PID=$!
for _ in {1..45}; do
  if curl -fsS --max-time 2 "$TEST_URL" >/dev/null 2>&1; then echo "Release preflight passed: migrations and health check succeeded on restored database."; exit 0; fi
  kill -0 "$TEST_PID" 2>/dev/null || { cat /tmp/swartzit-preflight.log >&2; exit 1; }
  sleep 1
done
cat /tmp/swartzit-preflight.log >&2
echo 'Release preflight failed: the new binary did not become healthy against the restored database.' >&2
exit 1
