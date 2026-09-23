#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
INSTALL_DIR="${SWARTZIT_STATUS_DIR:-$HOME/Library/Application Support/Swartzit}"
PLIST="$HOME/Library/LaunchAgents/org.stoverparc.swartzit-status.plist"
mkdir -p "$INSTALL_DIR" "$HOME/Library/LaunchAgents"
swiftc -O -o "$INSTALL_DIR/SwartzitStatus" "$ROOT/macos/SwartzitStatus.swift"
cp "$ROOT/apps/web/static/swartzit-icon.png" "$INSTALL_DIR/swartzit-icon.png"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.stoverparc.swartzit-status</string>
  <key>ProgramArguments</key><array><string>$INSTALL_DIR/SwartzitStatus</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>SWARTZIT_COMMAND</key><string>$ROOT/scripts/swartzit</string>
    <key>SWARTZIT_OPEN_URL</key><string>${SWARTZIT_OPEN_URL:-http://127.0.0.1:4173}</string>
    <key>SWARTZIT_ICON_PATH</key><string>$INSTALL_DIR/swartzit-icon.png</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "Swartzit menu-bar status installed and started."
