#!/usr/bin/env bash
set -euo pipefail
handle=${1:?Usage: install-bookmark-image-benchmark.sh HANDLE RUN_ID}
run=${2:?Usage: install-bookmark-image-benchmark.sh HANDLE RUN_ID}
[[ $handle =~ ^[A-Za-z0-9_]{1,40}$ && $run =~ ^[0-9]+$ ]] || { echo 'Invalid handle or run ID.' >&2; exit 1; }
root="$HOME/.local/share/swartzit-mobilenet-trial"
units="$HOME/.config/systemd/user"
[[ -x "$root/venv/bin/python" && -f "$root/benchmark.py" ]] || { echo 'Benchmark runtime not installed.' >&2; exit 1; }
umask 077
mkdir -p "$units"
cat > "$units/swartzit-image-benchmark-$run.service" <<EOF
[Unit]
Description=Swartzit image benchmark run $run
After=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=3
[Service]
Type=exec
ExecStart=$root/venv/bin/python $root/benchmark.py --handle $handle --resume $run
Restart=on-failure
RestartSec=60
UMask=0077
Nice=10
NoNewPrivileges=true
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now "swartzit-image-benchmark-$run.service"
