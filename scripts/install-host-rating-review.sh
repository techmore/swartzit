#!/usr/bin/env bash
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'Install this worker on the Linux host.' >&2; exit 1; }
umask 077
script_dir=$(cd "$(dirname "$0")" && pwd)
review_state=${SWARTZIT_REVIEW_STATE_DIR:-"$HOME/.local/share/swartzit-review"}
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$review_state" "$unit_dir"
[[ -f "$review_state/worker.env" ]] || { echo "Create a private $review_state/worker.env with the existing scheduler credentials first." >&2; exit 1; }
chmod 600 "$review_state/worker.env"
python3 -c 'from PIL import Image'
install -m 700 "$script_dir/rating-review-worker.py" "$review_state/worker.py"
cat > "$unit_dir/swartzit-rating-review.service" <<EOF
[Unit]
Description=Swartzit host-native Qwen rating suggestions
After=network-online.target
[Service]
Type=oneshot
EnvironmentFile=$review_state/worker.env
ExecStart=/usr/bin/python3 "$review_state/worker.py" --state-dir "$review_state" --limit 10
TimeoutStartSec=600
UMask=0077
NoNewPrivileges=true
EOF
cat > "$unit_dir/swartzit-rating-review.timer" <<'EOF'
[Unit]
Description=Collect Swartzit rating suggestions every five minutes
[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now swartzit-rating-review.timer
echo 'Host-native review timer enabled. Suggestions do not change post ratings.'
