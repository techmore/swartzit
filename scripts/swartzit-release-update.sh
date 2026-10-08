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
# build binds 192.168.3.251:4173. Check the address and port the service
# actually listens on; the public Caddy listener is not the local web port.
API_URL=${SWARTZIT_API_URL:-http://127.0.0.1:18080}
WEB_URL=${SWARTZIT_WEB_URL:-http://192.168.3.251:4173}
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
  echo "This will back up the database, preflight the release on a restored DB, stop services, install $TAG, and roll back on failure."
  read -r -p "Type the tag to continue: $TAG " CONFIRM || true
  [[ "$CONFIRM" == "$TAG" ]] || { echo 'Confirmation did not match.' >&2; exit 2; }
fi
mkdir -p "$BACKUP_DIR"
CUTOVER_LOCKED=${SWARTZIT_CUTOVER_LOCKED:-0}
if [[ "$CUTOVER_LOCKED" == 1 ]]; then
  [[ "$(readlink /proc/self/fd/9)" == "$BACKUP_DIR/.release.lock" ]] || { echo 'The inherited cutover lock is invalid.' >&2; exit 1; }
else
  exec 9>"$BACKUP_DIR/.release.lock"
fi
flock -n 9 || { echo 'Another Swartzit release update is already running.' >&2; exit 75; }
WORK=$(mktemp -d /var/tmp/swartzit-release.XXXXXX)
# Once the checkout or services change, every unsuccessful exit must recover.
# EXIT covers explicit exits and set -e failures; signals use the same path.
RECOVERY_REQUIRED=0
SERVICES_STOP_REQUESTED=0
WEB_SWAP_STARTED=0
STAGED_WEB_DIR=""
STAGED_RECOVERY_DIR=""
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  if (( RECOVERY_REQUIRED )); then
    [[ "$status" -ne 0 ]] || status=1
    rollback || echo "Recovery needs operator attention. Bundle: $BACKUP_TAG" >&2
  fi
  [[ -z "$STAGED_WEB_DIR" ]] || rm -rf "$STAGED_WEB_DIR"
  [[ -z "$STAGED_RECOVERY_DIR" ]] || rm -rf "$STAGED_RECOVERY_DIR"
  rm -f /usr/local/bin/swartzit-server.new
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
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
# Back up the database used by the running service. SQLite uses an online
# snapshot of its local file; legacy PostgreSQL authenticates with the service
# credentials. The connection URL is never printed or rewritten.
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
  SWARTZIT_DB_BACKUP_MODE=auto \
  SWARTZIT_DATABASE_URL="$SERVICE_DATABASE_URL" \
  SWARTZIT_BACKUP_DIR="$BACKUP_TAG/db" \
  SWARTZIT_MEDIA_ROOT="$APP_DIR/state/media" \
    bash "$SCRIPT_HOME/db-backup.sh"
)
printf '%s\n' "$BACKUP_OUTPUT" | tee "$BACKUP_TAG/backup.txt"
DB_DUMP=$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Backup: //p' | head -n1)
DB_ARCHIVE=$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Archive: //p' | head -n1)
[[ -f "$DB_DUMP" ]] || { echo 'Database backup path could not be determined.' >&2; exit 1; }
if [[ "$SERVICE_DATABASE_URL" == sqlite:* ]]; then
  SQLITE_SOURCE_COUNTS="$(dirname "$DB_DUMP")/source-row-counts.tsv"
  [[ -f "$SQLITE_SOURCE_COUNTS" ]] || { echo 'SQLite backup has no row-count manifest; refusing the update.' >&2; exit 1; }
  python3 "$SCRIPT_HOME/sqlite-db.py" verify "$DB_DUMP" "$SQLITE_SOURCE_COUNTS"
fi
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
SWARTZIT_SERVICE_DATABASE_URL="$SERVICE_DATABASE_URL" \
  bash "$SCRIPT_HOME/preflight-release.sh" "$SERVER_ASSET" "$DB_DUMP"
# Recovery assets are required. Do not stop a healthy service without them.
tar -C "$APP_DIR/apps/web" -czf "$BACKUP_TAG/web-build.tgz" build
cp /usr/local/bin/swartzit-server "$BACKUP_TAG/swartzit-server.previous"

# Expand, validate and set ownership before downtime. Staging alongside build/
# keeps activation a rename even when /var/tmp uses a different filesystem.
STAGED_WEB_DIR=$(mktemp -d "$APP_DIR/apps/web/.swartzit-release.XXXXXX")
tar -xzf "$WEB_ASSET" -C "$STAGED_WEB_DIR"
if [[ ! -f "$STAGED_WEB_DIR/build/index.js" || ! -f "$STAGED_WEB_DIR/build/handler.js" || ! -d "$STAGED_WEB_DIR/build/client" || ! -d "$STAGED_WEB_DIR/build/server" ]]; then
  echo 'Web release archive is not a complete adapter-node build (index.js, handler.js, client, server).' >&2
  exit 1
fi
chown -R "$REPO_USER" "$STAGED_WEB_DIR/build"
STAGED_RECOVERY_DIR=$(mktemp -d "$APP_DIR/apps/web/.swartzit-recovery.XXXXXX")
tar -xzf "$BACKUP_TAG/web-build.tgz" -C "$STAGED_RECOVERY_DIR"
chown -R "$REPO_USER" "$STAGED_RECOVERY_DIR/build"
install -m 0755 "$SERVER_ASSET" /usr/local/bin/swartzit-server.new
"${GIT[@]}" fetch --tags origin "$TAG"
printf '%s\n' "$PREVIOUS_COMMIT" > "$BACKUP_TAG/previous-commit"
printf '%s\n' "$PREVIOUS_VERSION" > "$BACKUP_TAG/previous-version"
SERVICES=(swartzit swartzit-web)
WORKER_TIMER_WAS_ACTIVE=0
if systemctl is-enabled --quiet swartzit-worker.timer 2>/dev/null || systemctl is-active --quiet swartzit-worker.timer 2>/dev/null; then
  WORKER_TIMER_WAS_ACTIVE=1
fi
resume_services() {
  local result=0
  systemctl start "${SERVICES[@]}" || result=1
  if (( WORKER_TIMER_WAS_ACTIVE )); then
    systemctl start swartzit-worker.timer || result=1
  fi
  return "$result"
}
rollback() {
  local result=0
  RECOVERY_REQUIRED=0
  echo 'Recovering the previous Swartzit release after an interrupted or failed update.' >&2
  if (( SERVICES_STOP_REQUESTED )); then
    systemctl stop "${SERVICES[@]}" || result=1
    if ! install -m 0755 "$BACKUP_TAG/swartzit-server.previous" /usr/local/bin/swartzit-server.new \
      || ! mv -f /usr/local/bin/swartzit-server.new /usr/local/bin/swartzit-server; then
      echo 'Could not restore the previous server binary.' >&2
      result=1
    fi
    if (( WEB_SWAP_STARTED )); then
      if ! rm -rf "$APP_DIR/apps/web/build" \
        || ! mv "$STAGED_RECOVERY_DIR/build" "$APP_DIR/apps/web/build"; then
        echo 'Could not restore the previous web build.' >&2
        result=1
      fi
    fi
  fi
  "${GIT[@]}" checkout --detach "$PREVIOUS_COMMIT" || result=1
  # Try to restart even if an earlier recovery operation failed.
  resume_services || result=1
  return "$result"
}

# Arm recovery before stopping the worker or changing the checkout. A failed
# stop, checkout, install, rename, health gate or receipt write now recovers.
RECOVERY_REQUIRED=1
if (( WORKER_TIMER_WAS_ACTIVE )); then
  systemctl stop swartzit-worker.timer swartzit-worker.service
fi
"${GIT[@]}" checkout --detach "$TAG"
SERVICES_STOP_REQUESTED=1
systemctl stop "${SERVICES[@]}"
mv -f /usr/local/bin/swartzit-server.new /usr/local/bin/swartzit-server
rm -rf "$APP_DIR/apps/web/build.previous"
WEB_SWAP_STARTED=1
mv "$APP_DIR/apps/web/build" "$APP_DIR/apps/web/build.previous"
mv "$STAGED_WEB_DIR/build" "$APP_DIR/apps/web/build"
systemctl start "${SERVICES[@]}"
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
  echo "Updated release failed API/web health checks. Database backup: $DB_DUMP" >&2
  exit 1
fi
if ! install -m 0644 "$APP_DIR/deploy/systemd/swartzit-github-backup.service" /etc/systemd/system/swartzit-github-backup.service \
  || ! install -m 0644 "$APP_DIR/deploy/systemd/swartzit-github-backup.timer" /etc/systemd/system/swartzit-github-backup.timer \
  || ! systemctl daemon-reload; then
  echo 'Could not install the GitHub database backup service units; restoring the previous release.' >&2
  exit 1
fi
resume_services
mkdir -p "$APP_DIR/state"
# The runtime state directory is service-owned. Never follow pre-existing
# receipt symlinks while writing as root; replace both names atomically.
python3 - "$APP_DIR/state" "$STAMP" "$TAG" "$RELEASE_VERSION" "$("${GIT[@]}" rev-parse HEAD)" "$PREVIOUS_COMMIT" "$PREVIOUS_VERSION" "$DB_DUMP" "$BACKUP_TAG" <<'PY_RECEIPT'
import datetime, json, os, pathlib, sys, tempfile
state = pathlib.Path(sys.argv[1])
path = state / ("release-" + sys.argv[2] + ".json")
name = None
link = None
try:
    with tempfile.NamedTemporaryFile(mode="w", dir=state, prefix=".release-receipt.", delete=False) as output:
        name = output.name
        os.fchmod(output.fileno(), 0o644)
        json.dump(dict(zip(["tag", "version", "commit", "previous_commit", "previous_version", "backup", "recovery_bundle"], sys.argv[3:10])) |
                  {"installed_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}, output)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(name, path)
    fd, link = tempfile.mkstemp(dir=state, prefix=".current-release.")
    os.close(fd)
    os.unlink(link)
    os.symlink(str(path), link)
    os.replace(link, state / "current-release.json")
finally:
    for temporary in (name, link):
        if temporary and os.path.lexists(temporary):
            os.unlink(temporary)
PY_RECEIPT
RECOVERY_REQUIRED=0
rm -rf "$APP_DIR/apps/web/build.previous" || echo 'The previous build directory could not be removed.' >&2
echo "Swartzit updated to $TAG ($RELEASE_VERSION) and passed API/web health checks."
echo "Recovery bundle: $BACKUP_TAG"
