#!/usr/bin/env bash
# Install the safe-release automation onto an existing Ubuntu deployment.
#
# `scripts/install-server.sh` already wires this up on a fresh host. This script
# does the same for a host that is already running, without touching the
# database, the running services, or the installed release.
#
# Run as root:
#   sudo bash /var/lib/swartzit/scripts/install-release-automation.sh

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
[[ "$(id -u)" -eq 0 ]] || { echo 'Run this installer as root.' >&2; exit 1; }
APP_DIR=${SWARTZIT_APP_DIR:-/var/lib/swartzit}
[[ "$ROOT" == "$APP_DIR" ]] || { echo "Run this script from the deployment checkout at $APP_DIR." >&2; exit 1; }

SCRIPTS=(postgres-native-lib.sh db-backup-postgres.sh db-restore-verify-postgres.sh preflight-release.sh swartzit-release-update.sh swartzit-upgrade-check.sh)
for script in "${SCRIPTS[@]}"; do
  [[ -f "$ROOT/scripts/$script" ]] || { echo "Missing $ROOT/scripts/$script" >&2; exit 1; }
  chmod 0755 "$ROOT/scripts/$script"
done

install -m 0644 "$ROOT/deploy/systemd/swartzit-upgrade-check.service" /etc/systemd/system/
install -m 0644 "$ROOT/deploy/systemd/swartzit-upgrade-check.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now swartzit-upgrade-check.timer

# Check-only until an approved tag is pinned, so enabling the timer can never
# install an unreviewed release by accident.
if [[ ! -f /etc/swartzit/upgrade.env ]]; then
  install -m 0640 /dev/null /etc/swartzit/upgrade.env
  cat <<'EOF' > /etc/swartzit/upgrade.env
# Pin an approved release tag to let the daily check run.
# SWARTZIT_RELEASE_TAG=v0.0.0
# Unattended installs stay off until a manual run has succeeded.
# SWARTZIT_AUTO_UPDATE=false
EOF
  chown root:swartzit /etc/swartzit/upgrade.env 2>/dev/null || true
fi

echo 'Release automation installed.'
systemctl list-timers swartzit-upgrade-check.timer --no-pager || true
echo
echo 'Check a release without changing anything:'
echo "  sudo bash $APP_DIR/scripts/swartzit-release-update.sh --tag vX.Y.Z --dry-run"
echo 'Apply a release:'
echo "  sudo bash $APP_DIR/scripts/swartzit-release-update.sh --tag vX.Y.Z --yes"
