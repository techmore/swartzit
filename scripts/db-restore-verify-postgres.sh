#!/usr/bin/env bash
# Restore rehearsal for SQLite and legacy PostgreSQL Swartzit backups.
# The production database is never touched; restored counts are retained beside
# the input backup so an update has a concrete recovery verification receipt.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BACKUP=${1:-}
[[ -n "$BACKUP" ]] || { echo "Usage: $0 /path/to/swartzit.dump-or-backup.tgz" >&2; exit 2; }
[[ -f "$BACKUP" ]] || { echo "Backup not found: $BACKUP" >&2; exit 2; }
command -v python3 >/dev/null || { echo 'python3 is required for backup verification.' >&2; exit 1; }
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/swartzit-restore-verify.XXXXXX")
BACKUP_BACKEND=''
TEST_DB=''
TEST_ROLE=''
cleanup() {
  if [[ "$BACKUP_BACKEND" == postgres && -n "$TEST_DB" ]]; then
    swartzit_pg_drop_rehearsal "$TEST_DB" "$TEST_ROLE" || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT
SOURCE_COUNTS="$WORK_DIR/source-row-counts.tsv"
REPORT_PATH=""
if [[ "$BACKUP" == *.tgz ]]; then
  ARCHIVE_PATH="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"
  REPORT_PATH="${ARCHIVE_PATH%.tgz}.restored-row-counts.tsv"
  tar -xzf "$BACKUP" -C "$WORK_DIR"
  BACKUP="$WORK_DIR/swartzit.dump"
else
  BACKUP="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"
  REPORT_PATH="${BACKUP%.dump}.restored-row-counts.tsv"
  [[ -f "$SOURCE_COUNTS" ]] || SOURCE_COUNTS="$(cd "$(dirname "$BACKUP")" && pwd)/source-row-counts.tsv"
fi
[[ -f "$BACKUP" ]] || { echo 'The backup archive does not contain swartzit.dump.' >&2; exit 1; }
BACKUP_BACKEND=$(python3 - "$BACKUP" <<'PY_BACKEND'
import sys
with open(sys.argv[1], 'rb') as source:
    print('sqlite' if source.read(16) == b'SQLite format 3\x00' else 'postgres')
PY_BACKEND
)
if [[ "$BACKUP_BACKEND" == sqlite ]]; then
  SNAPSHOT_DIR=$(dirname "$BACKUP")
  if [[ -f "$SNAPSHOT_DIR/SHA256SUMS" ]]; then
    (cd "$SNAPSHOT_DIR" && shasum -a 256 -c SHA256SUMS)
  fi
  if [[ -f "$SNAPSHOT_DIR/media.tgz" ]]; then
    tar -tzf "$SNAPSHOT_DIR/media.tgz" >/dev/null
  fi
  SQLITE_TOOL="$ROOT/scripts/sqlite-db.py"
  [[ -f "$SQLITE_TOOL" ]] || { echo 'The SQLite database helper is missing from the release tools.' >&2; exit 1; }
  RESTORED_DATABASE="$WORK_DIR/restored.sqlite"
  python3 "$SQLITE_TOOL" backup "sqlite:$BACKUP" "$RESTORED_DATABASE"
  if [[ -f "$SOURCE_COUNTS" ]]; then
    python3 "$SQLITE_TOOL" verify "$RESTORED_DATABASE" "$SOURCE_COUNTS"
  else
    python3 "$SQLITE_TOOL" verify "$RESTORED_DATABASE"
    echo "No source row-count manifest found next to $BACKUP; reporting restored counts only." >&2
  fi
  python3 "$SQLITE_TOOL" counts "$RESTORED_DATABASE" > "$WORK_DIR/restored-row-counts.tsv"
  cp "$WORK_DIR/restored-row-counts.tsv" "$REPORT_PATH"
  TABLE_COUNT=$(wc -l < "$WORK_DIR/restored-row-counts.tsv" | tr -d ' ')
  ROW_TOTAL=$(awk -F'\t' '{ total += $2 } END { print total + 0 }' "$WORK_DIR/restored-row-counts.tsv")
  echo "Restored tables: $TABLE_COUNT"
  echo "Restored rows: $ROW_TOTAL"
  echo "Restored counts: $REPORT_PATH"
  echo 'SQLite restore rehearsal passed: integrity and foreign keys verified; restored counts recorded.'
  exit 0
fi

# Legacy PostgreSQL dumps remain verifiable without changing their restore path.
# shellcheck source=scripts/postgres-native-lib.sh
source "$ROOT/scripts/postgres-native-lib.sh"
swartzit_pg_resolve_run_as
swartzit_pg_require_tools psql pg_restore createdb dropdb dropuser
SUFFIX="$$_$(date +%s)"
TEST_DB="swartzit_verify_${SUFFIX}"
TEST_ROLE="swartzit_verify_${SUFFIX}"
TEST_PASSWORD=$(swartzit_pg_random_password)

# A dump that cannot even be listed is not a rehearsal candidate.
pg_restore --list "$BACKUP" >/dev/null

# The rehearsal role is disposable, owns only its own copy, and its throwaway
# password never appears in a logged command line. Restoring with --no-owner as
# that role needs no superuser and cannot reach a production object.
ADMIN_HOST=$SWARTZIT_PG_ADMIN_HOST
ADMIN_PORT=$SWARTZIT_PG_ADMIN_PORT
ADMIN_ENDPOINT=(-h "$ADMIN_HOST")
[[ -n "$ADMIN_PORT" ]] && ADMIN_ENDPOINT+=(-p "$ADMIN_PORT")
swartzit_pg psql "${ADMIN_ENDPOINT[@]}" -U "$SWARTZIT_PG_ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 -q -c \
  "create role \"$TEST_ROLE\" login password '$TEST_PASSWORD'; grant \"$TEST_ROLE\" to \"$SWARTZIT_PG_ADMIN_USER\" with set true" >/dev/null
swartzit_pg createdb "${ADMIN_ENDPOINT[@]}" -O "$TEST_ROLE" "$TEST_DB"
# The disposable role authenticates by password, so it must not use the admin's
# unix socket: peer authentication there would map the invoking OS account.
read -r ROLE_HOST ROLE_PORT < <(swartzit_pg_role_endpoint "$ADMIN_HOST" "$ADMIN_PORT")
swartzit_pg_as_role "$TEST_ROLE" "$TEST_PASSWORD" "$ROLE_HOST" "$ROLE_PORT" "$TEST_DB" \
  pg_restore --no-owner --exit-on-error "$BACKUP"
swartzit_pg_table_row_counts "$TEST_DB" > "$WORK_DIR/restored-row-counts.tsv"
cp "$WORK_DIR/restored-row-counts.tsv" "$REPORT_PATH"

STATUS=0
if [[ -f "$SOURCE_COUNTS" ]]; then
  if swartzit_pg_compare_row_counts "$SOURCE_COUNTS" "$WORK_DIR/restored-row-counts.tsv"; then
    echo 'Content table row counts match the backup manifest.'
  else
    echo 'Restored content row counts differ from the backup manifest.' >&2
    STATUS=1
  fi
else
  echo "No source row-count manifest found next to $BACKUP; reporting restored counts only." >&2
fi

TABLE_COUNT=$(wc -l < "$WORK_DIR/restored-row-counts.tsv" | tr -d ' ')
ROW_TOTAL=$(awk -F'\t' '{ total += $2 } END { print total + 0 }' "$WORK_DIR/restored-row-counts.tsv")
echo "Restored tables: $TABLE_COUNT"
echo "Restored rows: $ROW_TOTAL"
echo "Restored counts: $REPORT_PATH"
if ((TABLE_COUNT == 0)); then
  echo 'Restore rehearsal failed: the restored database has no public tables.' >&2
  STATUS=1
fi
if ((STATUS == 0)); then
  echo "PostgreSQL restore rehearsal passed: $TEST_DB"
fi
exit "$STATUS"
