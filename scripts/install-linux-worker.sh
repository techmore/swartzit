#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run the Linux worker installer as root.' >&2; exit 1; }
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
APP_DIR="${SWARTZIT_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SYSTEMD_DIR=/etc/systemd/system
ENV_FILE=/etc/swartzit/worker.env

[[ -f "$APP_DIR/deploy/systemd/swartzit-worker.service" ]] || { echo "Missing worker service in $APP_DIR." >&2; exit 1; }
[[ -f "$APP_DIR/deploy/systemd/swartzit-worker.timer" ]] || { echo "Missing worker timer in $APP_DIR." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || {
  echo "Missing $ENV_FILE. Create it with API_URL, SCHEDULER_HANDLE, and SCHEDULER_PASSWORD before installing the worker." >&2
  exit 1
}

install -m 0644 "$APP_DIR/deploy/systemd/swartzit-worker.service" "$SYSTEMD_DIR/swartzit-worker.service"
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-worker.timer" "$SYSTEMD_DIR/swartzit-worker.timer"
systemctl daemon-reload
systemctl enable --now swartzit-worker.timer
systemctl is-active --quiet swartzit-worker.timer
echo "Installed swartzit-worker.timer; it runs the platform-neutral Node worker once per minute."

