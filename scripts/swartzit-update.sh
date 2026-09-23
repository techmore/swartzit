#!/usr/bin/env bash
set -euo pipefail

SCRIPT_HOME=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_HOME/.." && pwd)
STATE_DIR="${SWARTZIT_STATE_DIR:-$ROOT/.local}"
LAUNCHER="$ROOT/scripts/swartzit"
[[ -x "$LAUNCHER" ]] || LAUNCHER="$ROOT/bin/swartzit"
mkdir -p "$STATE_DIR"

if [[ "${1:-}" != "--yes" ]]; then
  echo "This creates a database backup, upgrades Swartzit, runs migrations on startup, and verifies health."
  echo "Use: swartzit update --yes"
  exit 2
fi
command -v brew >/dev/null || { echo 'Homebrew is required for updates.' >&2; exit 1; }

backup_output=$($SCRIPT_HOME/db-backup.sh)
printf '%s\n' "$backup_output" | tee "$STATE_DIR/last-update-backup.txt"
backup_path=$(printf '%s\n' "$backup_output" | awk '/^Backup: / {print $2; exit}')
archive_path=$(printf '%s\n' "$backup_output" | awk '/^Archive: / {print $2; exit}')
previous_version=$("$LAUNCHER" version 2>/dev/null || echo unknown)
manifest="$STATE_DIR/last-update.json"
printf '{"started_at":"%s","previous_version":"%s","backup":"%s","archive":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$previous_version" "$backup_path" "$archive_path" > "$manifest"

"$LAUNCHER" stop
if ! brew upgrade swartzit; then
  echo "Update failed. Database was not modified; restore the previous Swartzit package and use: $SCRIPT_HOME/db-restore-verify.sh $backup_path" >&2
  exit 1
fi

if ! "$LAUNCHER" start || ! "$LAUNCHER" status; then
  echo "Updated package failed health checks." >&2
  echo "Recovery backup: $backup_path"
  echo "Archive: $archive_path"
  echo "Restore only after verifying the backup with db-restore-verify.sh." >&2
  exit 1
fi
new_version=$("$LAUNCHER" version 2>/dev/null || echo unknown)
printf '{"completed_at":"%s","previous_version":"%s","new_version":"%s","backup":"%s","archive":"%s","status":"healthy"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$previous_version" "$new_version" "$backup_path" "$archive_path" > "$manifest"
echo "Swartzit update completed and passed health checks."
