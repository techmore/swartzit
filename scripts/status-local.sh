#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if [[ -n "${SWARTZIT_STATE_DIR:-}" ]]; then
  STATE_DIR="$SWARTZIT_STATE_DIR"
elif [[ -d "$ROOT/.git" || -d "$ROOT/.local" ]]; then
  STATE_DIR="$ROOT/.local"
else
  STATE_DIR="${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}"
fi
if [[ -f "$STATE_DIR/runtime.env" ]]; then
  set -a
  source "$STATE_DIR/runtime.env"
  set +a
fi
api="${API_URL:-http://127.0.0.1:18080}"
web_url="${SWARTZIT_LOCAL_URL:-http://127.0.0.1:${PORT:-4173}}"
public_url="${SWARTZIT_CHECK_URL:-${SWARTZIT_ORIGIN:-}}"
db_container="${SWARTZIT_DB_CONTAINER:-swartzit-db}"
db_user="${SWARTZIT_DB_USER:-swartzit}"
json=0
[[ "${1:-}" == "--json" ]] && json=1
check_http() { curl -fsS --max-time "${SWARTZIT_CHECK_TIMEOUT:-5}" -o /dev/null "$1" >/dev/null 2>&1; }
api_status=down; web_status=down; database_status=down; caddy_status=not-configured; worker_status=not-configured; public_status=not-configured
check_http "$api/api/posts?limit=1" && api_status=ready || true
check_http "$web_url/" && web_status=ready || true
if command -v container >/dev/null 2>&1 && container exec "$db_container" pg_isready -U "$db_user" >/dev/null 2>&1; then database_status=ready; fi
if [[ -f "$STATE_DIR/caddy.pid" ]] && kill -0 "$(cat "$STATE_DIR/caddy.pid")" 2>/dev/null; then caddy_status=running; elif [[ "${SWARTZIT_CADDY:-0}" == 1 ]]; then caddy_status=down; fi
if [[ -f "$STATE_DIR/worker.pid" ]] && kill -0 "$(cat "$STATE_DIR/worker.pid")" 2>/dev/null; then worker_status=running; elif [[ -f "$STATE_DIR/worker.last-run" ]]; then worker_status=last-run; fi
if [[ -n "$public_url" ]]; then check_http "$public_url" && public_status=ready || public_status=down; fi
if (( json )); then
  node -e 'console.log(JSON.stringify({api:process.argv[1],web:process.argv[2],database:process.argv[3],caddy:process.argv[4],worker:process.argv[5],public:process.argv[6],checked_at:new Date().toISOString()}))' "$api_status" "$web_status" "$database_status" "$caddy_status" "$worker_status" "$public_status"
else
  printf 'Swartzit status (%s)\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
  printf '  API:       %s (%s)\n' "$api_status" "$api"
  printf '  Web:       %s (%s)\n' "$web_status" "$web_url"
  printf '  Database:  %s\n' "$database_status"
  printf '  Caddy:     %s\n' "$caddy_status"
  printf '  Worker:    %s\n' "$worker_status"
  [[ "$public_status" == not-configured ]] || printf '  Public:    %s (%s)\n' "$public_status" "$public_url"
fi
healthy=0
[[ "$api_status" == ready && "$web_status" == ready && "$database_status" == ready ]] || healthy=1
[[ "$public_status" == not-configured || "$public_status" == ready ]] || healthy=1
exit "$healthy"
