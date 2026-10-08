#!/usr/bin/env bash
# Migration preflight for a candidate Swartzit server release.
#
# Starts the candidate against a restored, disposable copy of the latest
# backup and waits for /health before changing the live checkout or service.
# SQLite rehearsals need no database daemon. PostgreSQL backups retain their
# disposable-role restore path for releases preceding the SQLite cutover.
#
# The rehearsal server closes fd 9 so it cannot retain the updater's lock.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BINARY=${1:-}
BACKUP=${2:-}
# Downloaded release assets may arrive with mode 0644; stage an executable copy.
[[ -f "$BINARY" && -f "$BACKUP" ]] || { echo "Usage: $0 /path/to/swartzit-server /path/to/swartzit.dump" >&2; exit 2; }
BACKUP="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"
for tool in curl python3; do
  command -v "$tool" >/dev/null || { echo "$tool is required for release preflight." >&2; exit 1; }
done
PREFLIGHT_BACKEND=$(python3 - "$BACKUP" <<'PY_BACKEND'
import sys
with open(sys.argv[1], 'rb') as source:
    print('sqlite' if source.read(16) == b'SQLite format 3\x00' else 'postgres')
PY_BACKEND
)
STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/swartzit-preflight.XXXXXX")
chmod 0755 "$STAGE_DIR"
STAGED_BINARY="$STAGE_DIR/swartzit-server"
LOG="$STAGE_DIR/server.log"
TEST_DB=''
TEST_ROLE=''
cleanup() {
  if [[ -n "${TEST_PID:-}" ]] && kill -0 "$TEST_PID" >/dev/null 2>&1; then
    kill "$TEST_PID" >/dev/null 2>&1 || true
    wait "$TEST_PID" 2>/dev/null || true
  fi
  if [[ "$PREFLIGHT_BACKEND" == postgres && -n "$TEST_DB" ]]; then
    swartzit_pg_drop_rehearsal "$TEST_DB" "$TEST_ROLE" || true
  fi
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT
install -m 0755 "$BINARY" "$STAGED_BINARY"

if [[ "$PREFLIGHT_BACKEND" == sqlite ]]; then
  SQLITE_TOOL="$ROOT/scripts/sqlite-db.py"
  [[ -f "$SQLITE_TOOL" ]] || { echo 'The SQLite database helper is missing from the release tools.' >&2; exit 1; }
  python3 "$SQLITE_TOOL" verify "$BACKUP"
  TEST_DATABASE_PATH="$STAGE_DIR/database.sqlite"
  python3 "$SQLITE_TOOL" backup "sqlite:$BACKUP" "$TEST_DATABASE_PATH"
  chmod 0600 "$TEST_DATABASE_PATH"
  TEST_DATABASE_URL="sqlite:$TEST_DATABASE_PATH"
  echo "Preflighting SQLite release against a restored copy of $BACKUP."
else
  # Only the legacy path requires PostgreSQL tools or administrator access.
  # shellcheck source=scripts/postgres-native-lib.sh
  source "$ROOT/scripts/postgres-native-lib.sh"
  swartzit_pg_resolve_run_as
  swartzit_pg_require_tools psql pg_restore createdb dropdb dropuser
  SERVICE_DATABASE_URL=${SWARTZIT_SERVICE_DATABASE_URL:-}
  if [[ -z "$SERVICE_DATABASE_URL" ]]; then
    if ! SERVICE_DATABASE_URL=$(swartzit_pg_service_database_url); then
      echo 'Could not read the service DATABASE_URL. Set SWARTZIT_DATABASE_URL or SWARTZIT_DATABASE_URL_FILE.' >&2
      exit 2
    fi
  fi
  # macOS bash 3.2 has no mapfile.
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
  [[ -n "$PG_HOST" ]] || PG_HOST=127.0.0.1
  SUFFIX="$$_$(date +%s)"
  TEST_DB="swartzit_preflight_${SUFFIX}"
  TEST_ROLE="swartzit_preflight_${SUFFIX}"
  TEST_PASSWORD=$(swartzit_pg_random_password)
  echo "Preflighting against ${SCHEME}://${PG_HOST}:${PG_PORT} using restored database ${BACKUP}."
  swartzit_pg_admin psql -d postgres -v ON_ERROR_STOP=1 -q -c \
    "create role \"$TEST_ROLE\" login password '$TEST_PASSWORD'; grant \"$TEST_ROLE\" to \"$SWARTZIT_PG_ADMIN_USER\" with set true" >/dev/null
  swartzit_pg_admin createdb -O "$TEST_ROLE" "$TEST_DB"
  swartzit_pg_as_role "$TEST_ROLE" "$TEST_PASSWORD" "$PG_HOST" "$PG_PORT" "$TEST_DB" \
    pg_restore --no-owner --exit-on-error "$BACKUP"
  TEST_DATABASE_URL="${SCHEME}://${TEST_ROLE}:${TEST_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB}"
fi

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
    TEST_PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
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
    SWARTZIT_MEDIA_ROOT="$STAGE_DIR/state/media" \
    SWARTZIT_MEDIA_CACHE_DIR="$STAGE_DIR/state/cache" \
    SWARTZIT_DISABLE_MAINTENANCE=1 \
    "$STAGED_BINARY" 9>&- > "$LOG" 2>&1 &
  TEST_PID=$!
  set +e
  wait_for_health "$TEST_URL"
  RESULT=$?
  set -e
  case "$RESULT" in
    0)
      # Leave TEST_PID set so cleanup() stops the rehearsal server. Clearing it
      # here orphaned the server: it outlived the script, was reparented to
      # init, and kept holding this deployment's inherited descriptors --
      # including the release lock, which wedged every later deploy with
      # "Another Swartzit release update is already running".
      echo 'Release preflight passed: migrations applied and /health served on the restored database.'
      exit 0
      ;;
    2)
      if grep -q 'Address already in use' "$LOG" && [[ -z "${SWARTZIT_PREFLIGHT_PORT:-}" ]]; then
        # A loop iteration does not run cleanup(), so stop the server here.
        if [[ -n "${TEST_PID:-}" ]] && kill -0 "$TEST_PID" >/dev/null 2>&1; then
          kill "$TEST_PID" >/dev/null 2>&1 || true
          wait "$TEST_PID" 2>/dev/null || true
        fi
        TEST_PID=''
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
