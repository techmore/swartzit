#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo '== source checks =='
git diff --check
git diff --quiet
git diff --cached --quiet

echo '== Rust checks =='
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings

echo '== web checks =='
npm --prefix apps/web run check
npm --prefix apps/web run build

echo '== Node and shell checks =='
node --check scripts/perf-smoke.mjs
node --test scripts/*.test.mjs apps/web/src/lib/*.test.mjs
while IFS= read -r -d '' script; do bash -n "$script"; done < <(find scripts -maxdepth 1 -type f -name '*.sh' -print0)

echo '== macOS packaging checks =='
if [[ "$(uname -s)" == Darwin ]]; then
  swiftc -O -o /tmp/swartzit-status-preflight macos/SwartzitStatus.swift
fi

echo '== backup archive checks =='
shopt -s nullglob
archives=(.local/backups/*.tgz)
if ((${#archives[@]})); then
  for archive in "${archives[@]}"; do tar -tzf "$archive" >/dev/null; done
  while IFS= read -r -d '' sums; do (cd "$(dirname "$sums")" && shasum -a 256 -c "$(basename "$sums")"); done < <(find .local/backups -mindepth 2 -maxdepth 2 -name SHA256SUMS -print0)
else
  echo 'No local backup archive found; run scripts/db-backup.sh before release.' >&2
  exit 1
fi
echo 'Release preflight passed.'
