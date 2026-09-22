#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
for name in caddy web api; do
  file=".local/$name.pid"
  if [[ -f "$file" ]]; then
    kill "$(cat "$file")" 2>/dev/null || true
    rm -f "$file"
  fi
done
echo 'Swartzit application services stopped; PostgreSQL data is preserved.'
