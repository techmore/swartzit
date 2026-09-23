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
mkdir -p "$STATE_DIR"

if [[ -f "$STATE_DIR/runtime.env" ]]; then
  set -a
  source "$STATE_DIR/runtime.env"
  set +a
fi

CADDY_BIN="${SWARTZIT_CADDY_BIN:-$(command -v caddy 2>/dev/null || true)}"
CADDY_CONFIG="${SWARTZIT_CADDYFILE:-$STATE_DIR/caddy-runtime.Caddyfile}"
CADDY_PID="${SWARTZIT_CADDY_PID:-$STATE_DIR/caddy.pid}"
CADDY_LOG="${SWARTZIT_CADDY_LOG:-$STATE_DIR/caddy.log}"
CADDY_DOMAIN="${SWARTZIT_DOMAIN:-stoverparc.org}"
CADDY_BIND_IP="${SWARTZIT_CADDY_BIND_IP:-0.0.0.0}"
CADDY_UPSTREAM="${SWARTZIT_CADDY_UPSTREAM:-${SWARTZIT_WEB_BIND_IP:-127.0.0.1}:${PORT:-4173}}"

agent_label="org.stoverparc.swartzit-caddy"
agent_target="gui/$(id -u)/$agent_label"

agent_loaded() {
  launchctl print "$agent_target" >/dev/null 2>&1
}

pid_alive() {
  [[ -f "$CADDY_PID" ]] || return 1
  local pid
  pid=$(<"$CADDY_PID")
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

write_config() {
  [[ -n "$CADDY_DOMAIN" ]] || { echo 'SWARTZIT_DOMAIN must not be empty.' >&2; return 2; }
  [[ -n "$CADDY_BIND_IP" ]] || { echo 'SWARTZIT_CADDY_BIND_IP must not be empty.' >&2; return 2; }
  [[ -n "$CADDY_UPSTREAM" ]] || { echo 'SWARTZIT_CADDY_UPSTREAM must not be empty.' >&2; return 2; }
  cat > "$CADDY_CONFIG" <<EOF
{
    admin off
}

$CADDY_DOMAIN {
    bind $CADDY_BIND_IP
    encode zstd gzip
    reverse_proxy $CADDY_UPSTREAM
}
EOF
}

validate() {
  [[ -x "$CADDY_BIN" ]] || { echo "Caddy is not installed or not executable: ${CADDY_BIN:-not found}" >&2; return 1; }
  write_config
  "$CADDY_BIN" validate --config "$CADDY_CONFIG" --adapter caddyfile
}

stop_direct() {
  if pid_alive; then
    local pid
    pid=$(<"$CADDY_PID")
    kill "$pid" 2>/dev/null || true
    for _ in {1..30}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
  fi
  rm -f "$CADDY_PID"
}

start_direct() {
  validate >/dev/null
  if pid_alive; then
    echo "Caddy already running: $CADDY_DOMAIN on $CADDY_BIND_IP:443 -> $CADDY_UPSTREAM"
    return 0
  fi
  nohup "$CADDY_BIN" run --config "$CADDY_CONFIG" --adapter caddyfile >"$CADDY_LOG" 2>&1 < /dev/null &
  echo $! > "$CADDY_PID"
  echo "Caddy started: https://$CADDY_DOMAIN on $CADDY_BIND_IP:443 -> $CADDY_UPSTREAM"
}

case "${1:-status}" in
  write-config)
    write_config
    ;;
  validate)
    validate
    ;;
  foreground)
    validate >/dev/null
    exec "$CADDY_BIN" run --config "$CADDY_CONFIG" --adapter caddyfile
    ;;
  start)
    if agent_loaded; then
      launchctl kickstart -k "$agent_target"
      echo "Caddy LaunchAgent restarted: https://$CADDY_DOMAIN on $CADDY_BIND_IP:443 -> $CADDY_UPSTREAM"
    else
      start_direct
    fi
    ;;
  stop)
    if agent_loaded; then
      echo "Caddy is managed by $agent_label; use launchctl bootout to disable it." >&2
      exit 2
    fi
    stop_direct
    echo 'Caddy stopped.'
    ;;
  restart|refresh)
    write_config
    validate >/dev/null
    if agent_loaded; then
      launchctl kickstart -k "$agent_target"
      echo "Caddy refreshed: https://$CADDY_DOMAIN on $CADDY_BIND_IP:443 -> $CADDY_UPSTREAM"
    else
      stop_direct
      start_direct
    fi
    ;;
  status)
    if agent_loaded; then
      echo "Caddy LaunchAgent: running"
    elif pid_alive; then
      echo "Caddy: running (pid $(<"$CADDY_PID"))"
    else
      echo 'Caddy: stopped'
      exit 1
    fi
    echo "Config: $CADDY_CONFIG"
    echo "HTTPS: https://$CADDY_DOMAIN on $CADDY_BIND_IP:443 -> $CADDY_UPSTREAM"
    ;;
  *)
    echo 'Usage: swartzit-caddy.sh {write-config|validate|foreground|start|stop|restart|refresh|status}' >&2
    exit 2
    ;;
esac
