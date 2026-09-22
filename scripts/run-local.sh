#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
mkdir -p .local
export DATABASE_URL="${DATABASE_URL:-postgres://swartzit:swartzit-local-only@127.0.0.1:54329/swartzit}"
export BIND_ADDR="${BIND_ADDR:-127.0.0.1:18080}"
export API_URL="${API_URL:-http://127.0.0.1:18080}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-4173}"
export ORIGIN="${ORIGIN:-http://127.0.0.1:$PORT}"
API_LOG=.local/api.log
WEB_LOG=.local/web.log
if command -v container >/dev/null; then
  container system start >/dev/null
  if container inspect swartzit-db >/dev/null 2>&1; then
    container start swartzit-db >/dev/null 2>&1 || true
  else
    container run -d --name swartzit-db -p 127.0.0.1:54329:5432 \
      -e POSTGRES_USER=swartzit -e POSTGRES_PASSWORD=swartzit-local-only \
      -e POSTGRES_DB=swartzit -e PGDATA=/var/lib/postgresql/data/pgdata \
      -v swartzit-db-data:/var/lib/postgresql/data docker.io/library/postgres:16 >/dev/null
  fi
  ready=false
  for attempt in {1..45}; do
    if container exec swartzit-db pg_isready -U swartzit >/dev/null 2>&1; then ready=true; break; fi
    [[ "$attempt" == 45 ]] && { echo 'PostgreSQL did not become ready.' >&2; exit 1; }
    sleep 1
  done
  $ready || exit 1
fi
if [[ "${SWARTZIT_BUILD:-0}" == 1 || ! -x target/debug/swartzit-server ]]; then cargo build --locked; fi
if [[ "${SWARTZIT_BUILD:-0}" == 1 || ! -f apps/web/build/index.js ]]; then
  npm --prefix apps/web ci
  npm --prefix apps/web run build
fi
api_ok() { curl -fsS --max-time 2 "$API_URL/api/posts?limit=1" >/dev/null 2>&1; }
web_ok() { curl -fsS --max-time 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; }
if ! api_ok; then
  # Keep the original first-run demo seeding behavior, but only do it while
  # the API is stopped so restarts never create a second listener.
  target/debug/swartzit-server --seed-demo >/dev/null 2>&1 || true
  nohup target/debug/swartzit-server >"$API_LOG" 2>&1 < /dev/null & echo $! > .local/api.pid
  for attempt in {1..30}; do api_ok && break; sleep 1; done
  api_ok || { tail -40 "$API_LOG" >&2; exit 1; }
fi
if ! web_ok; then
  nohup env HOST="$HOST" PORT="$PORT" ORIGIN="$ORIGIN" API_URL="$API_URL" \
    node apps/web/build >"$WEB_LOG" 2>&1 < /dev/null & echo $! > .local/web.pid
  for attempt in {1..20}; do web_ok && break; sleep 1; done
  web_ok || { tail -40 "$WEB_LOG" >&2; exit 1; }
fi
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
[[ -z "$LAN_IP" ]] && LAN_IP=$(ipconfig getifaddr en1 2>/dev/null || true)
echo "Swartzit ready: $ORIGIN"
[[ -n "$LAN_IP" ]] && echo "LAN: http://$LAN_IP:$PORT"
echo "API: $API_URL (database remains private)"
if [[ "${SWARTZIT_CADDY:-0}" == 1 ]] && command -v caddy >/dev/null && [[ -n "${SWARTZIT_DOMAIN:-}" ]]; then
  cat > .local/caddy-runtime.caddyfile <<EOF
{
  admin off
}
${SWARTZIT_DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:${PORT}
}
EOF
  if ! pgrep -f "caddy run --config .local/caddy-runtime.caddyfile" >/dev/null 2>&1; then
    nohup caddy run --config .local/caddy-runtime.caddyfile --adapter caddyfile > .local/caddy.log 2>&1 < /dev/null & echo $! > .local/caddy.pid
  fi
  echo "HTTPS: https://$SWARTZIT_DOMAIN (requires router forwarding 80/443)"
fi
