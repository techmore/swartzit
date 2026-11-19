#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TAG=${SWARTZIT_RELEASE_TAG:-}
LOG=${SWARTZIT_UPGRADE_LOG:-/var/log/swartzit-upgrade.log}
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
if [[ "${SWARTZIT_AUTO_UPDATE:-false}" == "true" ]]; then
  [[ -n "$TAG" ]] || { echo 'SWARTZIT_AUTO_UPDATE=true requires SWARTZIT_RELEASE_TAG (for example v0.3.0).'; exit 2; }
  # A pinned tag remains in the environment after a successful update. Do not
  # stop and reinstall the same release on every timer tick. Require both the
  # success receipt and the local checkout/tag to agree; missing or malformed
  # evidence falls through to the normal guarded updater.
  APP_DIR=${SWARTZIT_APP_DIR:-/var/lib/swartzit}
  if python3 - "$APP_DIR" "$TAG" <<'PY_CURRENT'
import json, pathlib, subprocess, sys
app, tag = pathlib.Path(sys.argv[1]), sys.argv[2]
try:
    receipt = json.loads((app / 'state/current-release.json').read_text())
    if not isinstance(receipt, dict):
        raise ValueError('invalid release receipt')
    def commit(ref):
        return subprocess.check_output(['git', '-C', str(app), '-c', 'safe.directory=' + str(app),
                                        'rev-parse', '--verify', ref], text=True, stderr=subprocess.DEVNULL).strip()
    head = commit('HEAD^{commit}')
    tagged = commit('refs/tags/' + tag + '^{commit}')
    if receipt.get('tag') != tag or receipt.get('commit') != head or tagged != head:
        raise ValueError('release does not match receipt and checkout')
except (OSError, ValueError, TypeError, subprocess.CalledProcessError):
    raise SystemExit(1)
PY_CURRENT
  then
    echo "Release $TAG is already recorded at the checked-out tag; update skipped."
    exit 0
  fi
  exec bash "$ROOT/scripts/swartzit-release-update.sh" --tag "$TAG" --yes
fi
if [[ -z "$TAG" ]]; then
  echo 'No SWARTZIT_RELEASE_TAG configured; check skipped.'
  exit 0
fi
exec bash "$ROOT/scripts/swartzit-release-update.sh" --tag "$TAG" --dry-run
