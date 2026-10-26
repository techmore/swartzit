#!/usr/bin/env bash
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'Install on the Linux host.' >&2; exit 1; }
handle=${1:?Usage: install-bookmark-organizer.sh HANDLE}
[[ $handle =~ ^[A-Za-z0-9_]{1,40}$ ]] || { echo 'Invalid handle.' >&2; exit 1; }
umask 077
root=${SWARTZIT_BOOKMARK_ORGANIZER_DIR:-"$HOME/.local/share/swartzit-bookmark-organizer"}
unit_dir="$HOME/.config/systemd/user"
script_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$root" "$unit_dir"
python3 -c 'from PIL import Image'
install -m 700 "$script_dir/bookmark-organizer.py" "$root/worker.py"
cat > "$unit_dir/swartzit-bookmark-organizer.service" <<EOF
[Unit]
Description=Organize private Swartzit bookmarks with local Qwen
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 "$root/worker.py" --handle "$handle" --state-dir "$root" --limit 20
TimeoutStartSec=900
UMask=0077
Nice=10
NoNewPrivileges=true
EOF
cat > "$unit_dir/swartzit-bookmark-organizer.timer" <<'EOF'
[Unit]
Description=Continue organizing Swartzit bookmarks
[Timer]
OnBootSec=2min
OnUnitInactiveSec=30sec
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now swartzit-bookmark-organizer.timer
printf 'Bookmark organizer enabled for %s.\n' "$handle"
