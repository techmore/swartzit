#!/usr/bin/env bash
# One-time conversion for an existing Linux/systemd PostgreSQL deployment.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
SCRIPT_HOME=$(cd "$(dirname "$0")" && pwd)
APP_DIR=${SWARTZIT_APP_DIR:-/var/lib/swartzit}
ENV_FILE=${SWARTZIT_SERVER_ENV_FILE:-/etc/swartzit/server.env}
UPGRADE_ENV=/etc/swartzit/upgrade.env
DB_FILE=${SWARTZIT_SQLITE_FILE:-$APP_DIR/state/swartzit.sqlite}
TAG=''
CONFIRMED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG=${2:-}; shift 2 ;;
    --yes) CONFIRMED=1; shift ;;
    *) echo 'Usage: swartzit-sqlite-cutover.sh --tag vX.Y.Z --yes' >&2; exit 2 ;;
  esac
done
[[ "$TAG" =~ ^v[0-9][A-Za-z0-9._-]*$ && "$CONFIRMED" == 1 ]] || { echo 'Specify a reviewed release tag and --yes.' >&2; exit 2; }
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" && "$DB_FILE" == /* && ! -e "$DB_FILE" ]] || { echo 'Expected a real server.env and a new absolute SQLite destination.' >&2; exit 1; }
[[ -f "$SCRIPT_HOME/sqlite-db.py" && -f "$SCRIPT_HOME/swartzit-release-update.sh" ]] || { echo 'Install reviewed SQLite release tools first.' >&2; exit 1; }
set -a
source "$ENV_FILE"
set +a
[[ "${DATABASE_URL:-}" == postgres:* || "${DATABASE_URL:-}" == postgresql:* ]] || { echo 'This is only for the one-time PostgreSQL cutover.' >&2; exit 1; }
SOURCE_DATABASE_URL=$DATABASE_URL
RELEASE_BACKUP_DIR=${SWARTZIT_RELEASE_BACKUP_DIR:-/var/backups/swartzit/releases}
mkdir -p "$RELEASE_BACKUP_DIR"
exec 9>"$RELEASE_BACKUP_DIR/.release.lock"
flock -n 9 || { echo 'Another release/cutover is running.' >&2; exit 75; }
SQLITE_URL="sqlite:$DB_FILE"
install -d -o swartzit -g swartzit -m 0700 "$(dirname "$DB_FILE")"
filesystem=$(findmnt -T "$(dirname "$DB_FILE")" -n -o FSTYPE)
case "$filesystem" in nfs*|cifs|smb*|fuse.sshfs) echo 'SQLite state must be on local disk.' >&2; exit 1 ;; esac
umask 0077
RECOVERY=$(mktemp -d /var/backups/swartzit-sqlite-cutover.XXXXXXXX)
cp -p "$ENV_FILE" "$RECOVERY/server.env.postgres"
[[ ! -f "$UPGRADE_ENV" ]] || cp -p "$UPGRADE_ENV" "$RECOVERY/upgrade.env.postgres"
WORKER_WAS_ACTIVE=0
systemctl is-active --quiet swartzit-worker.timer && WORKER_WAS_ACTIVE=1 || true
CHANGED=0
SUCCESS=0
recover() {
  local status=$?
  if (( ! SUCCESS )); then
    echo "Cutover failed; restoring PostgreSQL configuration. Recovery bundle: $RECOVERY" >&2
    if (( CHANGED )); then
      systemctl stop swartzit swartzit-web || true
      cp -p "$RECOVERY/server.env.postgres" "$ENV_FILE"
      [[ ! -f "$RECOVERY/upgrade.env.postgres" ]] || cp -p "$RECOVERY/upgrade.env.postgres" "$UPGRADE_ENV"
    fi
    systemctl start swartzit swartzit-web || true
    if (( WORKER_WAS_ACTIVE )); then systemctl start swartzit-worker.timer || true; fi
  fi
  return "$status"
}
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
systemctl stop swartzit-worker.timer swartzit-worker.service swartzit swartzit-web
# Quiesced source: the dump, manifest and import cannot miss subsequent app writes.
DATABASE_URL="$SOURCE_DATABASE_URL" SWARTZIT_DATABASE_URL="$SOURCE_DATABASE_URL" \
  SWARTZIT_DB_BACKUP_MODE=native SWARTZIT_BACKUP_DIR="$RECOVERY/postgres" \
  SWARTZIT_MEDIA_ROOT="$APP_DIR/state/media" bash "$SCRIPT_HOME/db-backup.sh" > "$RECOVERY/backup.txt"
DATABASE_URL="$SOURCE_DATABASE_URL" python3 "$SCRIPT_HOME/sqlite-db.py" \
  migrate-postgres env:DATABASE_URL "$DB_FILE"
chown swartzit:swartzit "$DB_FILE" "$DB_FILE.migration.json"
chmod 0600 "$DB_FILE" "$DB_FILE.migration.json"
# Values here are local paths, not credentials. Preserve every other setting.
CHANGED=1
python3 - "$ENV_FILE" "$UPGRADE_ENV" "$SQLITE_URL" <<'PY_ENV'
import os,pathlib,sys,tempfile
for name in sys.argv[1:3]:
    path=pathlib.Path(name)
    if not path.exists():continue
    original=path.read_text().splitlines()
    updates={'DATABASE_URL':sys.argv[3]} if name==sys.argv[1] else {'SWARTZIT_DB_BACKUP_MODE':'auto'}
    output=[line for line in original if line.split('=',1)[0].strip() not in updates]
    output.extend(key+'='+value for key,value in updates.items())
    info=path.stat()
    with tempfile.NamedTemporaryFile(mode='w',dir=path.parent,delete=False) as target:
        target.write('\n'.join(output)+'\n')
        os.fchmod(target.fileno(),info.st_mode & 0o777)
        os.fchown(target.fileno(),info.st_uid,info.st_gid)
        staged=target.name
    os.replace(staged,path)
PY_ENV
DATABASE_URL="$SQLITE_URL" SWARTZIT_DATABASE_URL="$SQLITE_URL" SWARTZIT_DB_BACKUP_MODE=auto SWARTZIT_CUTOVER_LOCKED=1 \
  bash "$SCRIPT_HOME/swartzit-release-update.sh" --tag "$TAG" --yes
if (( WORKER_WAS_ACTIVE )); then systemctl start swartzit-worker.timer; fi
SUCCESS=1
printf 'SQLite cutover complete. Recovery bundle: %s\nDatabase: %s\n' "$RECOVERY" "$DB_FILE"
