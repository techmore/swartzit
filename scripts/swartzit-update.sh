#!/usr/bin/env bash
set -euo pipefail

SCRIPT_HOME=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_HOME/.." && pwd)
if [[ -n "${SWARTZIT_STATE_DIR:-}" ]]; then
  STATE_DIR="$SWARTZIT_STATE_DIR"
elif [[ -d "$ROOT/.git" || -d "$ROOT/.local" ]]; then
  STATE_DIR="$ROOT/.local"
else
  STATE_DIR="${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}"
fi
LAUNCHER="$ROOT/scripts/swartzit"
[[ -x "$LAUNCHER" ]] || LAUNCHER="$ROOT/bin/swartzit"
mkdir -p "$STATE_DIR"

if [[ "${1:-}" != "--yes" ]]; then
  echo "This creates a database backup, upgrades Swartzit, runs migrations on startup, and verifies health."
  echo "Use: swartzit update --yes"
  exit 2
fi
command -v brew >/dev/null || { echo 'Homebrew is required for updates.' >&2; exit 1; }

backup_output=$(SWARTZIT_BACKUP_DIR="${SWARTZIT_BACKUP_DIR:-$STATE_DIR/backups}" "$SCRIPT_HOME/db-backup.sh")
printf '%s\n' "$backup_output" | tee "$STATE_DIR/last-update-backup.txt"
backup_path=$(printf '%s\n' "$backup_output" | sed -n 's/^Backup: //p' | head -n 1)
archive_path=$(printf '%s\n' "$backup_output" | sed -n 's/^Archive: //p' | head -n 1)
previous_version=$("$LAUNCHER" version 2>/dev/null || echo unknown)
manifest="$STATE_DIR/last-update.json"
printf '{"started_at":"%s","previous_version":"%s","backup":"%s","archive":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$previous_version" "$backup_path" "$archive_path" > "$manifest"

"$LAUNCHER" stop
if ! brew upgrade swartzit; then
  echo "Update failed. Database was not modified; restore the previous Swartzit package and use: $SCRIPT_HOME/db-restore-verify.sh $backup_path" >&2
  exit 1
fi

# Homebrew replaces the versioned keg during an upgrade. Resolve the new
# launcher before restarting services so the menu companion is refreshed from
# the same release instead of continuing to run the old copied binary.
new_launcher=$(command -v swartzit 2>/dev/null || true)
[[ -x "$new_launcher" ]] && LAUNCHER="$new_launcher"

if ! "$LAUNCHER" start || ! "$LAUNCHER" status; then
  echo "Updated package failed health checks." >&2
  echo "Recovery backup: $backup_path"
  echo "Archive: $archive_path"
  echo "Restore only after verifying the backup with db-restore-verify.sh." >&2
  exit 1
fi
if [[ "$(uname -s)" == Darwin ]] && ! "$LAUNCHER" status-install; then
  echo "Updated Swartzit is healthy, but the macOS menu companion could not be refreshed." >&2
  echo "Run: $LAUNCHER status-install" >&2
  exit 1
fi
if [[ "$(uname -s)" == Darwin ]] && ! "$LAUNCHER" backup-install; then
  echo "Updated Swartzit is healthy, but the macOS backup LaunchAgent could not be refreshed." >&2
  echo "Run: $LAUNCHER backup-install" >&2
  exit 1
fi
if [[ "$(uname -s)" == Darwin ]] && ! "$LAUNCHER" monitor-install; then
  echo "Updated Swartzit is healthy, but the uptime monitor LaunchAgent could not be refreshed." >&2
  echo "Run: $LAUNCHER monitor-install" >&2
  exit 1
fi
new_version=$("$LAUNCHER" version 2>/dev/null || echo unknown)
printf '{"completed_at":"%s","previous_version":"%s","new_version":"%s","backup":"%s","archive":"%s","status":"healthy"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$previous_version" "$new_version" "$backup_path" "$archive_path" > "$manifest"
echo "Swartzit update completed and passed health checks."
