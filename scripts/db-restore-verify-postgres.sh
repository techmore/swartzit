#!/usr/bin/env bash
set -euo pipefail

BACKUP=${1:-}
[[ -f "$BACKUP" ]] || { echo "Usage: $0 /path/to/swartzit.dump-or-backup.tgz" >&2; exit 2; }
DB_USER=${SWARTZIT_DB_USER:-swartzit}
DB_NAME=${SWARTZIT_DB_NAME:-swartzit}
DB_HOST=${SWARTZIT_DB_HOST:-/var/run/postgresql}
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/swartzit-postgres-verify.XXXXXX")
TEST_DB="swartzit_verify_$$_$(date +%s)"
cleanup() {
  if [[ "$(id -u)" -eq 0 ]]; then runuser -u postgres -- dropdb --if-exists -h "$DB_HOST" "$TEST_DB" >/dev/null 2>&1 || true; else sudo -n -u postgres dropdb --if-exists -h "$DB_HOST" "$TEST_DB" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT
if [[ "$BACKUP" == *.tgz ]]; then tar -xzf "$BACKUP" -C "$WORK_DIR"; BACKUP="$WORK_DIR/swartzit.dump"; SOURCE_COUNTS="$WORK_DIR/source-row-counts.tsv"; else SOURCE_COUNTS="$(dirname "$BACKUP")/source-row-counts.tsv"; fi
as_postgres() { if [[ "$(id -u)" -eq 0 ]]; then runuser -u postgres -- "$@"; else sudo -n -u postgres "$@"; fi; }
as_postgres createdb -h "$DB_HOST" -O "$DB_USER" "$TEST_DB"
as_postgres pg_restore -h "$DB_HOST" -U "$DB_USER" -d "$TEST_DB" --no-owner --exit-on-error "$BACKUP"
as_postgres psql -h "$DB_HOST" -U "$DB_USER" -d "$TEST_DB" -Atqc "select tablename || E'\\t' || (xpath('/table/row/count/text()', query_to_xml('select count(*) as count from ' || quote_ident(tablename), true, false, '')))[1]::text from pg_tables where schemaname='public' and tablename <> '_sqlx_migrations' order by tablename" > "$WORK_DIR/restored-row-counts.tsv"
[[ -f "$SOURCE_COUNTS" ]] && diff -u "$SOURCE_COUNTS" "$WORK_DIR/restored-row-counts.tsv"
as_postgres psql -h "$DB_HOST" -U "$DB_USER" -d "$TEST_DB" -Atqc 'select count(*) from posts' | grep -Eq '^[0-9]+$'
echo "PostgreSQL restore verification passed: $TEST_DB"
echo "Restored counts: $WORK_DIR/restored-row-counts.tsv"
