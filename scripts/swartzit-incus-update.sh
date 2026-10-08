#!/usr/bin/env bash
# Root-owned SER8 entry point for the Swartzit application inside Incus.
# Install this reviewed file as /usr/local/sbin/swartzit-incus-update.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run this adapter as root.' >&2; exit 1; }
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
readonly INSTANCE=swartzit
readonly UPDATER=/usr/local/libexec/swartzit/scripts/swartzit-linux-update.sh
readonly RECEIPT=/var/lib/swartzit/state/update-receipt.json
command -v incus >/dev/null || { echo 'The Incus CLI is required on SER8.' >&2; exit 1; }

usage() {
  echo 'Usage: swartzit-incus-update --tag vX.Y.Z [--yes] [--dry-run] | --sync-x-token-stdin | --receipt' >&2
  exit 2
}

if [[ ${1:-} == --receipt ]]; then
  [[ $# -eq 1 ]] || usage
  exec incus --force-local exec "$INSTANCE" -- /usr/sbin/runuser -u swartzit -- /bin/cat "$RECEIPT"
fi

ARGS=()
if [[ ${1:-} == --sync-x-token-stdin ]]; then
  [[ $# -eq 1 ]] || usage
  ARGS=(--sync-x-token-stdin)
else
  TAG=''
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tag)
        [[ $# -ge 2 && -z "$TAG" ]] || usage
        TAG=$2
        [[ "$TAG" =~ ^v[0-9][A-Za-z0-9._-]*$ ]] || usage
        ARGS+=(--tag "$TAG")
        shift 2
        ;;
      --yes|--dry-run)
        ARGS+=("$1")
        shift
        ;;
      *) usage ;;
    esac
  done
  [[ -n "$TAG" ]] || usage
fi

# The guest manager loads its root-owned environment file. Credentials never
# travel through shell interpolation, host environment forwarding, or argv.
# --pipe preserves stdin for token sync and returns the guest operation status.
exec incus --force-local exec "$INSTANCE" --mode=non-interactive -- \
  /usr/bin/systemd-run --unit=swartzit-release-update --wait --pipe --collect \
  --property=Type=exec \
  --property=User=root \
  --property=Group=root \
  --property=EnvironmentFile=/etc/swartzit/upgrade.env \
  --setenv=SWARTZIT_APP_DIR=/var/lib/swartzit \
  --setenv=SWARTZIT_UPDATE_RECEIPT="$RECEIPT" \
  "$UPDATER" "${ARGS[@]}"
