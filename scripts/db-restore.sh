#!/usr/bin/env bash
set -euo pipefail

SCRIPT_HOME=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_HOME/.." && pwd)
if [[ -x "$ROOT/scripts/swartzit" ]]; then
  LAUNCHER="$ROOT/scripts/swartzit"
else
  LAUNCHER="$ROOT/bin/swartzit"
fi
[[ -x "$LAUNCHER" ]] || { echo "Swartzit launcher was not found." >&2; exit 1; }

if [[ -n "${SWARTZIT_STATE_DIR:-}" ]]; then
  STATE_DIR="$SWARTZIT_STATE_DIR"
elif [[ -d "$ROOT/.git" || -d "$ROOT/.local" ]]; then
  STATE_DIR="$ROOT/.local"
else
  STATE_DIR="${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}"
fi
mkdir -p "$STATE_DIR"

BACKUP=""
CONFIRMED=0
LEAVE_STOPPED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup)
      BACKUP="${2:-}"
      shift 2
      ;;
    --yes)
      CONFIRMED=1
      shift
      ;;
    --leave-stopped)
      LEAVE_STOPPED=1
      shift
      ;;
    *)
      echo "Usage: $0 --backup /absolute/path/to/swartzit.dump --yes [--leave-stopped]" >&2
      exit 2
      ;;
  esac
done

if [[ "$CONFIRMED" != 1 || -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "Rollback requires --backup FILE --yes." >&2
  exit 2
fi

BACKUP_DIR=$(cd "$(dirname "$BACKUP")" && pwd)
BACKUP="$BACKUP_DIR/$(basename "$BACKUP")"
CONTAINER="${SWARTZIT_DB_CONTAINER:-swartzit-db}"
DB_USER="${SWARTZIT_DB_USER:-swartzit}"
DB_NAME="${SWARTZIT_DB_NAME:-swartzit}"
BACKUP_ROOT="${SWARTZIT_BACKUP_DIR:-$STATE_DIR/backups}"
TEMP_DUMP=/tmp/swartzit-rollback.dump

if [[ -f "$BACKUP_DIR/SHA256SUMS" ]]; then
  (cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS)
fi

container inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "Database container $CONTAINER was not found." >&2
  exit 1
}
container exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

cleanup() {
  container exec "$CONTAINER" rm -f "$TEMP_DUMP" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Stopping Swartzit before restoring the database."
"$LAUNCHER" stop

echo "Creating a pre-rollback backup."
backup_output=$(SWARTZIT_BACKUP_DIR="$BACKUP_ROOT" "$SCRIPT_HOME/db-backup.sh")
printf '%s\n' "$backup_output"
pre_restore_path=$(printf '%s\n' "$backup_output" | sed -n 's/^Backup: //p' | head -n 1)
pre_restore_archive=$(printf '%s\n' "$backup_output" | sed -n 's/^Archive: //p' | head -n 1)
[[ -n "$pre_restore_path" && -f "$pre_restore_path" ]] || {
  echo "The pre-rollback backup path could not be determined." >&2
  exit 1
}

echo "Restoring $BACKUP into $CONTAINER."
container cp "$BACKUP" "$CONTAINER:$TEMP_DUMP"
container exec "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" \
  --clean --if-exists --no-owner --exit-on-error "$TEMP_DUMP"

if (( LEAVE_STOPPED )); then
  final_status=database-restored
else
  echo "Starting Swartzit and waiting for health checks."
  healthy=0
  status_output=""
  for attempt in {1..20}; do
    "$LAUNCHER" start >/dev/null 2>&1 || true
    if status_output=$("$LAUNCHER" status --json 2>&1); then
      healthy=1
      break
    fi
    "$LAUNCHER" stop >/dev/null 2>&1 || true
    sleep 1
  done
  if (( ! healthy )); then
    echo "Rollback restored the database, but Swartzit did not pass health checks." >&2
    printf '%s\n' "$status_output" >&2
    echo "Pre-rollback backup: $pre_restore_path" >&2
    echo "Pre-rollback archive: $pre_restore_archive" >&2
    exit 1
  fi
  final_status=healthy
fi

printf '{"completed_at":"%s","restored_backup":"%s","pre_restore_backup":"%s","pre_restore_archive":"%s","status":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$BACKUP" "$pre_restore_path" "$pre_restore_archive" "$final_status" \
  > "$STATE_DIR/last-rollback.json"
echo "Database rollback completed: $final_status"
echo "Pre-rollback backup: $pre_restore_path"
