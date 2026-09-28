#!/usr/bin/env bash
# Entry point for an unattended production update.
#
# This is the command the deploy workflow runs with `sudo -n`, and the
# command the operator-facing documentation and the sudoers rule name. It
# deliberately holds no update logic of its own: everything is delegated to
# scripts/swartzit-release-update.sh, which installs checksummed release assets
# and refuses to touch a live service until the candidate release has proven it
# can migrate a restored copy of the production database.
#
# Keeping this as a thin wrapper means the sudoers grant stays scoped to a
# stable path whose behaviour is defined elsewhere, and it gives one place to
# record a deployment receipt for the workflow to collect.
set -euo pipefail

SCRIPT_HOME=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_HOME/.." && pwd)
RELEASE_UPDATER="$SCRIPT_HOME/swartzit-release-update.sh"
RECEIPT_PATH=${SWARTZIT_UPDATE_RECEIPT:-$ROOT/state/update-receipt.json}

if [[ ! -x "$RELEASE_UPDATER" ]]; then
  echo "Release updater is missing or not executable: $RELEASE_UPDATER" >&2
  exit 1
fi

TAG=""
ASSUME_YES=0
EXTRA=()
SYNC_X_TOKEN=0
BACKUP_MODE=""
BACKUP_REMOTE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    --dry-run)
      EXTRA+=(--dry-run)
      shift
      ;;
    --sync-x-token-stdin)
      SYNC_X_TOKEN=1
      shift
      ;;
    --prepare-github-backup)
      [[ -z "$BACKUP_MODE" ]] || { echo 'Choose only one GitHub backup setup mode.' >&2; exit 2; }
      BACKUP_MODE=prepare
      shift
      ;;
    --enable-github-backup)
      [[ -z "$BACKUP_MODE" ]] || { echo 'Choose only one GitHub backup setup mode.' >&2; exit 2; }
      BACKUP_MODE=enable
      shift
      ;;
    --remote)
      BACKUP_REMOTE="${2:-}"
      shift 2
      ;;
    *)
      echo "Usage: $0 --tag vX.Y.Z [--yes] [--dry-run] | --sync-x-token-stdin | --prepare-github-backup --remote git@github.com:OWNER/REPO.git | --enable-github-backup --remote git@github.com:OWNER/REPO.git" >&2
      exit 2
      ;;
  esac
done

if (( SYNC_X_TOKEN )); then
  [[ -z "$TAG" && "$ASSUME_YES" -eq 0 && "${#EXTRA[@]}" -eq 0 && -z "$BACKUP_MODE" && -z "$BACKUP_REMOTE" ]] || {
    echo 'Token sync mode cannot be combined with release update options.' >&2
    exit 2
  }
  TOKEN_UPDATER="$SCRIPT_HOME/update-worker-x-token.py"
  [[ -f "$TOKEN_UPDATER" ]] || { echo "Worker token updater is missing: $TOKEN_UPDATER" >&2; exit 1; }
  exec python3 "$TOKEN_UPDATER"
fi

if [[ -n "$BACKUP_MODE" ]]; then
  [[ -z "$TAG" && "$ASSUME_YES" -eq 0 && "${#EXTRA[@]}" -eq 0 && "$SYNC_X_TOKEN" -eq 0 ]] || {
    echo 'GitHub backup setup mode cannot be combined with release update options.' >&2
    exit 2
  }
  [[ -n "$BACKUP_REMOTE" ]] || { echo 'GitHub backup setup requires --remote.' >&2; exit 2; }
  BACKUP_SETUP="$SCRIPT_HOME/swartzit-github-backup-setup.sh"
  [[ -f "$BACKUP_SETUP" ]] || { echo "GitHub backup setup script is missing: $BACKUP_SETUP" >&2; exit 1; }
  exec bash "$BACKUP_SETUP" "$BACKUP_MODE" "$BACKUP_REMOTE"
fi

[[ -z "$BACKUP_REMOTE" ]] || { echo '--remote is only valid with a GitHub backup setup mode.' >&2; exit 2; }

[[ -n "$TAG" ]] || { echo "Usage: $0 --tag vX.Y.Z [--yes] [--dry-run]" >&2; exit 2; }

# A deployment receipt is written whatever happens, so a failed remote deploy can
# be diagnosed from the workflow log alone.
write_receipt() {
  local state="$1" detail="$2"
  mkdir -p "$(dirname "$RECEIPT_PATH")" 2>/dev/null || return 0
  printf '{"state":"%s","tag":"%s","detail":"%s","host":"%s","updated_at":"%s"}\n' \
    "$state" "$TAG" "$detail" "$(hostname 2>/dev/null || echo unknown)" \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$RECEIPT_PATH" 2>/dev/null || true
}

export SWARTZIT_UPDATE_RECEIPT="$RECEIPT_PATH"

if (( ASSUME_YES )); then
  write_receipt updating "applying $TAG"
else
  write_receipt checking "verifying $TAG"
fi

ARGS=(--tag "$TAG")
(( ASSUME_YES )) && ARGS+=(--yes)
(( ${#EXTRA[@]} )) && ARGS+=("${EXTRA[@]}")

set +e
bash "$RELEASE_UPDATER" "${ARGS[@]}"
STATUS=$?
set -e

if (( STATUS == 0 )); then
  if (( ${#EXTRA[@]} )); then
    write_receipt checked "$TAG verified; nothing changed"
    echo "Dry run for $TAG passed; nothing was changed."
  else
    write_receipt updated "$TAG applied and healthy"
    echo "Production is now on $TAG."
  fi
else
  write_receipt failed "$TAG failed with status $STATUS"
  echo "Production update to $TAG failed with status $STATUS; see $ROOT/state for the recovery bundle." >&2
fi

exit "$STATUS"
