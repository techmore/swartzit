#!/usr/bin/env bash
set -Eeuo pipefail

# Production updater for a source checkout managed by systemd. The updater is
# intentionally explicit: it refuses to run without --yes, creates and
# validates a PostgreSQL backup before stopping services, preserves the
# existing /etc/swartzit/*.env files, and rolls the code checkout back when
# the new build or health gate fails. Database restoration is never automatic;
# the backup path is recorded for an operator because restoring data can lose
# writes made after the backup.

[[ $EUID -eq 0 ]] || { echo 'Run the Linux updater as root.' >&2; exit 1; }

APP_DIR="${SWARTZIT_APP_DIR:-/var/lib/swartzit}"
RUN_USER="${SWARTZIT_RUN_USER:-swartzit}"
STATE_DIR="${SWARTZIT_STATE_DIR:-$APP_DIR/state}"
BACKUP_DIR="${SWARTZIT_BACKUP_DIR:-$STATE_DIR/backups}"
SERVER_ENV_FILE="${SWARTZIT_SERVER_ENV_FILE:-/etc/swartzit/server.env}"
WEB_ENV_FILE="${SWARTZIT_WEB_ENV_FILE:-/etc/swartzit/web.env}"
UPDATE_ENV_FILE="${SWARTZIT_UPDATE_ENV_FILE:-/etc/swartzit/update.env}"
ERROR_URL="${SWARTZIT_UPDATE_ERROR_URL:-}"
ERROR_TOKEN="${SWARTZIT_UPDATE_ERROR_TOKEN:-}"
REF="${SWARTZIT_UPDATE_REF:-main}"
CONFIRMED=0

if [[ -f "$UPDATE_ENV_FILE" ]]; then
  # This is a root-owned operator configuration file, not repository input.
  set -a
  # shellcheck disable=SC1090
  source "$UPDATE_ENV_FILE"
  set +a
  REF="${SWARTZIT_UPDATE_REF:-$REF}"
  ERROR_URL="${SWARTZIT_UPDATE_ERROR_URL:-$ERROR_URL}"
  ERROR_TOKEN="${SWARTZIT_UPDATE_ERROR_TOKEN:-$ERROR_TOKEN}"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      CONFIRMED=1
      shift
      ;;
    --ref)
      REF="${2:-}"
      shift 2
      ;;
    *)
      echo "Usage: $0 --yes [--ref main]" >&2
      exit 2
      ;;
  esac
done

if (( ! CONFIRMED )); then
  echo 'This creates and validates a database backup, updates the source checkout, and restarts systemd services.' >&2
  echo "Use: $0 --yes [--ref $REF]" >&2
  exit 2
fi

[[ -d "$APP_DIR/.git" ]] || { echo "Git checkout not found: $APP_DIR" >&2; exit 1; }
[[ -r "$SERVER_ENV_FILE" ]] || { echo "Missing server environment: $SERVER_ENV_FILE" >&2; exit 1; }
[[ -r "$WEB_ENV_FILE" ]] || { echo "Missing web environment: $WEB_ENV_FILE" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo 'git is required.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo 'curl is required.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'node is required.' >&2; exit 1; }

mkdir -p "$STATE_DIR" "$BACKUP_DIR"
LOCK_DIR="$STATE_DIR/.update.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another Swartzit update is already running: $LOCK_DIR" >&2
  exit 75
fi
cleanup_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup_lock EXIT

RECEIPT_PATH="${SWARTZIT_UPDATE_RECEIPT:-$STATE_DIR/update-receipt.json}"
CURRENT_PHASE="preflight"
PREVIOUS_COMMIT="$(git -C "$APP_DIR" rev-parse HEAD)"
PREVIOUS_VERSION="development"
[[ -f "$APP_DIR/VERSION" ]] && PREVIOUS_VERSION="$(<"$APP_DIR/VERSION")"
CURRENT_COMMIT="$PREVIOUS_COMMIT"
CURRENT_VERSION="$PREVIOUS_VERSION"
BACKUP_PATH=""
ARCHIVE_PATH=""
WEB_BIND="unknown"

set -a
# shellcheck disable=SC1090
source "$SERVER_ENV_FILE"
DATABASE_URL_VALUE="${DATABASE_URL:-${SWARTZIT_DATABASE_URL:-}}"
set +a
set -a
# shellcheck disable=SC1090
source "$WEB_ENV_FILE"
WEB_HOST_VALUE="${HOST:-127.0.0.1}"
WEB_PORT_VALUE="${PORT:-4173}"
set +a
WEB_BIND="$WEB_HOST_VALUE:$WEB_PORT_VALUE"

