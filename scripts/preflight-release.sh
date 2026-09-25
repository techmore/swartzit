#!/usr/bin/env bash
# Migration preflight for a candidate Swartzit server release.
#
# Restores the latest backup into a throwaway database, starts the *candidate*
# binary against that restored copy, and waits for /health. If the candidate's
# SQLx migrations are incompatible with the data the production instance is
# currently serving, the rehearsal fails here, before any live service is
# touched and before the production database is migrated.
#
# The rehearsal uses a disposable role with a random password so the production
# credential is never reused, never logged, and never appears in `ps`.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/postgres-native-lib.sh
source "$ROOT/scripts/postgres-native-lib.sh"
swartzit_pg_resolve_run_as

BINARY=${1:-}
BACKUP=${2:-}
# The binary does not need to arrive executable: a mode-0755 copy is staged
# below before it runs. Requiring the execute bit here would reject a freshly
# downloaded release asset, which curl creates as 0644.
[[ -f "$BINARY" && -f "$BACKUP" ]] || { echo "Usage: $0 /path/to/swartzit-server /path/to/swartzit.dump" >&2; exit 2; }
swartzit_pg_require_tools psql pg_restore createdb dropdb dropuser curl python3

SERVICE_DATABASE_URL=${SWARTZIT_SERVICE_DATABASE_URL:-}
if [[ -z "$SERVICE_DATABASE_URL" ]]; then
  if ! SERVICE_DATABASE_URL=$(swartzit_pg_service_database_url); then
    echo 'Could not read the service DATABASE_URL. Set SWARTZIT_DATABASE_URL or SWARTZIT_DATABASE_URL_FILE.' >&2
    exit 2
  fi
fi
# macOS still ships bash 3.2, so read the parsed URL parts without mapfile.
URL_PARTS=""
while IFS= read -r line; do
  URL_PARTS="${URL_PARTS}${URL_PARTS:+
}$line"
done < <(swartzit_pg_url_parts "$SERVICE_DATABASE_URL")
SCHEME=$(printf '%s\n' "$URL_PARTS" | sed -n 1p)
PARSED_HOST=$(printf '%s\n' "$URL_PARTS" | sed -n 2p)
PARSED_PORT=$(printf '%s\n' "$URL_PARTS" | sed -n 3p)
PG_HOST=${SWARTZIT_PG_HOST:-${PARSED_HOST:-127.0.0.1}}
PG_PORT=${SWARTZIT_PG_PORT:-${PARSED_PORT:-5432}}
if [[ -z "$PG_HOST" ]]; then
  # A socket-only service URL cannot be reused for a disposable role, because
  # peer authentication maps roles to OS users. TCP on loopback is the same
  # endpoint in every supported deployment.
  PG_HOST=127.0.0.1
fi

SUFFIX="$$_$(date +%s)"
TEST_DB="swartzit_preflight_${SUFFIX}"
TEST_ROLE="swartzit_preflight_${SUFFIX}"
TEST_PASSWORD=$(swartzit_pg_random_password)
TEST_PORT=${SWARTZIT_PREFLIGHT_PORT:-18081}
TEST_URL="http://127.0.0.1:${TEST_PORT}/health"
# The rehearsal talks to the same endpoint the service uses, so the admin
# helper is pointed at that host/port rather than the local socket default.
SWARTZIT_PG_ADMIN_HOST=$PG_HOST
SWARTZIT_PG_ADMIN_PORT=$PG_PORT
# The service account has to be able to read the staged binary, and a private
# root-owned temp directory would hide it.
STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/swartzit-preflight.XXXXXX")
chmod 0755 "$STAGE_DIR"
STAGED_BINARY="$STAGE_DIR/swartzit-server"
install -m 0755 "$BINARY" "$STAGED_BINARY"
LOG="$STAGE_DIR/server.log"

cleanup() {
  if [[ -n "${TEST_PID:-}" ]] && kill -0 "$TEST_PID" >/dev/null 2>&1; then
    kill "$TEST_PID" >/dev/null 2>&1 || true
    wait "$TEST_PID" 2>/dev/null || true
  fi
  swartzit_pg_drop_rehearsal "$TEST_DB" "$TEST_ROLE" || true
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

echo "Preflighting against ${SCHEME}://${PG_HOST}:${PG_PORT} using restored database ${BACKUP}."
swartzit_pg_admin psql -d postgres -v ON_ERROR_STOP=1 -q -c \
  "create role \"$TEST_ROLE\" login password '$TEST_PASSWORD'" >/dev/null
# The rehearsal role owns the copy, so a --no-owner restore needs no superuser
# and cannot reach any production object.
swartzit_pg_admin createdb -O "$TEST_ROLE" "$TEST_DB"
swartzit_pg_as_role "$TEST_ROLE" "$TEST_PASSWORD" "$PG_HOST" "$PG_PORT" "$TEST_DB" \
  pg_restore --no-owner --exit-on-error "$BACKUP"

TEST_DATABASE_URL="${SCHEME}://${TEST_ROLE}:${TEST_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB}"

wait_for_health() {
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "$1" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$TEST_PID" >/dev/null 2>&1; then
      return 2
    fi
    sleep 1
  done
  return 1
}

# An explicit port is honoured. Otherwise a free loopback port is chosen per
# attempt, so a busy host or an unrelated service cannot fail a rehearsal.
for attempt in 1 2 3; do
  if [[ -n "${SWARTZIT_PREFLIGHT_PORT:-}" ]]; then
    TEST_PORT="$SWARTZIT_PREFLIGHT_PORT"
  else
    TEST_PORT=$(swartzit_pg_free_port)
  fi
  TEST_URL="http://127.0.0.1:${TEST_PORT}/health"
  echo "Preflight attempt $attempt on 127.0.0.1:${TEST_PORT}."
  env \
    DATABASE_URL="$TEST_DATABASE_URL" \
    BIND_ADDR="127.0.0.1:${TEST_PORT}" \
    SWARTZIT_ORIGIN="http://127.0.0.1:${TEST_PORT}" \
    SWARTZIT_CHECK_URL="$TEST_URL" \
    SWARTZIT_STATE_DIR="$STAGE_DIR/state" \
    SWARTZIT_DATA_DIR="$STAGE_DIR/state" \
    "$STAGED_BINARY" > "$LOG" 2>&1 &
  TEST_PID=$!
  set +e
  wait_for_health "$TEST_URL"
  RESULT=$?
  set -e
  TEST_PID=''
  case "$RESULT" in
    0)
      echo 'Release preflight passed: migrations applied and /health served on the restored database.'
      exit 0
      ;;
    2)
      if grep -q 'Address already in use' "$LOG" && [[ -z "${SWARTZIT_PREFLIGHT_PORT:-}" ]]; then
        echo 'Candidate server lost a port race; retrying on another port.'
        continue
      fi
      echo 'Release preflight failed: the candidate server exited during startup.' >&2
      sed 's/^/  /' "$LOG" >&2
      exit 1
      ;;
    *)
      echo 'Release preflight failed: the candidate server never became healthy.' >&2
      sed 's/^/  /' "$LOG" >&2
      exit 1
      ;;
  esac
done

echo 'Release preflight failed: no loopback port was available for the rehearsal.' >&2
exit 1
