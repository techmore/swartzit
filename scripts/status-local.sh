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
web_port="${PORT:-4173}"
public_url="${SWARTZIT_CHECK_URL:-${SWARTZIT_ORIGIN:-}}"
db_container="${SWARTZIT_DB_CONTAINER:-swartzit-db}"
db_user="${SWARTZIT_DB_USER:-swartzit}"
json=0
[[ "${1:-}" == "--json" ]] && json=1
check_http() { curl -fsS --max-time "${SWARTZIT_CHECK_TIMEOUT:-5}" -o /dev/null "$1" >/dev/null 2>&1; }
api_status=down; web_status=down; database_status=down; caddy_status=not-configured; worker_status=not-configured; public_status=not-configured
api_health_json='{}'
if api_health_json=$(curl -fsS --max-time "${SWARTZIT_CHECK_TIMEOUT:-5}" "$api/health" 2>/dev/null); then
  api_status=ready
else
  api_health_json='{}'
fi
check_http "$web_url/" && web_status=ready || true
if command -v container >/dev/null 2>&1 && container exec "$db_container" pg_isready -U "$db_user" >/dev/null 2>&1; then database_status=ready; fi
if [[ -f "$STATE_DIR/caddy.pid" ]] && kill -0 "$(cat "$STATE_DIR/caddy.pid")" 2>/dev/null; then caddy_status=running; elif [[ "${SWARTZIT_CADDY:-0}" == 1 ]]; then caddy_status=down; fi
if [[ -f "$STATE_DIR/worker.pid" ]] && kill -0 "$(cat "$STATE_DIR/worker.pid")" 2>/dev/null; then worker_status=running; elif [[ -f "$STATE_DIR/worker.last-run" ]]; then worker_status=last-run; fi
if [[ -n "$public_url" ]]; then check_http "$public_url" && public_status=ready || public_status=down; fi
pulse_file="${SWARTZIT_PULSE_FILE:-$STATE_DIR/uptime-pulse.json}"
pulse_json='{}'
[[ -f "$pulse_file" ]] && pulse_json=$(<"$pulse_file")
pulse_json=$(node -e 'try {
  const pulse = JSON.parse(process.argv[1]);
  const checked = Date.parse(pulse.checked_at || "");
  const age = Number.isFinite(checked) ? Math.max(0, Math.floor((Date.now() - checked) / 1000)) : null;
  pulse.age_seconds = age;
  const interval = Number(pulse.interval_seconds);
  if (pulse.status === "up" && age !== null && Number.isFinite(interval) && age > Math.max(60, interval * 3)) pulse.status = "stale";
  console.log(JSON.stringify(pulse));
} catch { console.log("{}"); }' "$pulse_json" 2>/dev/null || printf '{}')
pulse_status=$(node -e 'try { console.log(JSON.parse(process.argv[1]).status ?? "unknown") } catch { console.log("unknown") }' "$pulse_json" 2>/dev/null || echo unknown)
api_started_at="${SWARTZIT_STARTED_AT:-}"
api_uptime_seconds=''
if [[ "$api_status" == ready ]]; then
  api_started_at=$(node -e 'try { console.log(JSON.parse(process.argv[1]).started_at ?? "") } catch {}' "$api_health_json" 2>/dev/null || true)
  api_uptime_seconds=$(node -e 'try {
    const value = JSON.parse(process.argv[1]).uptime_seconds;
    if (Number.isSafeInteger(value) && value >= 0) console.log(value);
  } catch {}' "$api_health_json" 2>/dev/null || true)
fi
format_duration() {
  local total="${1:-}"
  [[ "$total" =~ ^[0-9]+$ ]] || { printf 'unknown'; return; }
  local days=$((total / 86400))
  local hours=$(((total % 86400) / 3600))
  local minutes=$(((total % 3600) / 60))
  local seconds=$((total % 60))
  local result=''
  (( days > 0 )) && result+="${days}d "
  (( hours > 0 || days > 0 )) && result+="${hours}h "
  (( minutes > 0 || hours > 0 || days > 0 )) && result+="${minutes}m "
  result+="${seconds}s"
  printf '%s' "$result"
}
api_uptime_display=$(format_duration "$api_uptime_seconds")
local_status=down
if [[ "$api_status" == ready && "$web_status" == ready && "$database_status" == ready ]]; then
  local_status=up
