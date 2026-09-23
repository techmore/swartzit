#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
url="${SWARTZIT_CHECK_URL:-https://stoverparc.org/}"
interval="${SWARTZIT_CHECK_INTERVAL:-300}"
timeout="${SWARTZIT_CHECK_TIMEOUT:-10}"
once=0
[[ "${1:-}" == "--once" ]] && once=1
if [[ "$url" != http://* && "$url" != https://* ]]; then echo "SWARTZIT_CHECK_URL must start with http:// or https://" >&2; exit 2; fi
if ! [[ "$interval" =~ ^[1-9][0-9]*$ && "$timeout" =~ ^[1-9][0-9]*$ ]]; then echo 'SWARTZIT_CHECK_INTERVAL and SWARTZIT_CHECK_TIMEOUT must be positive integers.' >&2; exit 2; fi
probe() {
  local started status elapsed
  started=$(date +%s)
  if status=$(curl -LfsS --max-time "$timeout" -o /dev/null -w '%{http_code}' "$url" 2>/dev/null); then
    elapsed=$(( $(date +%s) - started ))
    printf '%s up url=%s http=%s seconds=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$url" "$status" "$elapsed"
    return 0
  fi
  printf '%s down url=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$url" >&2
  return 1
}
if (( once )); then probe; exit $?; fi
while true; do probe || true; sleep "$interval"; done
