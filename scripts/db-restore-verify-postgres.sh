#!/usr/bin/env bash
# Restore rehearsal for a native PostgreSQL Swartzit backup.
#
# Restores a dump into a throwaway database, diffs the restored per-table row
# counts against the counts captured at backup time, and drops the database.
# The production database is never touched. Run this before every release.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/postgres-native-lib.sh
source "$ROOT/scripts/postgres-native-lib.sh"
swartzit_pg_resolve_run_as

BACKUP=${1:-}
[[ -n "$BACKUP" ]] || { echo "Usage: $0 /path/to/swartzit.dump-or-backup.tgz" >&2; exit 2; }
[[ -f "$BACKUP" ]] || { echo "Backup not found: $BACKUP" >&2; exit 2; }
swartzit_pg_require_tools psql pg_restore createdb dropdb dropuser tar

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/swartzit-postgres-verify.XXXXXX")
SUFFIX="$$_$(date +%s)"
TEST_DB="swartzit_verify_${SUFFIX}"
TEST_ROLE="swartzit_verify_${SUFFIX}"
TEST_PASSWORD=$(swartzit_pg_random_password)
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

cleanup() {
  swartzit_pg_drop_rehearsal "$TEST_DB" "$TEST_ROLE" || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

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
  "create role \"$TEST_ROLE\" login password '$TEST_PASSWORD'" >/dev/null
swartzit_pg createdb "${ADMIN_ENDPOINT[@]}" -O "$TEST_ROLE" "$TEST_DB"
swartzit_pg_as_role "$TEST_ROLE" "$TEST_PASSWORD" "$ADMIN_HOST" "${ADMIN_PORT:-5432}" "$TEST_DB" \
  pg_restore --no-owner --exit-on-error "$BACKUP"
swartzit_pg_table_row_counts "$TEST_DB" > "$WORK_DIR/restored-row-counts.tsv"
cp "$WORK_DIR/restored-row-counts.tsv" "$REPORT_PATH"

STATUS=0
if [[ -f "$SOURCE_COUNTS" ]]; then
  if diff -u "$SOURCE_COUNTS" "$WORK_DIR/restored-row-counts.tsv"; then
    echo 'Row counts match the backup manifest.'
  else
    echo 'Restored row counts differ from the backup manifest.' >&2
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