fi
network_mode="${SWARTZIT_NETWORK_MODE:-${SWARTZIT_BIND_INTERFACE:-}}"
network_label="${SWARTZIT_NETWORK_LABEL:-}"
web_interface="${SWARTZIT_WEB_INTERFACE:-}"
web_bind_ip="${SWARTZIT_WEB_BIND_IP:-}"
api_interface="${SWARTZIT_API_BIND_INTERFACE:-${SWARTZIT_API_INTERFACE:-loopback}}"
api_bind_ip="${SWARTZIT_API_BIND_IP:-}"
if [[ -z "$network_mode" ]]; then
  if [[ "$web_url" == *127.0.0.1* || "$web_url" == *localhost* ]]; then
    network_mode=loopback
    network_label="Loopback"
    web_interface=lo0
    web_bind_ip=127.0.0.1
  else
    network_mode=unknown
    network_label="Unknown"
  fi
fi
[[ -n "$network_label" ]] || network_label="$network_mode"
[[ -n "$web_interface" ]] || web_interface=unknown
[[ -n "$web_bind_ip" ]] || web_bind_ip=unknown
[[ -n "$api_bind_ip" ]] || api_bind_ip=unknown
if (( json )); then
  node -e 'let pulse={}; try { pulse=JSON.parse(process.argv[14]) } catch {} const uptimeSeconds=/^\d+$/.test(process.argv[17] ?? "") ? Number(process.argv[17]) : null; console.log(JSON.stringify({status:process.argv[15],api:process.argv[1],web:process.argv[2],database:process.argv[3],caddy:process.argv[4],worker:process.argv[5],public:process.argv[6],network:{mode:process.argv[7],label:process.argv[8],web_interface:process.argv[9],web_bind_ip:process.argv[10],web_url:process.argv[11],api_interface:process.argv[12],api_bind_ip:process.argv[13]},uptime:{status:process.argv[15],started_at:process.argv[16] || null,seconds:uptimeSeconds,duration:process.argv[18] || "unknown"},pulse,checked_at:new Date().toISOString()}))' "$api_status" "$web_status" "$database_status" "$caddy_status" "$worker_status" "$public_status" "$network_mode" "$network_label" "$web_interface" "$web_bind_ip" "$web_url" "$api_interface" "$api_bind_ip" "$pulse_json" "$local_status" "$api_started_at" "$api_uptime_seconds" "$api_uptime_display"
else
  printf 'Swartzit status (%s)\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
  printf '  Status:    %s\n' "$local_status"
  printf '  API:       %s (%s)\n' "$api_status" "$api"
  printf '  Web:       %s (%s)\n' "$web_status" "$web_url"
  printf '  Database:  %s\n' "$database_status"
  printf '  Caddy:     %s\n' "$caddy_status"
  printf '  Worker:    %s\n' "$worker_status"
  [[ "$public_status" == not-configured ]] || printf '  Public:    %s (%s)\n' "$public_status" "$public_url"
  printf '  Network:   %s (%s)\n' "$network_label" "$network_mode"
  printf '  Web bind:  %s (%s)\n' "$web_bind_ip:$web_port" "$web_interface"
  printf '  API bind:  %s (%s)\n' "$api_bind_ip" "$api_interface"
  printf '  Uptime:    %s (started %s)\n' "$api_uptime_display" "${api_started_at:-unknown}"
  printf '  Pulse:     %s (%s)\n' "$pulse_status" "$pulse_file"
fi
healthy=0
[[ "$api_status" == ready && "$web_status" == ready && "$database_status" == ready ]] || healthy=1
[[ "$public_status" == not-configured || "$public_status" == ready ]] || healthy=1
[[ "$pulse_status" == unknown || "$pulse_status" == up ]] || healthy=1
exit "$healthy"
