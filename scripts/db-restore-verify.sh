#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
BACKUP="${1:-}"
[[ -f "$BACKUP" ]] || { echo "Usage: $0 /absolute/path/to/swartzit.dump" >&2; exit 2; }
BACKUP_DIR="$(cd "$(dirname "$BACKUP")" && pwd)"
TEST_CONTAINER="${SWARTZIT_VERIFY_CONTAINER:-swartzit-db-restore}"
TEST_VOLUME="${SWARTZIT_VERIFY_VOLUME:-swartzit-db-restore-data}"
DB_USER="${SWARTZIT_DB_USER:-swartzit}"
DB_NAME="${SWARTZIT_DB_NAME:-swartzit}"
TEST_PORT="${SWARTZIT_VERIFY_PORT:-54330}"
cleanup() {
  container stop "$TEST_CONTAINER" >/dev/null 2>&1 || true
  container rm "$TEST_CONTAINER" >/dev/null 2>&1 || true
  container volume rm "$TEST_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
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
container exec "$TEST_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc "select tablename || E'\\t' || (xpath('/table/row/count/text()', query_to_xml('select count(*) as count from ' || quote_ident(tablename), true, false, '')))[1]::text from pg_tables where schemaname='public' and tablename <> '_sqlx_migrations' order by tablename" > "$BACKUP_DIR/restored-row-counts.tsv"
diff -u "$BACKUP_DIR/source-row-counts.tsv" "$BACKUP_DIR/restored-row-counts.tsv"
container exec "$TEST_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc 'select count(*) from posts' | grep -Eq '^[0-9]+$'
echo "Restore verification passed: $TEST_CONTAINER on port $TEST_PORT"
echo "Restored counts: $BACKUP_DIR/restored-row-counts.tsv"
