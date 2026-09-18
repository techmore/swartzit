#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:=postgres://swartzit:swartzit-local-only@127.0.0.1:54329/swartzit}"
export DATABASE_URL

if ! command -v cargo >/dev/null 2>&1; then
  echo "post-install: cargo is required (install Rust stable) and PostgreSQL must be reachable at \$DATABASE_URL." >&2
  exit 1
fi

# Applies migrations and upserts the starter community directory.
# Idempotent: existing slugs keep their current name/description.
cargo run --locked -p swartzit-server -- --seed-communities
