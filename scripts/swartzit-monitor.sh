#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
if [[ -n "${SWARTZIT_STATE_DIR:-}" ]]; then
  STATE_DIR="$SWARTZIT_STATE_DIR"
elif [[ -d "$ROOT/.git" || -d "$ROOT/.local" ]]; then
  STATE_DIR="$ROOT/.local"
else
  STATE_DIR="${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}"
fi
PULSE_FILE="${SWARTZIT_PULSE_FILE:-$STATE_DIR/uptime-pulse.json}"
NODE_BIN="${SWARTZIT_NODE:-$(command -v node 2>/dev/null || true)}"
if [[ -z "$NODE_BIN" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    [[ -x "$candidate" ]] && NODE_BIN="$candidate" && break
  done
fi
url="${SWARTZIT_CHECK_URL:-https://stoverparc.org/}"
interval="${SWARTZIT_CHECK_INTERVAL:-300}"
timeout="${SWARTZIT_CHECK_TIMEOUT:-10}"
once=0
[[ "${1:-}" == "--once" ]] && once=1
if [[ "$url" != http://* && "$url" != https://* ]]; then echo "SWARTZIT_CHECK_URL must start with http:// or https://" >&2; exit 2; fi
if ! [[ "$interval" =~ ^[1-9][0-9]*$ && "$timeout" =~ ^[1-9][0-9]*$ ]]; then echo 'SWARTZIT_CHECK_INTERVAL and SWARTZIT_CHECK_TIMEOUT must be positive integers.' >&2; exit 2; fi
record_pulse() {
  local status="$1"
  shift
  if [[ -z "$NODE_BIN" ]] || ! "$NODE_BIN" "$SCRIPT_DIR/record-uptime-pulse.mjs" --file "$PULSE_FILE" --url "$url" --status "$status" "$@" >/dev/null 2>&1; then
    echo "Could not write uptime pulse: $PULSE_FILE" >&2
  fi
}
probe() {
  local response http_status seconds latency_ms
  if response=$(curl -LsS --max-time "$timeout" -o /dev/null -w '%{http_code}\t%{time_total}' "$url" 2>/dev/null); then
    IFS=$'\t' read -r http_status seconds <<< "$response"
    http_status="${http_status:-0}"
    seconds="${seconds:-0}"
    latency_ms=$(awk -v value="$seconds" 'BEGIN { printf "%.0f", value * 1000 }')
    if [[ "$http_status" =~ ^[23][0-9][0-9]$ ]]; then
      record_pulse up --http-status "$http_status" --latency-ms "$latency_ms" --interval-seconds "$interval"
      printf '%s up url=%s http=%s latency_ms=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$url" "$http_status" "$latency_ms"
      return 0
    fi
    record_pulse down --http-status "$http_status" --latency-ms "$latency_ms" --interval-seconds "$interval" --error "HTTP $http_status"
    printf '%s down url=%s http=%s latency_ms=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$url" "$http_status" "$latency_ms" >&2
    return 1
  else
    record_pulse down --http-status 0 --interval-seconds "$interval" --error 'request failed or timed out'
    printf '%s down url=%s error=request-failed\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$url" >&2
    return 1
  fi
}
if (( once )); then probe; exit $?; fi
while true; do probe || true; sleep "$interval"; done
