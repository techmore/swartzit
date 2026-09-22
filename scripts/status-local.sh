#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
api=${API_URL:-http://127.0.0.1:18080}
web_port=${PORT:-4173}
printf 'Swartzit local status\n'
if curl -fsS --max-time 2 "$api/api/posts?limit=1" >/dev/null 2>&1; then
  echo '  API:      ready'
else
  echo '  API:      down'
fi
if curl -fsS --max-time 2 "http://127.0.0.1:$web_port/" >/dev/null 2>&1; then
  echo "  Web:      ready (port $web_port)"
else
  echo "  Web:      down (port $web_port)"
fi
if command -v container >/dev/null && container exec swartzit-db pg_isready -U swartzit >/dev/null 2>&1; then
  echo '  Database: ready'
else
  echo '  Database: down'
fi
if lsof -nP -iTCP:443 -sTCP:LISTEN >/dev/null 2>&1; then
  echo '  Caddy:    listening on 443'
else
  echo '  Caddy:    not listening (LAN-only mode)'
fi
