#!/usr/bin/env bash
# Entry point for an unattended production update.
#
# This is the command the deploy workflow runs over SSH with `sudo -n`, and the
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
    *)
      echo "Usage: $0 --tag vX.Y.Z [--yes] [--dry-run]" >&2
      exit 2
      ;;
  esac
done

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
  write_receipt updated "$TAG applied and healthy"
  echo "Production is now on $TAG."
else
  write_receipt failed "$TAG failed with status $STATUS"
  echo "Production update to $TAG failed with status $STATUS; see $ROOT/state for the recovery bundle." >&2
fi

exit "$STATUS"
