#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$0"
while [[ -L "$SCRIPT_PATH" ]]; do
  SCRIPT_LINK_DIR=$(cd "$(dirname "$SCRIPT_PATH")" && pwd)
  SCRIPT_LINK=$(readlink "$SCRIPT_PATH")
  if [[ "$SCRIPT_LINK" == /* ]]; then
    SCRIPT_PATH="$SCRIPT_LINK"
  else
    SCRIPT_PATH="$SCRIPT_LINK_DIR/$SCRIPT_LINK"
  fi
done
SCRIPT_DIR=$(cd "$(dirname "$SCRIPT_PATH")" && pwd)
WORKER_LAUNCHER="$SCRIPT_DIR/run-worker.sh"
[[ -x "$WORKER_LAUNCHER" ]] || { echo "Missing worker launcher: $WORKER_LAUNCHER" >&2; exit 1; }

LABEL="${SWARTZIT_WORKER_LAUNCHD_LABEL:-org.stoverparc.swartzit-worker}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
plist_value() {
  local key="$1"
  [[ -f "$PLIST" && -x /usr/libexec/PlistBuddy ]] || return 0
  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$key" "$PLIST" 2>/dev/null || true
}

STATE_DIR="${SWARTZIT_WORKER_STATE_DIR:-${SWARTZIT_STATE_DIR:-}}"
[[ -n "$STATE_DIR" ]] || STATE_DIR="$(plist_value SWARTZIT_WORKER_STATE_DIR)"
STATE_DIR="${STATE_DIR:-${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}}"
ENV_FILE="${SWARTZIT_WORKER_ENV_FILE:-}"
[[ -n "$ENV_FILE" ]] || ENV_FILE="$(plist_value SWARTZIT_WORKER_ENV_FILE)"
ENV_FILE="${ENV_FILE:-$STATE_DIR/worker.env}"
INTERVAL="${SWARTZIT_WORKER_INTERVAL:-}"
[[ -n "$INTERVAL" ]] || INTERVAL="$(plist_value SWARTZIT_WORKER_INTERVAL)"
INTERVAL="${INTERVAL:-60}"
WORKER_ROOT="${SWARTZIT_WORKER_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

[[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_WORKER_INTERVAL must be a positive integer.' >&2; exit 2; }
[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'SWARTZIT_WORKER_LAUNCHD_LABEL contains unsupported characters.' >&2; exit 2; }

mkdir -p "$HOME/Library/LaunchAgents" "$STATE_DIR" "$(dirname "$ENV_FILE")"
if [[ ! -f "$ENV_FILE" ]]; then
  [[ -n "${SCHEDULER_HANDLE:-}" && -n "${SCHEDULER_PASSWORD:-}" ]] || {
    cat >&2 <<EOF
Missing $ENV_FILE. Create a mode-600 worker environment file with:
  API_URL=http://127.0.0.1:18080
  SCHEDULER_HANDLE=...
  SCHEDULER_PASSWORD=...
  X_BEARER_TOKEN=...       # optional

Then rerun: $0
EOF
    exit 1
  }
  umask 077
  {
    printf 'API_URL=%q\n' "${API_URL:-http://127.0.0.1:18080}"
    printf 'SCHEDULER_HANDLE=%q\n' "$SCHEDULER_HANDLE"
    printf 'SCHEDULER_PASSWORD=%q\n' "$SCHEDULER_PASSWORD"
    printf 'X_BEARER_TOKEN=%q\n' "${X_BEARER_TOKEN:-}"
  } > "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

BREW_PREFIX="$(brew --prefix 2>/dev/null || true)"
LAUNCH_PATH="${SWARTZIT_LAUNCH_PATH:-${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}}"
if [[ -n "$BREW_PREFIX" && ":$LAUNCH_PATH:" != *":$BREW_PREFIX/bin:"* ]]; then
  LAUNCH_PATH="$BREW_PREFIX/bin:$LAUNCH_PATH"
fi

xml_escape() {
  printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}
WORKER_LAUNCHER_XML=$(xml_escape "$WORKER_LAUNCHER")
ENV_FILE_XML=$(xml_escape "$ENV_FILE")
STATE_DIR_XML=$(xml_escape "$STATE_DIR")
WORKER_ROOT_XML=$(xml_escape "$WORKER_ROOT")
LAUNCH_PATH_XML=$(xml_escape "$LAUNCH_PATH")

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$WORKER_LAUNCHER_XML</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>$LAUNCH_PATH_XML</string>
<key>SWARTZIT_WORKER_ENV_FILE</key><string>$ENV_FILE_XML</string>
<key>SWARTZIT_WORKER_STATE_DIR</key><string>$STATE_DIR_XML</string>
<key>SWARTZIT_WORKER_ROOT</key><string>$WORKER_ROOT_XML</string>
</dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>$INTERVAL</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$STATE_DIR_XML/worker.log</string>
<key>StandardErrorPath</key><string>$STATE_DIR_XML/worker-error.log</string>
</dict></plist>
EOF
chmod 600 "$PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL; the shared Node worker runs every ${INTERVAL}s."
echo "Worker environment: $ENV_FILE"
echo "Logs: $STATE_DIR/worker.log"

