#!/usr/bin/env bash
set -euo pipefail

REPO_URL=${SWARTZIT_RELEASE_REPOSITORY:-https://github.com/techmore/swartzit.git}
RELEASE_REPO=${SWARTZIT_RELEASE_REPO:-techmore/swartzit}
APP_DIR=${SWARTZIT_APP_DIR:-/var/lib/swartzit}
# Helper scripts come from wherever this script itself lives, not from the
# deployment checkout. A staged tools directory can therefore run the upgrade
# while the checkout is still on the old commit, which is what makes the
# previous-commit rollback meaningful.
SCRIPT_HOME=$(cd "$(dirname "$0")" && pwd)
BACKUP_DIR=${SWARTZIT_RELEASE_BACKUP_DIR:-/var/backups/swartzit/releases}
# Production defaults: the API binds loopback 18080 and the SvelteKit Node
# build serves 3000. Caddy publishes 192.168.3.251:4173 -> 3000 over WireGuard,
# so the loopback web port is the reliable post-swap health target.
API_URL=${SWARTZIT_API_URL:-http://127.0.0.1:18080}
WEB_URL=${SWARTZIT_WEB_URL:-http://127.0.0.1:3000}
HEALTH_ATTEMPTS=${SWARTZIT_HEALTH_ATTEMPTS:-60}
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
command -v curl >/dev/null || { echo 'curl is required.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3 is required.' >&2; exit 1; }
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Release tag: $TAG"
  echo "Release repository: $RELEASE_REPO"
  for asset in swartzit-server-linux-amd64 swartzit-web-linux-amd64.tar.gz VERSION SHA256SUMS; do
    python3 - "$RELEASE_REPO" "$TAG" "$asset" "${GITHUB_TOKEN:-}" <<'PY'
import json, sys, urllib.request
repo, tag, name, token = sys.argv[1:]
headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'swartzit-updater'}
if token:
    headers['Authorization'] = 'Bearer ' + token
request = urllib.request.Request(f'https://api.github.com/repos/{repo}/releases/tags/{tag}', headers=headers)
try:
    with urllib.request.urlopen(request) as response:
        release = json.load(response)
except Exception as error:
    print(f'Release {tag} is not available: {error}', file=sys.stderr)
    raise SystemExit(1)
sizes = {asset['name']: asset['size'] for asset in release.get('assets', [])}
if name not in sizes:
    print(f'Missing release asset: {name}', file=sys.stderr)
    raise SystemExit(1)
print(f'Found {name} ({sizes[name]} bytes)')
PY
  done
  echo 'Dry run passed: release assets are present and downloadable.'
  exit 0
fi
[[ "$(id -u)" -eq 0 ]] || { echo 'Run this updater as root: sudo bash scripts/swartzit-release-update.sh --tag ... --yes' >&2; exit 1; }
command -v systemctl >/dev/null || { echo 'systemd is required.' >&2; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "Swartzit checkout not found at $APP_DIR." >&2; exit 1; }
# The deployment checkout is owned by the service account, not root. Git refuses
# to operate on another user's repository, and checking out as root would leave
# root-owned files behind, so git runs as the repository owner.
REPO_USER=$(stat -c '%U' "$APP_DIR" 2>/dev/null || stat -f '%Su' "$APP_DIR")
GIT=(git -C "$APP_DIR" -c safe.directory="$APP_DIR")
if [[ "$(id -u)" -eq 0 && "$REPO_USER" != "root" ]] && id "$REPO_USER" >/dev/null 2>&1; then
  GIT=(runuser -u "$REPO_USER" -- git -C "$APP_DIR" -c safe.directory="$APP_DIR")
  echo "Running checkout updates as $REPO_USER."
fi
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
PREVIOUS_COMMIT=$("${GIT[@]}" rev-parse HEAD)
PREVIOUS_VERSION=$(cat "$APP_DIR/VERSION" 2>/dev/null || echo unknown)
AUTH_HEADER=()
[[ -n "$GITHUB_TOKEN" ]] && AUTH_HEADER=(-H "Authorization: Bearer $GITHUB_TOKEN")
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
verify_release_checksums() {
  local sums="$WORK/SHA256SUMS"
  [[ -s "$sums" ]] || { echo 'Release is missing SHA256SUMS.' >&2; exit 1; }
  # The workflow signs the raw asset names; verify before renaming anything.
  (cd "$WORK" && sha256sum -c SHA256SUMS)
}
# Only tracked modifications block an update. The deployment directory also
# holds operational state that is untracked by design (state/, caches, dotfiles),
# and refusing to update because of it would make the host unupgradeable.
if ! "${GIT[@]}" diff --quiet || ! "${GIT[@]}" diff --cached --quiet; then
  echo 'The Swartzit checkout has tracked modifications; refusing to update.' >&2
  exit 1
fi
printf 'Current commit: %s\nPrevious version: %s\n' "$PREVIOUS_COMMIT" "$PREVIOUS_VERSION"
download_asset swartzit-server-linux-amd64 "$WORK/swartzit-server-linux-amd64"
download_asset swartzit-web-linux-amd64.tar.gz "$WORK/swartzit-web-linux-amd64.tar.gz"
download_asset VERSION "$WORK/VERSION"
download_asset SHA256SUMS "$WORK/SHA256SUMS"
verify_release_checksums
SERVER_ASSET="$WORK/swartzit-server-linux-amd64"
WEB_ASSET="$WORK/swartzit-web-linux-amd64.tar.gz"
RELEASE_VERSION=$(tr -d '[:space:]' < "$WORK/VERSION")
# The backup is taken with the service's own PostgreSQL credentials rather than
# a superuser session, so it authenticates exactly the way the server does and
# needs no runuser. The rehearsal below is the step that needs elevated access,
# because it creates a disposable role and database.
SERVICE_ENV_FILE=${SWARTZIT_SERVER_ENV_FILE:-/etc/swartzit/server.env}
SERVICE_DATABASE_URL=${DATABASE_URL:-}
if [[ -z "$SERVICE_DATABASE_URL" && -r "$SERVICE_ENV_FILE" ]]; then
  SERVICE_DATABASE_URL=$(
    grep -m1 -E '^[[:space:]]*DATABASE_URL=' "$SERVICE_ENV_FILE" 2>/dev/null \
      | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//'
  )
fi
[[ -n "$SERVICE_DATABASE_URL" ]] || {
  echo "No DATABASE_URL found in $SERVICE_ENV_FILE; cannot back up the production database." >&2
  exit 1
}
BACKUP_OUTPUT=$(
  SWARTZIT_DB_BACKUP_MODE=native \
  SWARTZIT_DATABASE_URL="$SERVICE_DATABASE_URL" \
  SWARTZIT_BACKUP_DIR="$BACKUP_TAG/db" \
  SWARTZIT_MEDIA_ROOT="$APP_DIR/state/media" \
    bash "$SCRIPT_HOME/db-backup.sh"
)
printf '%s\n' "$BACKUP_OUTPUT" | tee "$BACKUP_TAG/backup.txt"
DB_DUMP=$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Backup: //p' | head -n1)
DB_ARCHIVE=$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Archive: //p' | head -n1)
[[ -f "$DB_DUMP" ]] || { echo 'Database backup path could not be determined.' >&2; exit 1; }
cp "$DB_DUMP" "$BACKUP_TAG/"

# Prove the backup is actually restorable before treating it as a recovery
# point. This restores the archive into a throwaway database and compares
# per-table row counts, which a checksum alone cannot establish.
if [[ -n "$DB_ARCHIVE" && -f "$DB_ARCHIVE" ]]; then
  bash "$SCRIPT_HOME/db-restore-verify-postgres.sh" "$DB_ARCHIVE"
else
  echo 'Backup archive path could not be determined; refusing to continue.' >&2
  exit 1
fi

# Prove the candidate release can migrate a restored copy of the real data
# before any live service is stopped.
bash "$SCRIPT_HOME/preflight-release.sh" "$SERVER_ASSET" "$DB_DUMP"
tar -C "$APP_DIR/apps/web" -czf "$BACKUP_TAG/web-build.tgz" build 2>/dev/null || true
cp /usr/local/bin/swartzit-server "$BACKUP_TAG/swartzit-server.previous" 2>/dev/null || true
"${GIT[@]}" fetch --tags origin "$TAG"
"${GIT[@]}" checkout --detach "$TAG"
printf '%s\n' "$PREVIOUS_COMMIT" > "$BACKUP_TAG/previous-commit"
printf '%s\n' "$PREVIOUS_VERSION" > "$BACKUP_TAG/previous-version"
SERVICES=(swartzit swartzit-web)
# The crawler worker must not claim a job while the API and web build are being
# swapped underneath it.
if systemctl is-enabled --quiet swartzit-worker.timer 2>/dev/null || systemctl is-active --quiet swartzit-worker.timer 2>/dev/null; then
  WORKER_TIMER_WAS_ACTIVE=1
  systemctl stop swartzit-worker.timer swartzit-worker.service 2>/dev/null || true
fi
resume_services() {
  systemctl start "${SERVICES[@]}" || true
  if [[ "${WORKER_TIMER_WAS_ACTIVE:-0}" -eq 1 ]]; then
    systemctl start swartzit-worker.timer || true
  fi
}
rollback() {
  echo 'Rolling back Swartzit after failed health checks.' >&2
  systemctl stop "${SERVICES[@]}" || true
  if [[ -f "$BACKUP_TAG/swartzit-server.previous" ]]; then
    install -m 0755 "$BACKUP_TAG/swartzit-server.previous" /usr/local/bin/swartzit-server.new
    mv -f /usr/local/bin/swartzit-server.new /usr/local/bin/swartzit-server
  fi
  if [[ -f "$BACKUP_TAG/web-build.tgz" ]]; then
    rm -rf "$WORK/web-rollback"
    mkdir -p "$WORK/web-rollback"
    tar -xzf "$BACKUP_TAG/web-build.tgz" -C "$WORK/web-rollback"
    rm -rf "$APP_DIR/apps/web/build"
    mv "$WORK/web-rollback/build" "$APP_DIR/apps/web/build"
    chown -R "$REPO_USER" "$APP_DIR/apps/web/build"
  fi
  "${GIT[@]}" checkout --detach "$PREVIOUS_COMMIT" >/dev/null 2>&1 || true
  resume_services
}
systemctl stop "${SERVICES[@]}" || { echo 'Could not stop Swartzit services.' >&2; exit 1; }
# Stage then rename so a running process never observes a truncated binary.
install -m 0755 "$SERVER_ASSET" /usr/local/bin/swartzit-server.new
mv -f /usr/local/bin/swartzit-server.new /usr/local/bin/swartzit-server
rm -rf "$WORK/web-build"
mkdir -p "$WORK/web-build"
tar -xzf "$WEB_ASSET" -C "$WORK/web-build"
# adapter-node emits an SSR build. Checking the entry point and the client and
# server bundles keeps a truncated or mis-built archive from being installed.
if [[ ! -f "$WORK/web-build/build/index.js" || ! -f "$WORK/web-build/build/handler.js" || ! -d "$WORK/web-build/build/client" || ! -d "$WORK/web-build/build/server" ]]; then
  echo 'Web release archive is not a complete adapter-node build (index.js, handler.js, client, server).' >&2
  rollback
  exit 1
fi
rm -rf "$APP_DIR/apps/web/build.previous"
mv "$APP_DIR/apps/web/build" "$APP_DIR/apps/web/build.previous"
mv "$WORK/web-build/build" "$APP_DIR/apps/web/build"
chown -R "$REPO_USER" "$APP_DIR/apps/web/build"
systemctl start swartzit swartzit-web || { rollback; exit 1; }
healthy=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  # /ready proves the server finished its startup work, /health proves the
  # database answers, and the web root proves the new build is being served.
  if curl -fsS --max-time 3 "$API_URL/ready" >/dev/null 2>&1 \
    && curl -fsS --max-time 3 "$API_URL/health" >/dev/null 2>&1 \
    && curl -fsS --max-time 3 "$WEB_URL/" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
  rollback
  echo "Updated release failed API/web health checks. Database backup: $DB_DUMP" >&2
  exit 1
fi
resume_services
mkdir -p "$APP_DIR/state"
printf '{"tag":"%s","version":"%s","commit":"%s","previous_commit":"%s","previous_version":"%s","backup":"%s","recovery_bundle":"%s","installed_at":"%s"}\n' \
  "$TAG" "$RELEASE_VERSION" "$("${GIT[@]}" rev-parse HEAD)" "$PREVIOUS_COMMIT" "$PREVIOUS_VERSION" "$DB_DUMP" "$BACKUP_TAG" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$APP_DIR/state/release-$STAMP.json"
ln -sfn "$APP_DIR/state/release-$STAMP.json" "$APP_DIR/state/current-release.json"
rm -rf "$APP_DIR/apps/web/build.previous"
echo "Swartzit updated to $TAG ($RELEASE_VERSION) and passed API/web health checks."
echo "Recovery bundle: $BACKUP_TAG"
