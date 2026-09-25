#!/usr/bin/env bash
set -euo pipefail

REPO_URL=${SWARTZIT_RELEASE_REPOSITORY:-https://github.com/techmore/swartzit.git}
RELEASE_REPO=${SWARTZIT_RELEASE_REPO:-techmore/swartzit}
APP_DIR=${SWARTZIT_APP_DIR:-/var/lib/swartzit}
BACKUP_DIR=${SWARTZIT_RELEASE_BACKUP_DIR:-/var/backups/swartzit/releases}
API_URL=${SWARTZIT_API_URL:-http://127.0.0.1:18080}
WEB_URL=${SWARTZIT_WEB_URL:-http://127.0.0.1:4173}
GITHUB_TOKEN=${GITHUB_TOKEN:-${GH_TOKEN:-}}
TAG=""
ASSUME_YES=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --repo) RELEASE_REPO="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$TAG" ]] || { echo "Usage: $0 --tag vX.Y.Z [--yes] [--dry-run]" >&2; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { echo 'Run this updater as root: sudo bash scripts/swartzit-release-update.sh --tag ... --yes' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl is required.' >&2; exit 1; }
command -v systemctl >/dev/null || { echo 'systemd is required.' >&2; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "Swartzit checkout not found at $APP_DIR." >&2; exit 1; }
if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo "This will back up PostgreSQL, preflight the release on a restored DB, stop services, install $TAG, and roll back on failure."
  read -r -p "Type the tag to continue: $TAG " CONFIRM || true
  [[ "$CONFIRM" == "$TAG" ]] || { echo 'Confirmation did not match.' >&2; exit 2; }
fi
mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.release.lock"
flock -n 9 || { echo 'Another Swartzit release update is already running.' >&2; exit 75; }
WORK=$(mktemp -d /var/tmp/swartzit-release.XXXXXX)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_TAG="$BACKUP_DIR/$STAMP"
mkdir -p "$BACKUP_TAG"
PREVIOUS_COMMIT=$(git -C "$APP_DIR" rev-parse HEAD)
PREVIOUS_VERSION=$(cat "$APP_DIR/VERSION" 2>/dev/null || echo unknown)
AUTH_HEADER=()
[[ -n "$GITHUB_TOKEN" ]] && AUTH_HEADER=(-H "Authorization: Bearer $GITHUB_TOKEN")
api_get() { curl -fsSL "${AUTH_HEADER[@]}" -H 'Accept: application/vnd.github+json' "$1"; }
download_asset() {
  local name="$1" out="$2"
  local url
  url=$(python3 - "$RELEASE_REPO" "$TAG" "$name" "${GITHUB_TOKEN:-}" <<'PY'
import json, os, sys, urllib.request
repo, tag, name, token = sys.argv[1:]
request = urllib.request.Request(f'https://api.github.com/repos/{repo}/releases/tags/{tag}', headers={'Accept':'application/vnd.github+json','User-Agent':'swartzit-updater'})
if token: request.add_header('Authorization', 'Bearer '+token)
with urllib.request.urlopen(request) as response: release=json.load(response)
for asset in release.get('assets', []):
    if asset['name'] == name:
        print(asset['browser_download_url']); break
else: raise SystemExit(f'asset not found: {name}')
PY
)
  curl -fsSL "${AUTH_HEADER[@]}" -o "$out" "$url"
}
verify_sha() {
  local file="$1"
  (cd "$(dirname "$file")" && shasum -a 256 -c "$(basename "$file").sha256")
}
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Would check GitHub release $TAG in $RELEASE_REPO."
  echo "Would back up PostgreSQL, preflight migrations, and roll forward atomically."
  exit 0
fi
if ! git -C "$APP_DIR" diff --quiet || ! git -C "$APP_DIR" diff --cached --quiet; then
  echo 'The Swartzit checkout has tracked modifications; refusing to update.' >&2
  exit 1
fi
printf 'Current commit: %s\nPrevious version: %s\n' "$PREVIOUS_COMMIT" "$PREVIOUS_VERSION"
SERVER_ASSET="$WORK/swartzit-server"
WEB_ASSET="$WORK/swartzit-web.tar.gz"
download_asset swartzit-server-linux-amd64 "$SERVER_ASSET"
download_asset swartzit-web-linux-amd64.tar.gz "$WEB_ASSET"
verify_sha "$SERVER_ASSET"
verify_sha "$WEB_ASSET"
BACKUP_OUTPUT=$(bash "$APP_DIR/scripts/db-backup-postgres.sh")
printf '%s\n' "$BACKUP_OUTPUT" | tee "$BACKUP_TAG/backup.txt"
DB_DUMP=$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Backup: //p' | head -n1)
[[ -f "$DB_DUMP" ]] || { echo 'Database backup path could not be determined.' >&2; exit 1; }
cp "$DB_DUMP" "$BACKUP_TAG/"
bash "$APP_DIR/scripts/preflight-release.sh" "$SERVER_ASSET" "$DB_DUMP"
tar -C "$APP_DIR/apps/web" -czf "$BACKUP_TAG/web-build.tgz" build 2>/dev/null || true
cp /usr/local/bin/swartzit-server "$BACKUP_TAG/swartzit-server.previous" 2>/dev/null || true
git -C "$APP_DIR" fetch --tags origin "$TAG"
git -C "$APP_DIR" checkout --detach "$TAG"
printf '%s\n' "$PREVIOUS_COMMIT" > "$BACKUP_TAG/previous-commit"
printf '%s\n' "$PREVIOUS_VERSION" > "$BACKUP_TAG/previous-version"
rollback() {
  echo 'Rolling back Swartzit after failed health checks.' >&2
  systemctl stop swartzit-web swartzit || true
  if [[ -f "$BACKUP_TAG/swartzit-server.previous" ]]; then install -m 0755 "$BACKUP_TAG/swartzit-server.previous" /usr/local/bin/swartzit-server; fi
  if [[ -f "$BACKUP_TAG/web-build.tgz" ]]; then rm -rf "$APP_DIR/apps/web/build.rollback"; mkdir -p "$APP_DIR/apps/web/build.rollback"; tar -xzf "$BACKUP_TAG/web-build.tgz" -C "$APP_DIR/apps/web/build.rollback"; rm -rf "$APP_DIR/apps/web/build"; mv "$APP_DIR/apps/web/build.rollback/build" "$APP_DIR/apps/web/build"; rmdir "$APP_DIR/apps/web/build.rollback" 2>/dev/null || true; fi
  git -C "$APP_DIR" checkout --detach "$PREVIOUS_COMMIT" >/dev/null 2>&1 || true
  systemctl start swartzit swartzit-web || true
}
systemctl stop swartzit-web swartzit || { echo 'Could not stop Swartzit services.' >&2; exit 1; }
install -m 0755 "$SERVER_ASSET" /usr/local/bin/swartzit-server
rm -rf "$WORK/web-build"
mkdir -p "$WORK/web-build"
tar -xzf "$WEB_ASSET" -C "$WORK/web-build"
[[ -d "$WORK/web-build/build" ]] || { echo 'Web release archive did not contain build/.' >&2; rollback; exit 1; }
rm -rf "$APP_DIR/apps/web/build.previous"
mv "$APP_DIR/apps/web/build" "$APP_DIR/apps/web/build.previous"
mv "$WORK/web-build/build" "$APP_DIR/apps/web/build"
chown -R swartzit:swartzit "$APP_DIR/apps/web/build"
systemctl start swartzit swartzit-web || { rollback; exit 1; }
healthy=0
for _ in {1..45}; do
  if curl -fsS --max-time 3 "$API_URL/health" >/dev/null 2>&1 && curl -fsS --max-time 3 "$WEB_URL/" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
if [[ "$healthy" -ne 1 ]]; then rollback; echo 'Updated release failed API/web health checks. Database backup: '"$DB_DUMP" >&2; exit 1; fi
printf '{"tag":"%s","commit":"%s","previous_commit":"%s","backup":"%s","previous_version":"%s","installed_at":"%s"}\n' "$TAG" "$(git -C "$APP_DIR" rev-parse HEAD)" "$PREVIOUS_COMMIT" "$DB_DUMP" "$PREVIOUS_VERSION" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$APP_DIR/state/release-$STAMP.json"
ln -sfn "$APP_DIR/state/release-$STAMP.json" "$APP_DIR/state/current-release.json"
rm -rf "$APP_DIR/apps/web/build.previous"
echo "Swartzit updated to $TAG and passed API/web health checks."
echo "Recovery bundle: $BACKUP_TAG"
