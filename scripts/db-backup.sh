#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
CONTAINER="${SWARTZIT_DB_CONTAINER:-swartzit-db}"
DB_USER="${SWARTZIT_DB_USER:-swartzit}"
DB_NAME="${SWARTZIT_DB_NAME:-swartzit}"
RETENTION="${SWARTZIT_BACKUP_RETENTION:-7}"
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_BACKUP_RETENTION must be a positive integer.' >&2; exit 2; }
if [[ -n "${SWARTZIT_BACKUP_DIR:-}" ]]; then
  BACKUP_ROOT="$SWARTZIT_BACKUP_DIR"
elif [[ -n "${SWARTZIT_STATE_DIR:-}" ]]; then
  BACKUP_ROOT="$SWARTZIT_STATE_DIR/backups"
elif [[ -d "$ROOT/.git" || -d "$ROOT/.local" ]]; then
  BACKUP_ROOT="$ROOT/.local/backups"
else
  BACKUP_ROOT="${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}/backups"
fi
mkdir -p "$BACKUP_ROOT"
LOCK_DIR="$BACKUP_ROOT/.backup.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another Swartzit backup is already running: $BACKUP_ROOT" >&2
  exit 75
fi
cleanup_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup_lock EXIT

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
OUT_DIR="$BACKUP_ROOT/$STAMP"
while [[ -e "$OUT_DIR" || -e "$BACKUP_ROOT/swartzit-$STAMP-backup.tgz" ]]; do
  sleep 1
  STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
  OUT_DIR="$BACKUP_ROOT/$STAMP"
done
mkdir -p "$OUT_DIR"

if [[ -n "${SWARTZIT_MEDIA_ROOT:-}" ]]; then
  MEDIA_ROOT="$SWARTZIT_MEDIA_ROOT"
elif [[ -n "${SWARTZIT_STATE_DIR:-}" ]]; then
  MEDIA_ROOT="$SWARTZIT_STATE_DIR/media"
elif [[ -n "${SWARTZIT_DATA_DIR:-}" ]]; then
  MEDIA_ROOT="$SWARTZIT_DATA_DIR/media"
else
  MEDIA_ROOT="$HOME/Library/Application Support/Swartzit/media"
fi

container inspect "$CONTAINER" >/dev/null 2>&1 || { echo "Database container $CONTAINER was not found." >&2; exit 1; }
container exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null
container exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --file=/tmp/swartzit.dump
container cp "$CONTAINER:/tmp/swartzit.dump" "$OUT_DIR/swartzit.dump"
container exec "$CONTAINER" rm -f /tmp/swartzit.dump
container exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc "select tablename || E'\\t' || (xpath('/table/row/count/text()', query_to_xml('select count(*) as count from ' || quote_ident(tablename), true, false, '')))[1]::text from pg_tables where schemaname='public' and tablename <> '_sqlx_migrations' order by tablename" > "$OUT_DIR/row-counts.tsv"
if [[ -d "$MEDIA_ROOT" ]]; then
  tar -C "$MEDIA_ROOT" -czf "$OUT_DIR/media.tgz" .
  MEDIA_STATUS="included"
else
  MEDIA_STATUS="not present"
fi
{
  shasum -a 256 "$OUT_DIR/swartzit.dump"
  [[ ! -f "$OUT_DIR/media.tgz" ]] || shasum -a 256 "$OUT_DIR/media.tgz"
} > "$OUT_DIR/SHA256SUMS"
cp "$OUT_DIR/row-counts.tsv" "$OUT_DIR/source-row-counts.tsv"
archive_files=(swartzit.dump row-counts.tsv source-row-counts.tsv SHA256SUMS)
[[ ! -f "$OUT_DIR/media.tgz" ]] || archive_files+=(media.tgz)
tar -C "$OUT_DIR" -czf "$BACKUP_ROOT/swartzit-$STAMP-backup.tgz" "${archive_files[@]}"

pruned=0
while IFS= read -r archive; do
  [[ -n "$archive" ]] || continue
  archive_name="$(basename "$archive")"
  archive_stamp="${archive_name#swartzit-}"
  archive_stamp="${archive_stamp%-backup.tgz}"
  [[ "$archive_stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  backup_dir="$BACKUP_ROOT/$archive_stamp"
  [[ -d "$backup_dir" ]] || { rm -f "$archive"; pruned=$((pruned + 1)); continue; }
  find "$backup_dir" -mindepth 1 -maxdepth 1 -type f -delete
  rmdir "$backup_dir" 2>/dev/null || continue
  rm -f "$archive"
  pruned=$((pruned + 1))
done < <(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'swartzit-*-backup.tgz' -print | sort -r | awk -v keep="$RETENTION" 'NR > keep')

echo "Backup: $OUT_DIR/swartzit.dump"
echo "Archive: $BACKUP_ROOT/swartzit-$STAMP-backup.tgz"
echo "Counts: $OUT_DIR/row-counts.tsv"
echo "Media: $MEDIA_STATUS ($MEDIA_ROOT)"
echo "Retention: $RETENTION archive(s); pruned: $pruned"
