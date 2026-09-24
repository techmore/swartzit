#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$0"
while [[ -L "$SCRIPT_PATH" ]]; do
  SCRIPT_LINK_DIR=$(cd "$(dirname "$SCRIPT_PATH")" && pwd)
  SCRIPT_LINK=$(readlink "$SCRIPT_PATH")
  if [[ "$SCRIPT_LINK" == /* ]]; then
    SCRIPT_PATH="$SCRIPT_LINK"
  else
    SCRIPT_PATH="$SCRIPT_LINK_DIR/$SCRIPT_LINK"
  fi
done
SCRIPT_DIR=$(cd "$(dirname "$SCRIPT_PATH")" && pwd)

STATE_DIR="${SWARTZIT_WORKER_STATE_DIR:-${SWARTZIT_STATE_DIR:-${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}}}"
ENV_FILE="${SWARTZIT_WORKER_ENV_FILE:-$STATE_DIR/worker.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # The generated worker.env contains shell-quoted values and is mode 0600.
  # Operators may point SWARTZIT_WORKER_ENV_FILE at their own equivalent file.
  source "$ENV_FILE"
  set +a
fi

export SWARTZIT_WORKER_ROOT="${SWARTZIT_WORKER_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export SWARTZIT_WORKER_STATE_DIR="${SWARTZIT_WORKER_STATE_DIR:-${SWARTZIT_STATE_DIR:-${SWARTZIT_DATA_DIR:-$STATE_DIR}}}"
NODE_BIN="${SWARTZIT_NODE_BIN:-$(command -v node || true)}"
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo 'Node.js is required to run the Swartzit worker.' >&2; exit 1; }

exec "$NODE_BIN" "$SCRIPT_DIR/swartzit-worker.mjs" "$@"

