#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:=sqlite:$PWD/.local/swartzit.sqlite}"
mkdir -p "${SWARTZIT_STATE_DIR:-$PWD/.local}"
export DATABASE_URL

if ! command -v cargo >/dev/null 2>&1; then
  echo "post-install: cargo is required (install Rust stable)." >&2
  exit 1
fi

# Applies migrations and upserts the starter community directory.
# Idempotent: existing slugs keep their current name/description.
cargo run --locked -p swartzit-server -- --seed-communities
