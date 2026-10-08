#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:=sqlite:$PWD/.local/swartzit.sqlite}"
mkdir -p "${SWARTZIT_STATE_DIR:-$PWD/.local}"
export DATABASE_URL
: "${ADMIN_HANDLE:=techmore}"
export ADMIN_HANDLE
# An existing password is preserved. Set RESET_ADMIN_PASSWORD=1 for recovery.
# A new account gets a cryptographically random password printed once.
if ! command -v cargo >/dev/null 2>&1; then
  echo "bootstrap-admin: cargo is required (install Rust stable)." >&2
  exit 1
fi

cargo run --locked -p swartzit-server -- --bootstrap-admin
