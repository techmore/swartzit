#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LABEL="${SWARTZIT_LAUNCHD_LABEL:-org.stoverparc.swartzit-monitor}"
INTERVAL="${SWARTZIT_CHECK_INTERVAL:-300}"
URL="${SWARTZIT_CHECK_URL:-https://stoverparc.org/}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
[[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_CHECK_INTERVAL must be a positive integer.' >&2; exit 2; }
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.local"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/scripts/swartzit-monitor.sh</string></array>
<key>EnvironmentVariables</key><dict><key>SWARTZIT_CHECK_URL</key><string>$URL</string><key>SWARTZIT_CHECK_INTERVAL</key><string>$INTERVAL</string><key>SWARTZIT_CHECK_TIMEOUT</key><string>${SWARTZIT_CHECK_TIMEOUT:-10}</string></dict>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>$ROOT/.local/monitor.log</string>
<key>StandardErrorPath</key><string>$ROOT/.local/monitor-error.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL; checking $URL every ${INTERVAL}s"
echo "Logs: $ROOT/.local/monitor.log"
