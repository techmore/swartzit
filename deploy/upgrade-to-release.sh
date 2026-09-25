#!/usr/bin/env bash
# One-shot production upgrade of the Swartzit deployment on this host.
#
#   sudo bash ~/swartzit-release-stage/upgrade-to-release.sh v0.1.34-20260925T19
#
# It stages the release tools out of the tagged commit, verifies the release
# assets, backs up PostgreSQL, rehearses the candidate release against a
# restored copy of the production data, swaps the binary and web build, checks
# health, and rolls back automatically if anything fails. Then it installs the
# daily check timer.
#
# Pass --check to only verify the release without changing anything.

set -euo pipefail

TAG=${1:-}
MODE=${2:-apply}
APP_DIR=${SWARTZIT_APP_DIR:-/var/lib/swartzit}
API_URL=${SWARTZIT_API_URL:-http://127.0.0.1:18080}
WEB_URL=${SWARTZIT_WEB_URL:-http://127.0.0.1:3000}

if [[ "$(id -u)" -ne 0 ]]; then
  echo 'This upgrade needs root. Re-running under sudo.'
  exec sudo -- bash "$0" "$TAG" "$MODE"
fi
[[ "$TAG" == v* ]] || { echo 'Usage: upgrade-to-release.sh vX.Y.Z [--check]' >&2; exit 2; }
[[ -d "$APP_DIR/.git" ]] || { echo "No Swartzit checkout at $APP_DIR." >&2; exit 1; }

STAGE="/var/tmp/swartzit-tools-$TAG"
REPO_USER=$(stat -c '%U' "$APP_DIR")
GIT=(git -C "$APP_DIR" -c safe.directory="$APP_DIR")
if [[ "$REPO_USER" != root ]] && id "$REPO_USER" >/dev/null 2>&1; then
  GIT=(runuser -u "$REPO_USER" -- git -C "$APP_DIR" -c safe.directory="$APP_DIR")
fi

echo "== staging release tools for $TAG =="
if [[ ! -x "$STAGE/scripts/swartzit-release-update.sh" ]]; then
  "${GIT[@]}" fetch origin "refs/tags/$TAG:refs/tags/$TAG"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  "${GIT[@]}" archive "$TAG" scripts | tar -x -C "$STAGE"
  chmod +x "$STAGE"/scripts/*.sh
else
  echo "Reusing $STAGE"
fi

echo
echo "== release asset check =="
bash "$STAGE/scripts/swartzit-release-update.sh" --tag "$TAG" --dry-run

if [[ "$MODE" == "--check" ]]; then
  echo
  echo 'Check-only run complete. Nothing was changed.'
  exit 0
fi

echo
echo "== upgrading to $TAG =="
bash "$STAGE/scripts/swartzit-release-update.sh" --tag "$TAG" --yes

echo
echo "== installing the daily release check =="
bash "$STAGE/scripts/install-release-automation.sh"

echo
echo "== result =="
"${GIT[@]}" log -1 --oneline
curl -fsS --max-time 5 "$API_URL/health"; echo
curl -fsS -o /dev/null -w "web %{http_code}\n" --max-time 5 "$WEB_URL/"
systemctl --no-pager --lines=0 status swartzit swartzit-web | grep -E 'Active:|Loaded:' || true
cat "$APP_DIR/state/current-release.json" 2>/dev/null || true
