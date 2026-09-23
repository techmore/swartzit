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
BACKUP_SCRIPT="$SCRIPT_DIR/db-backup.sh"
[[ -x "$BACKUP_SCRIPT" ]] || { echo "Missing backup script: $BACKUP_SCRIPT" >&2; exit 1; }

LABEL="${SWARTZIT_BACKUP_LAUNCHD_LABEL:-org.stoverparc.swartzit-backup}"
INTERVAL="${SWARTZIT_BACKUP_INTERVAL:-21600}"
RETENTION="${SWARTZIT_BACKUP_RETENTION:-7}"
STATE_DIR="${SWARTZIT_STATE_DIR:-${SWARTZIT_DATA_DIR:-$HOME/Library/Application Support/Swartzit}}"
BACKUP_DIR="${SWARTZIT_BACKUP_DIR:-$STATE_DIR/backups}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_BACKUP_INTERVAL must be a positive integer.' >&2; exit 2; }
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || { echo 'SWARTZIT_BACKUP_RETENTION must be a positive integer.' >&2; exit 2; }
[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'SWARTZIT_BACKUP_LAUNCHD_LABEL contains unsupported characters.' >&2; exit 2; }

BREW_PREFIX="$(brew --prefix 2>/dev/null || true)"
LAUNCH_PATH="${SWARTZIT_LAUNCH_PATH:-${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}}"
for launch_dir in "${BREW_PREFIX:+$BREW_PREFIX/bin}" "${BREW_PREFIX:+$BREW_PREFIX/sbin}" /usr/local/bin; do
  [[ -n "$launch_dir" ]] || continue
  case ":$LAUNCH_PATH:" in
    *":$launch_dir:"*) ;;
    *) LAUNCH_PATH="$launch_dir:$LAUNCH_PATH" ;;
  esac
done

xml_escape() {
  printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}
BACKUP_SCRIPT_XML=$(xml_escape "$BACKUP_SCRIPT")
BACKUP_DIR_XML=$(xml_escape "$BACKUP_DIR")
STATE_DIR_XML=$(xml_escape "$STATE_DIR")
LAUNCH_PATH_XML=$(xml_escape "$LAUNCH_PATH")
DB_CONTAINER_XML=$(xml_escape "${SWARTZIT_DB_CONTAINER:-swartzit-db}")
DB_USER_XML=$(xml_escape "${SWARTZIT_DB_USER:-swartzit}")
DB_NAME_XML=$(xml_escape "${SWARTZIT_DB_NAME:-swartzit}")

mkdir -p "$HOME/Library/LaunchAgents" "$STATE_DIR" "$BACKUP_DIR"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$BACKUP_SCRIPT_XML</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>$LAUNCH_PATH_XML</string>
<key>SWARTZIT_STATE_DIR</key><string>$STATE_DIR_XML</string>
<key>SWARTZIT_BACKUP_DIR</key><string>$BACKUP_DIR_XML</string>
<key>SWARTZIT_BACKUP_RETENTION</key><string>$RETENTION</string>
<key>SWARTZIT_DB_CONTAINER</key><string>$DB_CONTAINER_XML</string>
<key>SWARTZIT_DB_USER</key><string>$DB_USER_XML</string>
<key>SWARTZIT_DB_NAME</key><string>$DB_NAME_XML</string>
</dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>$INTERVAL</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$STATE_DIR_XML/backup.log</string>
<key>StandardErrorPath</key><string>$STATE_DIR_XML/backup-error.log</string>
</dict></plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL; backup every ${INTERVAL}s; retaining $RETENTION archive(s)."
echo "Backups: $BACKUP_DIR"
echo "Logs: $STATE_DIR/backup.log"
