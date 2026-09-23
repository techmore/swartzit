#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
BACKUP="${1:-}"
[[ -f "$BACKUP" ]] || { echo "Usage: $0 /absolute/path/to/swartzit.dump-or-backup.tgz" >&2; exit 2; }
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/swartzit-restore-verify.XXXXXX")"
if [[ "$BACKUP" == *.tgz ]]; then
  ARCHIVE_PATH="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"
  tar -xzf "$BACKUP" -C "$WORK_DIR"
  BACKUP_DIR="$WORK_DIR"
  BACKUP="$WORK_DIR/swartzit.dump"
  REPORT_PATH="${ARCHIVE_PATH%.tgz}.restored-row-counts.tsv"
else
  BACKUP_DIR="$(cd "$(dirname "$BACKUP")" && pwd)"
  BACKUP="$BACKUP_DIR/$(basename "$BACKUP")"
  REPORT_PATH="$BACKUP_DIR/restored-row-counts.tsv"
fi
TEST_CONTAINER="${SWARTZIT_VERIFY_CONTAINER:-swartzit-db-restore}"
TEST_VOLUME="${SWARTZIT_VERIFY_VOLUME:-swartzit-db-restore-data}"
DB_USER="${SWARTZIT_DB_USER:-swartzit}"
DB_NAME="${SWARTZIT_DB_NAME:-swartzit}"
TEST_PORT="${SWARTZIT_VERIFY_PORT:-54330}"
cleanup() {
  container stop "$TEST_CONTAINER" >/dev/null 2>&1 || true
  container rm "$TEST_CONTAINER" >/dev/null 2>&1 || true
  container volume rm "$TEST_VOLUME" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT
container stop "$TEST_CONTAINER" >/dev/null 2>&1 || true
container rm "$TEST_CONTAINER" >/dev/null 2>&1 || true
container volume rm "$TEST_VOLUME" >/dev/null 2>&1 || true
container run -d --name "$TEST_CONTAINER" -p "127.0.0.1:${TEST_PORT}:5432" \
  -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD=swartzit-restore-test \
  -e POSTGRES_DB="$DB_NAME" -e PGDATA=/var/lib/postgresql/data/pgdata \
  -v "$TEST_VOLUME:/var/lib/postgresql/data" docker.io/library/postgres:16 >/dev/null
for attempt in {1..45}; do
  if container exec "$TEST_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then break; fi
  [[ "$attempt" == 45 ]] && { echo 'Restore database did not become ready.' >&2; exit 1; }
  sleep 1
done
container cp "$BACKUP" "$TEST_CONTAINER:/tmp/swartzit.dump"
container exec "$TEST_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error /tmp/swartzit.dump
container exec "$TEST_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc "select tablename || E'\\t' || (xpath('/table/row/count/text()', query_to_xml('select count(*) as count from ' || quote_ident(tablename), true, false, '')))[1]::text from pg_tables where schemaname='public' and tablename <> '_sqlx_migrations' order by tablename" > "$REPORT_PATH"
diff -u "$BACKUP_DIR/source-row-counts.tsv" "$REPORT_PATH"
container exec "$TEST_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc 'select count(*) from posts' | grep -Eq '^[0-9]+$'
if [[ -f "$BACKUP_DIR/media.tgz" ]]; then
  mkdir -p "$WORK_DIR/media"
  tar -xzf "$BACKUP_DIR/media.tgz" -C "$WORK_DIR/media"
  media_files="$(find "$WORK_DIR/media" -type f | wc -l | tr -d ' ')"
  echo "Media archive verification passed: $media_files file(s)"
fi
echo "Restore verification passed: $TEST_CONTAINER on port $TEST_PORT"
echo "Restored counts: $REPORT_PATH"
