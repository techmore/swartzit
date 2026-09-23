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
mkdir -p "$STATE_DIR" "$HOME/Library/LaunchAgents"

CADDY_SCRIPT="${SWARTZIT_CADDY_SCRIPT:-$SCRIPT_DIR/swartzit-caddy.sh}"
CADDY_BIN="${SWARTZIT_CADDY_BIN:-$(command -v caddy 2>/dev/null || true)}"
PLIST="$HOME/Library/LaunchAgents/org.stoverparc.swartzit-caddy.plist"
LABEL="org.stoverparc.swartzit-caddy"
[[ -x "$CADDY_SCRIPT" ]] || { echo "Missing Caddy launcher: $CADDY_SCRIPT" >&2; exit 1; }
[[ -x "$CADDY_BIN" ]] || { echo "Caddy is not installed or not executable: ${CADDY_BIN:-not found}" >&2; exit 1; }

launch_path="${SWARTZIT_LAUNCH_PATH:-${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}}"
caddy_prefix=$(dirname "$CADDY_BIN")
if [[ ":$launch_path:" != *":$caddy_prefix:"* ]]; then
  launch_path="$caddy_prefix:$launch_path"
fi

xml_escape() {
  printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

script_xml=$(xml_escape "$CADDY_SCRIPT")
state_xml=$(xml_escape "$STATE_DIR")
path_xml=$(xml_escape "$launch_path")
log_xml=$(xml_escape "$STATE_DIR/caddy.log")
caddy_bin_xml=$(xml_escape "$CADDY_BIN")

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$script_xml</string><string>foreground</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$path_xml</string>
    <key>SWARTZIT_STATE_DIR</key><string>$state_xml</string>
    <key>SWARTZIT_CADDY_BIN</key><string>$caddy_bin_xml</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$log_xml</string>
  <key>StandardErrorPath</key><string>$log_xml</string>
</dict></plist>
EOF

launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
sleep 1
SWARTZIT_STATE_DIR="$STATE_DIR" "$CADDY_SCRIPT" stop >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "Swartzit Caddy LaunchAgent installed and started: $PLIST"
