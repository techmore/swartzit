#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TAG=${SWARTZIT_RELEASE_TAG:-}
LOG=${SWARTZIT_UPGRADE_LOG:-/var/log/swartzit-upgrade.log}
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
if [[ "${SWARTZIT_AUTO_UPDATE:-false}" == "true" ]]; then
  [[ -n "$TAG" ]] || { echo 'SWARTZIT_AUTO_UPDATE=true requires SWARTZIT_RELEASE_TAG (for example v0.3.0).'; exit 2; }
  exec bash "$ROOT/scripts/swartzit-release-update.sh" --tag "$TAG" --yes
fi
if [[ -z "$TAG" ]]; then
  echo 'No SWARTZIT_RELEASE_TAG configured; check skipped.'
  exit 0
fi
exec bash "$ROOT/scripts/swartzit-release-update.sh" --tag "$TAG" --dry-run
