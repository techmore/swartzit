#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:=postgres://swartzit:swartzit-local-only@127.0.0.1:54329/swartzit}"
export DATABASE_URL
: "${ADMIN_HANDLE:=techmore}"
export ADMIN_HANDLE
# An existing password is preserved. Set RESET_ADMIN_PASSWORD=1 for recovery.
# A new account gets a cryptographically random password printed once.
if ! command -v cargo >/dev/null 2>&1; then
  echo "bootstrap-admin: cargo is required (install Rust stable) and PostgreSQL must be reachable at \$DATABASE_URL." >&2
  exit 1
fi

cargo run --locked -p swartzit-server -- --bootstrap-admin
