#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
mkdir -p .local
PORT="${PORT:-4173}"
MODE="${SWARTZIT_MODE:-${SWARTZIT_BIND_INTERFACE:-${1:-lan}}}"

interface_ip() {
  local interface="$1"
  if [[ "$interface" == "loopback" || "$interface" == "lo0" ]]; then
    echo 127.0.0.1
    return 0
  fi
  ipconfig getifaddr "$interface" 2>/dev/null || \
    ifconfig "$interface" 2>/dev/null | awk '$1 == "inet" { print $2; exit }'
}

LAN_INTERFACE="${SWARTZIT_WIFI_INTERFACE:-en0}"
LAN_IP="$(interface_ip "$LAN_INTERFACE" || true)"
if [[ -z "$LAN_IP" && "$LAN_INTERFACE" == "en0" ]]; then
  LAN_INTERFACE=en1
  LAN_IP="$(interface_ip "$LAN_INTERFACE" || true)"
fi
ETHERNET_INTERFACE="${SWARTZIT_ETHERNET_INTERFACE:-en1}"
ETHERNET_IP="$(interface_ip "$ETHERNET_INTERFACE" || true)"
VPN_IP=""
if command -v tailscale >/dev/null 2>&1; then
  VPN_IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"
fi
if [[ -z "$VPN_IP" ]]; then
  VPN_IP="$(ifconfig 2>/dev/null | awk '/^utun[0-9]+:/{iface=$1; sub(":","",iface)} iface && /inet /{print $2; exit}' || true)"
fi
case "$MODE" in
  local|localhost|loopback|lo0)
    WEB_BIND_IP="127.0.0.1"
    DEFAULT_ORIGIN="http://127.0.0.1:$PORT"
    ;;
  lan|wifi)
    [[ -n "$LAN_IP" ]] || { echo "No IPv4 address found on Wi-Fi interface $LAN_INTERFACE." >&2; exit 1; }
    WEB_BIND_IP="$LAN_IP"
    DEFAULT_ORIGIN="http://$LAN_IP:$PORT"
    ;;
  ethernet|eth)
    [[ -n "$ETHERNET_IP" ]] || { echo "No IPv4 address found on Ethernet interface $ETHERNET_INTERFACE." >&2; exit 1; }
    WEB_BIND_IP="$ETHERNET_IP"
    DEFAULT_ORIGIN="http://$ETHERNET_IP:$PORT"
    ;;
  vpn)
    [[ -n "$VPN_IP" ]] || { echo 'VPN mode requested, but no Tailscale or utun VPN address was detected.' >&2; exit 1; }
    WEB_BIND_IP="$VPN_IP"
    DEFAULT_ORIGIN="http://$VPN_IP:$PORT"
    ;;
  public)
    WEB_BIND_IP="127.0.0.1"
    DEFAULT_ORIGIN="${SWARTZIT_ORIGIN:-${ORIGIN:-}}"
    [[ -n "$DEFAULT_ORIGIN" ]] || { echo 'Public mode requires SWARTZIT_ORIGIN=https://your-domain.' >&2; exit 1; }
    SWARTZIT_DOMAIN="${SWARTZIT_DOMAIN:-${DEFAULT_ORIGIN#*://}}"
    SWARTZIT_DOMAIN="${SWARTZIT_DOMAIN%%/*}"
    SWARTZIT_CADDY="${SWARTZIT_CADDY:-1}"
    ;;
  en[0-9]|en[0-9][0-9]|utun[0-9]|bridge[0-9])
    WEB_BIND_IP="$(interface_ip "$MODE" || true)"
    [[ -n "$WEB_BIND_IP" ]] || { echo "No IPv4 address found on interface $MODE." >&2; exit 1; }
    DEFAULT_ORIGIN="http://$WEB_BIND_IP:$PORT"
    ;;
  *)
    echo "Usage: $0 [local|lan|wifi|ethernet|vpn|public|en0|en1]" >&2
    exit 2
    ;;
esac
export DATABASE_URL="${DATABASE_URL:-postgres://swartzit:swartzit-local-only@127.0.0.1:54329/swartzit}"
API_PORT="${API_PORT:-18080}"
API_BIND_INTERFACE="${SWARTZIT_API_INTERFACE:-loopback}"
API_BIND_IP="$(interface_ip "$API_BIND_INTERFACE" || true)"
[[ -n "$API_BIND_IP" ]] || { echo "No IPv4 address found on API interface $API_BIND_INTERFACE." >&2; exit 1; }
export BIND_ADDR="${BIND_ADDR:-$API_BIND_IP:$API_PORT}"
export API_URL="${API_URL:-http://$API_BIND_IP:$API_PORT}"
export HOST="${HOST:-$WEB_BIND_IP}"
export PORT
export ORIGIN="${ORIGIN:-${SWARTZIT_ORIGIN:-$DEFAULT_ORIGIN}}"
cat > .local/runtime.env <<EOF
API_URL=$API_URL
SWARTZIT_LOCAL_URL=http://$WEB_BIND_IP:$PORT
SWARTZIT_CHECK_URL=${SWARTZIT_CHECK_URL:-${SWARTZIT_ORIGIN:-}}
SWARTZIT_CADDY=${SWARTZIT_CADDY:-0}
EOF
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
web_ok() { curl -fsS --max-time 2 "http://$WEB_BIND_IP:$PORT/" >/dev/null 2>&1; }
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
echo "Swartzit ready ($MODE): $ORIGIN"
echo "Web bind: $WEB_BIND_IP:$PORT"
echo "API bind: $BIND_ADDR"
[[ -n "$LAN_IP" ]] && echo "LAN: http://$LAN_IP:$PORT"
[[ -n "$VPN_IP" ]] && echo "VPN: http://$VPN_IP:$PORT"
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
