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
UPDATE_STATUS_FILE="$(printenv SWARTZIT_UPDATE_STATUS_FILE || true)"
[[ -n "$UPDATE_STATUS_FILE" ]] || UPDATE_STATUS_FILE="$STATE_DIR/update-status.json"
mkdir -p "$(dirname "$UPDATE_STATUS_FILE")"

write_update_status() {
  local state="$1"
  local phase="$2"
  local detail="$3"
  local version=""
  [[ $# -ge 4 ]] && version="$4"
  local temporary="$UPDATE_STATUS_FILE.tmp.$$"
  printf '{"state":"%s","phase":"%s","detail":"%s","version":"%s","updated_at":"%s"}\n' \
    "$state" \
    "$phase" \
    "$detail" \
    "$version" \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$temporary"
  mv -f "$temporary" "$UPDATE_STATUS_FILE"
}

wait_for_healthy_services() {
  local last_output=''
  local status_json=''
  # The macOS web LaunchAgent can take a few seconds to load a new SvelteKit
  # bundle after Homebrew replaces its keg. A single immediate status call
  # turns that normal convergence window into a false failed update.
  for _ in {1..30}; do
    if last_output=$("$LAUNCHER" status 2>&1); then
      printf '%s\n' "$last_output"
      return 0
    fi
    # A restart can also leave the persisted public pulse stale until the
    # monitor agent performs its first probe. Require the actual services and
    # public endpoint to be ready, but let the finishing monitor refresh clear
    # that startup-only stale state.
    status_json=$("$LAUNCHER" status --json 2>/dev/null || true)
    if [[ -n "$status_json" ]] && node -e '
      try {
        const value = JSON.parse(process.argv[1]);
        const pulse = value.pulse?.status ?? "unknown";
        const publicReady = value.public === "ready" || value.public === "not-configured";
        const pulseAcceptable = pulse === "up" || pulse === "unknown" || pulse === "stale";
        process.exit(value.status === "up" && value.api === "ready" && value.web === "ready" && value.database === "ready" && publicReady && pulseAcceptable ? 0 : 1);
      } catch {
        process.exit(1);
      }
    ' "$status_json"; then
      printf '%s\n' "$last_output"
      return 0
    fi
    sleep 1
  done
  printf '%s\n' "$last_output"
  return 1
}

previous_version=""
fail_update() {
  local detail="$1"
  local version="$previous_version"
  [[ $# -ge 2 ]] && version="$2"
  write_update_status "failed" "failed" "$detail" "$version"
  exit 1
}

if [[ "${1:-}" != "--yes" ]]; then
  echo "This creates a database backup, upgrades Swartzit, runs migrations on startup, and verifies health."
  echo "Use: swartzit update --yes"
  exit 2
fi
if ! command -v brew >/dev/null; then
  write_update_status "failed" "unavailable" "Homebrew is required for updates."
  echo 'Homebrew is required for updates.' >&2
  exit 1
fi

write_update_status "updating" "backup" "Creating a recovery backup"

backup_dir="$(printenv SWARTZIT_BACKUP_DIR || true)"
[[ -n "$backup_dir" ]] || backup_dir="$STATE_DIR/backups"
if ! backup_output=$(SWARTZIT_BACKUP_DIR="$backup_dir" "$SCRIPT_HOME/db-backup.sh"); then
  fail_update "The recovery backup could not be created."
fi
printf '%s\n' "$backup_output" | tee "$STATE_DIR/last-update-backup.txt"
backup_path=$(printf '%s\n' "$backup_output" | sed -n 's/^Backup: //p' | head -n 1)
archive_path=$(printf '%s\n' "$backup_output" | sed -n 's/^Archive: //p' | head -n 1)
previous_version=$("$LAUNCHER" version 2>/dev/null || echo unknown)
manifest="$STATE_DIR/last-update.json"
printf '{"started_at":"%s","previous_version":"%s","backup":"%s","archive":"%s"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$previous_version" "$backup_path" "$archive_path" > "$manifest"

write_update_status "updating" "stopping" "Stopping Swartzit services" "$previous_version"
restart_network=""
restart_origin=""
restart_caddy=""
restart_domain=""
restart_caddy_bind=""
restart_caddy_upstream=""
if [[ -f "$STATE_DIR/runtime.env" ]]; then
  # Capture the active network before stop removes the runtime process state.
  # Prefer the exact interface over the abstract mode so an en0 -> en1
  # fallback, VPN, bridge, or other explicit bind survives the update.
  set -a
  source "$STATE_DIR/runtime.env"
  set +a
  if [[ "${SWARTZIT_WEB_INTERFACE:-}" =~ ^(en[0-9]+|utun[0-9]+|bridge[0-9]+|lo0|loopback)$ ]]; then
    restart_network="$SWARTZIT_WEB_INTERFACE"
  else
    restart_network="${SWARTZIT_NETWORK_MODE:-}"
  fi
  restart_origin="${ORIGIN:-${SWARTZIT_ORIGIN:-}}"
  restart_caddy="${SWARTZIT_CADDY:-}"
  restart_domain="${SWARTZIT_DOMAIN:-}"
  restart_caddy_bind="${SWARTZIT_CADDY_BIND_IP:-}"
  restart_caddy_upstream="${SWARTZIT_CADDY_UPSTREAM:-}"
fi
if ! "$LAUNCHER" stop; then
  fail_update "Swartzit services could not be stopped." "$previous_version"
fi
write_update_status "updating" "installing" "Installing the Homebrew release" "$previous_version"
if ! brew upgrade swartzit; then
  echo "Update failed. Database was not modified; restore the previous Swartzit package and use: $SCRIPT_HOME/db-restore-verify.sh $backup_path" >&2
  fail_update "Homebrew could not install the new Swartzit release." "$previous_version"
fi

# Homebrew replaces the versioned keg during an upgrade. Resolve the new
# launcher before restarting services so the menu companion is refreshed from
# the same release instead of continuing to run the old copied binary.
new_launcher=$(command -v swartzit 2>/dev/null || true)
[[ -x "$new_launcher" ]] && LAUNCHER="$new_launcher"
new_version=$("$LAUNCHER" version 2>/dev/null || echo unknown)

write_update_status "updating" "starting" "Starting the updated Swartzit services" "$new_version"
start_args=()
[[ -n "$restart_network" ]] && start_args+=("$restart_network")
if [[ -n "$restart_origin" ]]; then
  export ORIGIN="$restart_origin"
fi
if [[ -n "$restart_caddy" ]]; then export SWARTZIT_CADDY="$restart_caddy"; fi
if [[ -n "$restart_domain" ]]; then export SWARTZIT_DOMAIN="$restart_domain"; fi
if [[ -n "$restart_caddy_bind" ]]; then export SWARTZIT_CADDY_BIND_IP="$restart_caddy_bind"; fi
if [[ -n "$restart_caddy_upstream" ]]; then export SWARTZIT_CADDY_UPSTREAM="$restart_caddy_upstream"; fi
if ! "$LAUNCHER" start "${start_args[@]}"; then
  echo "Updated package failed health checks." >&2
  echo "Recovery backup: $backup_path"
  echo "Archive: $archive_path"
  echo "Restore only after verifying the backup with db-restore-verify.sh." >&2
  fail_update "The updated Swartzit services could not be started." "$new_version"
fi
write_update_status "updating" "verifying" "Checking updated service health" "$new_version"
if ! wait_for_healthy_services; then
  echo "Updated package failed health checks." >&2
  echo "Recovery backup: $backup_path"
  echo "Archive: $archive_path"
  echo "Restore only after verifying the backup with db-restore-verify.sh." >&2
  fail_update "The updated Swartzit services failed health checks." "$new_version"
fi
write_update_status "updating" "refreshing-menu" "Refreshing the native menu companion" "$new_version"
if [[ "$(uname -s)" == Darwin ]] && ! "$LAUNCHER" status-install; then
  echo "Updated Swartzit is healthy, but the macOS menu companion could not be refreshed." >&2
  echo "Run: $LAUNCHER status-install" >&2
  fail_update "The native menu companion could not be refreshed." "$new_version"
fi
write_update_status "updating" "finishing" "Refreshing background services" "$new_version"
if [[ "$(uname -s)" == Darwin ]] && ! "$LAUNCHER" backup-install; then
  echo "Updated Swartzit is healthy, but the macOS backup LaunchAgent could not be refreshed." >&2
  echo "Run: $LAUNCHER backup-install" >&2
  fail_update "The backup LaunchAgent could not be refreshed." "$new_version"
fi
if [[ "$(uname -s)" == Darwin ]] && ! "$LAUNCHER" monitor-install; then
  echo "Updated Swartzit is healthy, but the uptime monitor LaunchAgent could not be refreshed." >&2
  echo "Run: $LAUNCHER monitor-install" >&2
  fail_update "The uptime monitor could not be refreshed." "$new_version"
fi
if [[ "$(uname -s)" == Darwin && -f "$HOME/Library/LaunchAgents/org.stoverparc.swartzit-caddy.plist" ]] && ! "$LAUNCHER" caddy-install; then
  echo "Updated Swartzit is healthy, but the Caddy LaunchAgent could not be refreshed." >&2
  echo "Run: $LAUNCHER caddy-install" >&2
  fail_update "Caddy could not be refreshed." "$new_version"
fi
printf '{"completed_at":"%s","previous_version":"%s","new_version":"%s","backup":"%s","archive":"%s","status":"healthy"}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$previous_version" "$new_version" "$backup_path" "$archive_path" > "$manifest"
write_update_status "completed" "completed" "Swartzit updated and health checks passed" "$new_version"
echo "Swartzit update completed and passed health checks."
