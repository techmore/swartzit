#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
CONTAINER="${SWARTZIT_DB_CONTAINER:-swartzit-db}"
DB_USER="${SWARTZIT_DB_USER:-swartzit}"
DB_NAME="${SWARTZIT_DB_NAME:-swartzit}"
BACKUP_ROOT="${SWARTZIT_BACKUP_DIR:-${SWARTZIT_DATA_DIR:-$ROOT/.local}/backups}"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
OUT_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$OUT_DIR"

container inspect "$CONTAINER" >/dev/null 2>&1 || { echo "Database container $CONTAINER was not found." >&2; exit 1; }
container exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null
container exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --file=/tmp/swartzit.dump
container cp "$CONTAINER:/tmp/swartzit.dump" "$OUT_DIR/swartzit.dump"
container exec "$CONTAINER" rm -f /tmp/swartzit.dump
container exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc "select tablename || E'\\t' || (xpath('/table/row/count/text()', query_to_xml('select count(*) as count from ' || quote_ident(tablename), true, false, '')))[1]::text from pg_tables where schemaname='public' and tablename <> '_sqlx_migrations' order by tablename" > "$OUT_DIR/row-counts.tsv"
shasum -a 256 "$OUT_DIR/swartzit.dump" > "$OUT_DIR/SHA256SUMS"
cp "$OUT_DIR/row-counts.tsv" "$OUT_DIR/source-row-counts.tsv"
tar -C "$OUT_DIR" -czf "$BACKUP_ROOT/swartzit-$STAMP-backup.tgz" swartzit.dump row-counts.tsv source-row-counts.tsv SHA256SUMS
echo "Backup: $OUT_DIR/swartzit.dump"
echo "Archive: $BACKUP_ROOT/swartzit-$STAMP-backup.tgz"
echo "Counts: $OUT_DIR/row-counts.tsv"
