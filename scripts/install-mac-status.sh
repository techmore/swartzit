#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
INSTALL_DIR="${SWARTZIT_STATUS_DIR:-$HOME/Library/Application Support/Swartzit}"
PLIST="$HOME/Library/LaunchAgents/org.stoverparc.swartzit-status.plist"
mkdir -p "$INSTALL_DIR" "$HOME/Library/LaunchAgents"

status_binary="${SWARTZIT_STATUS_BINARY:-}"
command_path="${SWARTZIT_COMMAND:-}"
icon_source="${SWARTZIT_ICON_SOURCE:-}"
if [[ -f "$ROOT/macos/SwartzitStatus.swift" ]]; then
  status_binary="$INSTALL_DIR/SwartzitStatus"
  swiftc -O -o "$status_binary" "$ROOT/macos/SwartzitStatus.swift"
  command_path="${command_path:-$ROOT/scripts/swartzit}"
  icon_source="${icon_source:-$ROOT/apps/web/static/swartzit-icon.png}"
else
  status_binary="${status_binary:-$ROOT/bin/swartzit-status}"
  command_path="${command_path:-$ROOT/bin/swartzit}"
  icon_source="${icon_source:-$SCRIPT_DIR/swartzit-icon.png}"
  [[ -x "$status_binary" ]] || { echo "Missing packaged menu binary: $status_binary" >&2; exit 1; }
fi
[[ -x "$command_path" ]] || { echo "Missing Swartzit launcher: $command_path" >&2; exit 1; }
[[ -f "$icon_source" ]] || { echo "Missing Swartzit icon: $icon_source" >&2; exit 1; }
if [[ "$status_binary" != "$INSTALL_DIR/SwartzitStatus" ]]; then
  install -m 0755 "$status_binary" "$INSTALL_DIR/SwartzitStatus"
fi
install -m 0644 "$icon_source" "$INSTALL_DIR/swartzit-icon.png"
version_file="$ROOT/VERSION"
[[ -f "$version_file" ]] || version_file="$SCRIPT_DIR/VERSION"
status_version='development'
[[ -f "$version_file" ]] && status_version=$(<"$version_file")
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.stoverparc.swartzit-status</string>
  <key>ProgramArguments</key><array><string>$INSTALL_DIR/SwartzitStatus</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>SWARTZIT_COMMAND</key><string>$command_path</string>
    <key>SWARTZIT_OPEN_URL</key><string>${SWARTZIT_OPEN_URL:-http://127.0.0.1:4173}</string>
    <key>SWARTZIT_ICON_PATH</key><string>$INSTALL_DIR/swartzit-icon.png</string>
    <key>SWARTZIT_STATUS_VERSION</key><string>$status_version</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "Swartzit menu-bar status installed and started."