write_receipt() {
  local state="$1"
  local phase="$2"
  local detail="$3"
  local receipt_dir
  receipt_dir="$(dirname "$RECEIPT_PATH")"
  mkdir -p "$receipt_dir"
  RECEIPT_STATE="$state" \
  RECEIPT_PHASE="$phase" \
  RECEIPT_DETAIL="$detail" \
  RECEIPT_PREVIOUS_VERSION="$PREVIOUS_VERSION" \
  RECEIPT_CURRENT_VERSION="$CURRENT_VERSION" \
  RECEIPT_PREVIOUS_COMMIT="$PREVIOUS_COMMIT" \
  RECEIPT_CURRENT_COMMIT="$CURRENT_COMMIT" \
  RECEIPT_BACKUP="$BACKUP_PATH" \
  RECEIPT_ARCHIVE="$ARCHIVE_PATH" \
  RECEIPT_BIND="$WEB_BIND" \
  RECEIPT_REF="$REF" \
  RECEIPT_PATH="$RECEIPT_PATH" \
    node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const value = {
  state: process.env.RECEIPT_STATE,
  phase: process.env.RECEIPT_PHASE,
  detail: process.env.RECEIPT_DETAIL,
  previous_version: process.env.RECEIPT_PREVIOUS_VERSION,
  current_version: process.env.RECEIPT_CURRENT_VERSION,
  previous_commit: process.env.RECEIPT_PREVIOUS_COMMIT,
  current_commit: process.env.RECEIPT_CURRENT_COMMIT,
  ref: process.env.RECEIPT_REF,
  backup: process.env.RECEIPT_BACKUP || null,
  archive: process.env.RECEIPT_ARCHIVE || null,
  web_bind: process.env.RECEIPT_BIND,
  updated_at: new Date().toISOString(),
};
const target = process.env.RECEIPT_PATH;
const temporary = `${target}.tmp.${process.pid}`;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
fs.renameSync(temporary, target);
NODE
}

report_error() {
  local state="$1"
  local phase="$2"
  local detail="$3"
  write_receipt "$state" "$phase" "$detail"
  logger -t swartzit-update -- "state=$state phase=$phase detail=$detail" 2>/dev/null || true
  [[ -n "$ERROR_URL" ]] || return 0

  payload=$(
    UPDATE_ERROR_STATE="$state" \
    UPDATE_ERROR_PHASE="$phase" \
    UPDATE_ERROR_DETAIL="$detail" \
    UPDATE_ERROR_VERSION="$CURRENT_VERSION" \
    UPDATE_ERROR_COMMIT="$CURRENT_COMMIT" \
    UPDATE_ERROR_BIND="$WEB_BIND" \
      node --input-type=module <<'NODE'
console.log(JSON.stringify({
  source: 'swartzit-linux-update',
  state: process.env.UPDATE_ERROR_STATE,
  phase: process.env.UPDATE_ERROR_PHASE,
  detail: process.env.UPDATE_ERROR_DETAIL,
  version: process.env.UPDATE_ERROR_VERSION,
  commit: process.env.UPDATE_ERROR_COMMIT,
  web_bind: process.env.UPDATE_ERROR_BIND,
  host: process.env.HOSTNAME || 'unknown',
  occurred_at: new Date().toISOString(),
}));
NODE
)
  headers=(-H 'content-type: application/json')
  [[ -n "$ERROR_TOKEN" ]] && headers+=(-H "authorization: Bearer $ERROR_TOKEN")
  curl -fsS --max-time 10 -X POST "${headers[@]}" --data "$payload" "$ERROR_URL" >/dev/null || true
}

fail_before_change() {
  local detail="$1"
  report_error failed "$CURRENT_PHASE" "$detail"
  echo "$detail" >&2
  exit 1
}

if [[ -n "$(git -C "$APP_DIR" status --porcelain)" ]]; then
  fail_before_change 'The production checkout has local changes; refusing to overwrite them.'
fi

write_receipt updating preflight 'Preparing the production update'
[[ -n "$DATABASE_URL_VALUE" ]] || fail_before_change 'DATABASE_URL is missing from the server environment.'

CURRENT_PHASE="backup"
write_receipt updating backup 'Creating the pre-update PostgreSQL backup'
backup_output=''
if ! backup_output=$(
  SWARTZIT_DB_BACKUP_MODE=native \
  SWARTZIT_DATABASE_URL="$DATABASE_URL_VALUE" \
  SWARTZIT_BACKUP_DIR="$BACKUP_DIR" \
  SWARTZIT_STATE_DIR="$STATE_DIR" \
  "$APP_DIR/scripts/db-backup.sh" 2>&1
); then
  printf '%s\n' "$backup_output" >&2
  fail_before_change 'The pre-update PostgreSQL backup failed; services were not stopped.'
fi
printf '%s\n' "$backup_output" > "$STATE_DIR/last-update-backup.txt"
BACKUP_PATH="$(printf '%s\n' "$backup_output" | sed -n 's/^Backup: //p' | head -n 1)"
ARCHIVE_PATH="$(printf '%s\n' "$backup_output" | sed -n 's/^Archive: //p' | head -n 1)"
[[ -f "$BACKUP_PATH" && -f "$ARCHIVE_PATH" ]] || fail_before_change 'The backup command did not return usable dump and archive paths.'

CURRENT_PHASE="verify-backup"
write_receipt updating verify-backup 'Validating the backup checksum and PostgreSQL dump'
backup_dir="$(dirname "$BACKUP_PATH")"
if ! (cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null) || ! pg_restore --list "$BACKUP_PATH" >/dev/null; then
  fail_before_change 'The pre-update backup failed checksum or pg_restore validation; services were not stopped.'
