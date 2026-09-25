#!/usr/bin/env bash
# Native PostgreSQL backup for a Swartzit deployment.
#
# The container-oriented scripts/db-backup.sh remains the Mac/Incus path. Ubuntu
# production runs PostgreSQL as a system service, so this script dumps through
# the local socket, records per-table row counts for a later restore rehearsal,
# archives the media store, and writes a checksum manifest.
#
# Requires a privileged session on production (`sudo bash ...`) and no
# privileges at all during a Mac rehearsal.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/postgres-native-lib.sh
source "$ROOT/scripts/postgres-native-lib.sh"
swartzit_pg_resolve_run_as

RETENTION=${SWARTZIT_BACKUP_RETENTION:-7}
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
if [[ -n "${SWARTZIT_MEDIA_ROOT:-}" ]]; then
  MEDIA_ROOT="$SWARTZIT_MEDIA_ROOT"
elif [[ -n "${SWARTZIT_STATE_DIR:-}" ]]; then
  MEDIA_ROOT="$SWARTZIT_STATE_DIR/media"
elif [[ -n "${SWARTZIT_DATA_DIR:-}" ]]; then
  MEDIA_ROOT="$SWARTZIT_DATA_DIR/media"
else
  MEDIA_ROOT="$HOME/Library/Application Support/Swartzit/media"
fi

swartzit_pg_require_tools psql pg_dump tar
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || { echo 'sha256sum or shasum is required.' >&2; exit 1; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

mkdir -p "$BACKUP_ROOT"
LOCK="$BACKUP_ROOT/.backup.lock"
mkdir "$LOCK" 2>/dev/null || { echo "Another Swartzit backup is already running: $BACKUP_ROOT" >&2; exit 75; }
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
OUT_DIR="$BACKUP_ROOT/$STAMP"
while [[ -e "$OUT_DIR" || -e "$BACKUP_ROOT/swartzit-$STAMP-backup.tgz" ]]; do
  sleep 1
  STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
  OUT_DIR="$BACKUP_ROOT/$STAMP"
done
mkdir -p "$OUT_DIR"

swartzit_pg_admin pg_isready -d "$SWARTZIT_DB_NAME" >/dev/null
# Custom format is what pg_restore needs for the restore rehearsal, and it
# compresses, so the small production database stays cheap to copy around.
# --no-owner/--no-acl keeps the dump restorable by the rehearsal role, which
# deliberately does not reuse the production service credential.
swartzit_pg_admin pg_dump -d "$SWARTZIT_DB_NAME" \
  --format=custom --no-owner --no-acl --file="$OUT_DIR/swartzit.dump"
swartzit_pg_table_row_counts "$SWARTZIT_DB_NAME" > "$OUT_DIR/row-counts.tsv"
cp "$OUT_DIR/row-counts.tsv" "$OUT_DIR/source-row-counts.tsv"

if [[ -d "$MEDIA_ROOT" ]]; then
  tar -C "$MEDIA_ROOT" -czf "$OUT_DIR/media.tgz" .
  MEDIA_STATUS="included ($MEDIA_ROOT)"
else
  MEDIA_STATUS="absent ($MEDIA_ROOT)"
fi

MANIFEST_FILES=(swartzit.dump row-counts.tsv source-row-counts.tsv)
[[ -f "$OUT_DIR/media.tgz" ]] && MANIFEST_FILES+=(media.tgz)
(cd "$OUT_DIR" && sha256 "${MANIFEST_FILES[@]}") > "$OUT_DIR/SHA256SUMS"

ARCHIVE_FILES=("${MANIFEST_FILES[@]}" SHA256SUMS)
ARCHIVE="$BACKUP_ROOT/swartzit-$STAMP-backup.tgz"
tar -C "$OUT_DIR" -czf "$ARCHIVE" "${ARCHIVE_FILES[@]}"
(cd "$OUT_DIR" && sha256 -c SHA256SUMS >/dev/null)

# Retention applies to archives and their expanded directories together so the
# rehearsal inputs stay available for as long as the archives they came from.
while IFS= read -r old; do
  rm -f "$old"
  rm -rf "$BACKUP_ROOT/$(basename "${old%.tgz}" | sed -E 's/^swartzit-//')"
done < <(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'swartzit-*-backup.tgz' -print | sort -r | tail -n +$((RETENTION + 1)))

printf 'Backup: %s\n' "$OUT_DIR/swartzit.dump"
printf 'Archive: %s\n' "$ARCHIVE"
printf 'Counts: %s\n' "$OUT_DIR/row-counts.tsv"
printf 'Media: %s\n' "$MEDIA_STATUS"
printf 'Retention: %s\n' "$RETENTION"
