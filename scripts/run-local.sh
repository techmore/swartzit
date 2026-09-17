#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://swartzit:swartzit-local-only@127.0.0.1:54329/swartzit}"
export BIND_ADDR="${BIND_ADDR:-127.0.0.1:18080}"
export API_URL="${API_URL:-http://127.0.0.1:18080}"
export HOST=127.0.0.1
export PORT="${PORT:-4173}"
export ORIGIN="${ORIGIN:-http://127.0.0.1:$PORT}"
if command -v container >/dev/null; then
  container system start
  if container inspect swartzit-db >/dev/null 2>&1; then
    container start swartzit-db || true
  else
    container run -d --name swartzit-db -p 127.0.0.1:54329:5432 \
      -e POSTGRES_USER=swartzit -e POSTGRES_PASSWORD=swartzit-local-only \
      -e POSTGRES_DB=swartzit -e PGDATA=/var/lib/postgresql/data/pgdata \
      -v swartzit-db-data:/var/lib/postgresql/data docker.io/library/postgres:16
  fi
  ready=false
  for attempt in {1..30}; do
    if container exec swartzit-db pg_isready -U swartzit >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  if ! $ready; then echo 'PostgreSQL did not become ready.' >&2; exit 1; fi
fi
cargo build --locked
npm --prefix apps/web ci
npm --prefix apps/web run build
target/debug/swartzit-server --seed-demo
target/debug/swartzit-server &
api_pid=$!
cleanup() { kill "$api_pid" "${web_pid:-$api_pid}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
node apps/web/build &
web_pid=$!
echo "Swartzit: $ORIGIN (Ctrl-C stops web and API; PostgreSQL data stays in its named volume)"
wait "$web_pid"