fi

build_release() {
  runuser -u "$RUN_USER" -- bash -lc "cd '$APP_DIR' && cargo build --release --locked && npm ci --omit=dev && npm --prefix apps/web ci && npm --prefix apps/web run build"
  install -o root -g root -m 0755 "$APP_DIR/target/release/swartzit-server" /usr/local/bin/swartzit-server
  install -m 0644 "$APP_DIR/deploy/systemd/swartzit.service" /etc/systemd/system/swartzit.service
  install -m 0644 "$APP_DIR/deploy/systemd/swartzit-web.service" /etc/systemd/system/swartzit-web.service
  install -m 0644 "$APP_DIR/deploy/systemd/swartzit-worker.service" /etc/systemd/system/swartzit-worker.service
  install -m 0644 "$APP_DIR/deploy/systemd/swartzit-worker.timer" /etc/systemd/system/swartzit-worker.timer
  systemctl daemon-reload
}

stop_services() {
  systemctl stop swartzit-worker.timer swartzit-worker.service swartzit-web.service swartzit.service 2>/dev/null || true
}

start_services() {
  systemctl start swartzit.service
  systemctl start swartzit-web.service
  systemctl start swartzit-worker.timer
}

wait_for_health() {
  local api_url="${SWARTZIT_UPDATE_API_URL:-http://127.0.0.1:18080}"
  local web_host="$WEB_HOST_VALUE"
  [[ "$web_host" == 0.0.0.0 ]] && web_host=127.0.0.1
  [[ "$web_host" == :: ]] && web_host=127.0.0.1
  local web_url="http://${web_host}:${WEB_PORT_VALUE}"
  local public_url="${SWARTZIT_UPDATE_PUBLIC_URL:-}"
  for _ in {1..60}; do
    if curl -fsS --max-time 5 "$api_url/ready" >/dev/null 2>&1 \
      && curl -fsS --max-time 5 "$api_url/health" >/dev/null 2>&1 \
      && curl -fsS --max-time 5 "$web_url/" >/dev/null 2>&1; then
      if [[ -z "$public_url" ]] || curl -fsS --max-time 10 "$public_url" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

rollback_code() {
  stop_services
  git -C "$APP_DIR" switch --detach "$PREVIOUS_COMMIT" >/dev/null
  CURRENT_COMMIT="$PREVIOUS_COMMIT"
  CURRENT_VERSION="$PREVIOUS_VERSION"
  build_release
  start_services
  wait_for_health
}

CURRENT_PHASE="stopping"
write_receipt updating stopping 'Stopping Swartzit services while the code is updated'
stop_services

CURRENT_PHASE="fetching"
write_receipt updating fetching "Fetching GitHub ref $REF"
if ! git -C "$APP_DIR" fetch --prune origin "$REF"; then
  start_services || true
  fail_before_change "Could not fetch GitHub ref $REF; the existing release was left in place."
fi

CURRENT_PHASE="building"
if ! git -C "$APP_DIR" switch --detach FETCH_HEAD >/dev/null; then
  start_services || true
  fail_before_change "Could not switch the production checkout to fetched ref $REF; the existing release was left in place."
fi
CURRENT_COMMIT="$(git -C "$APP_DIR" rev-parse HEAD)"
[[ -f "$APP_DIR/VERSION" ]] && CURRENT_VERSION="$(<"$APP_DIR/VERSION")" || CURRENT_VERSION=development
write_receipt updating building "Building commit $CURRENT_COMMIT"
if ! build_release; then
  if rollback_code; then
    report_error rolled_back building "The new release failed to build; code was rolled back to $PREVIOUS_COMMIT."
  else
    report_error failed rollback 'The new release failed to build and automatic code rollback did not pass health checks.'
  fi
  exit 1
fi

CURRENT_PHASE="starting"
write_receipt updating starting "Starting Swartzit services on $WEB_BIND"
if ! start_services; then
  if rollback_code; then
    report_error rolled_back starting "The new release could not start; code was rolled back to $PREVIOUS_COMMIT."
  else
    report_error failed rollback 'The new release could not start and automatic code rollback did not pass health checks.'
  fi
  exit 1
fi

CURRENT_PHASE="verifying"
write_receipt updating verifying 'Waiting for API, web, and optional public health checks'
if ! wait_for_health; then
  if rollback_code; then
    report_error rolled_back verifying "The new release failed health checks; code was rolled back to $PREVIOUS_COMMIT. Database backup: $BACKUP_PATH"
  else
    report_error failed rollback "The new release failed health checks and automatic code rollback did not pass. Database backup: $BACKUP_PATH"
  fi
  exit 1
fi

write_receipt completed completed "Swartzit updated and health checks passed; bind preserved at $WEB_BIND"
echo "Swartzit update completed: $PREVIOUS_COMMIT -> $CURRENT_COMMIT"
echo "Version: $PREVIOUS_VERSION -> $CURRENT_VERSION"
echo "Bind preserved: $WEB_BIND"
echo "Backup: $BACKUP_PATH"
echo "Archive: $ARCHIVE_PATH"
