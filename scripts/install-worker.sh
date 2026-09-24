#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
case "$(uname -s)" in
  Darwin) exec "$SCRIPT_DIR/install-mac-worker.sh" "$@" ;;
  Linux) exec "$SCRIPT_DIR/install-linux-worker.sh" "$@" ;;
  *)
    cat >&2 <<'EOF'
Automatic worker installation is currently supported on macOS (launchd) and Linux (systemd).
The worker itself is platform-neutral and can be run with:
  node scripts/swartzit-worker.mjs
EOF
    exit 2
    ;;
esac

