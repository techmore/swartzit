#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
DB_USER=${SWARTZIT_DB_USER:-swartzit}
DB_NAME=${SWARTZIT_DB_NAME:-swartzit}
DB_HOST=${SWARTZIT_DB_HOST:-/var/run/postgresql}
RETENTION=${SWARTZIT_BACKUP_RETENTION:-7}
BACKUP_ROOT=${SWARTZIT_BACKUP_DIR:-${SWARTZIT_STATE_DIR:-/var/lib/swartzit/.local}/backups}
MEDIA_ROOT=${SWARTZIT_MEDIA_ROOT:-${SWARTZIT_STATE_DIR:-/var/lib/swartzit}/media}
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_BACKUP_RETENTION must be a positive integer.' >&2; exit 2; }
mkdir -p "$BACKUP_ROOT"
LOCK="$BACKUP_ROOT/.backup.lock"
mkdir "$LOCK" 2>/dev/null || { echo 'Another Swartzit backup is already running.' >&2; exit 75; }
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
OUT_DIR="$BACKUP_ROOT/$STAMP"
while [[ -e "$OUT_DIR" || -e "$BACKUP_ROOT/swartzit-$STAMP-backup.tgz" ]]; do sleep 1; STAMP=$(date -u '+%Y%m%dT%H%M%SZ'); OUT_DIR="$BACKUP_ROOT/$STAMP"; done
mkdir -p "$OUT_DIR"

as_postgres() {
  if [[ "$(id -u)" -eq 0 ]]; then runuser -u postgres -- "$@"; else sudo -n -u postgres "$@"; fi
}
as_postgres pg_isready -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" >/dev/null
as_postgres pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --file="$OUT_DIR/swartzit.dump"
as_postgres psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -Atqc "select tablename || E'\\t' || (xpath('/table/row/count/text()', query_to_xml('select count(*) as count from ' || quote_ident(tablename), true, false, '')))[1]::text from pg_tables where schemaname='public' and tablename <> '_sqlx_migrations' order by tablename" > "$OUT_DIR/row-counts.tsv"
cp "$OUT_DIR/row-counts.tsv" "$OUT_DIR/source-row-counts.tsv"
if [[ -d "$MEDIA_ROOT" ]]; then tar -C "$MEDIA_ROOT" -czf "$OUT_DIR/media.tgz" .; MEDIA_STATUS=included; else MEDIA_STATUS='not present'; fi
(cd "$OUT_DIR" && shasum -a 256 swartzit.dump row-counts.tsv source-row-counts.tsv $([[ -f media.tgz ]] && echo media.tgz)) > "$OUT_DIR/SHA256SUMS"
ARCHIVE_FILES=(swartzit.dump row-counts.tsv source-row-counts.tsv SHA256SUMS)
[[ -f "$OUT_DIR/media.tgz" ]] && ARCHIVE_FILES+=(media.tgz)
tar -C "$OUT_DIR" -czf "$BACKUP_ROOT/swartzit-$STAMP-backup.tgz" "${ARCHIVE_FILES[@]}"
find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'swartzit-*-backup.tgz' -print | sort -r | tail -n +$((RETENTION + 1)) | while read -r old; do rm -f "$old"; done
printf 'Backup: %s\nArchive: %s\nCounts: %s\nMedia: %s\nRetention: %s\n' "$OUT_DIR/swartzit.dump" "$BACKUP_ROOT/swartzit-$STAMP-backup.tgz" "$OUT_DIR/row-counts.tsv" "$MEDIA_STATUS" "$RETENTION"
