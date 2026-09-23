#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
LABEL="${SWARTZIT_LAUNCHD_LABEL:-org.stoverparc.swartzit-monitor}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
plist_value() {
  local key="$1"
  [[ -f "$PLIST" && -x /usr/libexec/PlistBuddy ]] || return 0
  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$key" "$PLIST" 2>/dev/null || true
}
INTERVAL="${SWARTZIT_CHECK_INTERVAL:-}"
[[ -n "$INTERVAL" ]] || INTERVAL="$(plist_value SWARTZIT_CHECK_INTERVAL)"
INTERVAL="${INTERVAL:-300}"
URL="${SWARTZIT_CHECK_URL:-}"
[[ -n "$URL" ]] || URL="$(plist_value SWARTZIT_CHECK_URL)"
URL="${URL:-https://stoverparc.org/}"
TIMEOUT="${SWARTZIT_CHECK_TIMEOUT:-}"
[[ -n "$TIMEOUT" ]] || TIMEOUT="$(plist_value SWARTZIT_CHECK_TIMEOUT)"
TIMEOUT="${TIMEOUT:-10}"
STATE_DIR="${SWARTZIT_STATE_DIR:-}"
[[ -n "$STATE_DIR" ]] || STATE_DIR="$(plist_value SWARTZIT_STATE_DIR)"
STATE_DIR="${STATE_DIR:-${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}}"
PULSE_FILE="${SWARTZIT_PULSE_FILE:-}"
[[ -n "$PULSE_FILE" ]] || PULSE_FILE="$(plist_value SWARTZIT_PULSE_FILE)"
PULSE_FILE="${PULSE_FILE:-$STATE_DIR/uptime-pulse.json}"
BREW_PREFIX="$(brew --prefix 2>/dev/null || true)"
LAUNCH_PATH="${PATH:-/usr/bin:/bin}"
[[ -n "$BREW_PREFIX" ]] && LAUNCH_PATH="$BREW_PREFIX/bin:$LAUNCH_PATH"
[[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_CHECK_INTERVAL must be a positive integer.' >&2; exit 2; }
[[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_CHECK_TIMEOUT must be a positive integer.' >&2; exit 2; }
[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'SWARTZIT_LAUNCHD_LABEL contains unsupported characters.' >&2; exit 2; }
xml_escape() { printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"; }
SCRIPT_DIR_XML=$(xml_escape "$SCRIPT_DIR")
URL_XML=$(xml_escape "$URL")
STATE_DIR_XML=$(xml_escape "$STATE_DIR")
PULSE_FILE_XML=$(xml_escape "$PULSE_FILE")
LAUNCH_PATH_XML=$(xml_escape "$LAUNCH_PATH")
mkdir -p "$HOME/Library/LaunchAgents" "$STATE_DIR"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$SCRIPT_DIR_XML/swartzit-monitor.sh</string></array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>$LAUNCH_PATH_XML</string><key>SWARTZIT_CHECK_URL</key><string>$URL_XML</string><key>SWARTZIT_CHECK_INTERVAL</key><string>$INTERVAL</string><key>SWARTZIT_CHECK_TIMEOUT</key><string>$TIMEOUT</string><key>SWARTZIT_STATE_DIR</key><string>$STATE_DIR_XML</string><key>SWARTZIT_PULSE_FILE</key><string>$PULSE_FILE_XML</string></dict>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>$STATE_DIR_XML/monitor.log</string>
<key>StandardErrorPath</key><string>$STATE_DIR_XML/monitor-error.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL; checking $URL every ${INTERVAL}s"
echo "Pulse: $PULSE_FILE"
echo "Logs: $STATE_DIR/monitor.log"
