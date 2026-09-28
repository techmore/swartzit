#!/usr/bin/env bash
set -Eeuo pipefail

MODE=${1:-}
REMOTE=${2:-}
APP_DIR=${SWARTZIT_APP_DIR:-/var/lib/swartzit}
RUN_USER=${SWARTZIT_RUN_USER:-swartzit}
STATE_DIR=${SWARTZIT_GITHUB_BACKUP_STATE_DIR:-/var/lib/swartzit-github-backup}
SSH_DIR="$STATE_DIR/ssh"
SSH_KEY="$SSH_DIR/github-deploy-key"
PUBLIC_KEY="$SSH_KEY.pub"
KNOWN_HOSTS="$SSH_DIR/known_hosts"
CONFIG_FILE=${SWARTZIT_GITHUB_BACKUP_ENV_FILE:-/etc/swartzit/github-backup.env}

die() {
  echo "GitHub database backup setup: $*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || die 'run this setup through the production updater.'
[[ "$MODE" == prepare || "$MODE" == enable ]] || die 'expected prepare or enable mode.'
[[ -n "$REMOTE" ]] || die 'the private backup repository SSH URL is required.'
[[ "$REMOTE" != *$'\n'* && "$REMOTE" != *$'\r'* && "$REMOTE" != *[[:space:]]* ]] || die 'the repository URL contains whitespace.'
case "$REMOTE" in
  git@github.com:*)
    REPOSITORY=${REMOTE#git@github.com:}
    ;;
  ssh://git@github.com/*)
    REPOSITORY=${REMOTE#ssh://git@github.com/}
    ;;
  *)
    die 'use a GitHub SSH URL such as git@github.com:OWNER/REPOSITORY.git.'
    ;;
esac
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]] || die 'the repository path is malformed.'

for command_name in curl git python3 runuser ssh-keygen systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
done
id "$RUN_USER" >/dev/null 2>&1 || die "service account does not exist: $RUN_USER"
[[ -f "$APP_DIR/deploy/systemd/swartzit-github-backup.service" ]] || die 'the GitHub backup service unit is missing.'
[[ -f "$APP_DIR/deploy/systemd/swartzit-github-backup.timer" ]] || die 'the GitHub backup timer unit is missing.'

install -d -o "$RUN_USER" -g "$RUN_USER" -m 0700 "$SSH_DIR"

if [[ "$MODE" == prepare ]]; then
  if [[ ! -s "$SSH_KEY" ]]; then
    [[ ! -e "$SSH_KEY" ]] || die 'the existing private key is empty; remove it deliberately before preparing a replacement.'
    runuser -u "$RUN_USER" -- ssh-keygen -q -t ed25519 -N '' -f "$SSH_KEY" -C swartzit-ser8-database-backup
  fi
  derived_public_key=$(runuser -u "$RUN_USER" -- ssh-keygen -y -P '' -f "$SSH_KEY") \
    || die 'could not derive a public key from the backup private key.'
  [[ -n "$derived_public_key" ]] || die 'the backup private key produced an empty public key.'
  printf '%s\n' "$derived_public_key" > "$PUBLIC_KEY"
  chown "$RUN_USER:$RUN_USER" "$SSH_KEY" "$PUBLIC_KEY"
  chmod 0600 "$SSH_KEY"
  chmod 0644 "$PUBLIC_KEY"

  temp_dir=$(mktemp -d)
  trap 'rm -rf "$temp_dir"' EXIT
  curl -fsS --max-time 15 https://api.github.com/meta -o "$temp_dir/github-meta.json" \
    || die 'could not retrieve GitHub SSH host keys over HTTPS.'
  python3 - "$temp_dir/github-meta.json" > "$temp_dir/host-key-data" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    meta = json.load(source)
keys = meta.get("ssh_keys", [])
fingerprint = meta.get("ssh_key_fingerprints", {}).get("SHA256_ED25519", "")
key = next((item for item in keys if item.startswith("ssh-ed25519 ")), "")
if not fingerprint or not key:
    raise SystemExit("GitHub did not publish an Ed25519 SSH key and fingerprint.")
if not fingerprint.startswith("SHA256:"):
    fingerprint = "SHA256:" + fingerprint
print(fingerprint)
print(key)
PY
  mapfile -t host_key_data < "$temp_dir/host-key-data"
  expected_fingerprint=${host_key_data[0]:-}
  host_key=${host_key_data[1]:-}
  [[ -n "$expected_fingerprint" && -n "$host_key" ]] || die 'GitHub did not publish usable SSH host-key data.'
  printf '%s\n' "$host_key" > "$temp_dir/github-host-key"
  actual_fingerprint=$(ssh-keygen -lf "$temp_dir/github-host-key" -E sha256 | awk '{print $2}')
  [[ "$actual_fingerprint" == "$expected_fingerprint" ]] || die 'GitHub SSH host-key fingerprint validation failed.'
  printf 'github.com %s\n' "$host_key" > "$temp_dir/known_hosts"
  install -o "$RUN_USER" -g "$RUN_USER" -m 0600 "$temp_dir/known_hosts" "$KNOWN_HOSTS"

  install -d -m 0755 /etc/swartzit
  config_temp=$(mktemp /etc/swartzit/.github-backup.env.XXXXXX)
  printf 'SWARTZIT_GITHUB_BACKUP_REMOTE=%s\nSWARTZIT_GITHUB_BACKUP_BRANCH=main\nSWARTZIT_GITHUB_BACKUP_RETENTION_DAYS=14\n' "$REMOTE" > "$config_temp"
  install -o root -g root -m 0600 "$config_temp" "$CONFIG_FILE"
  rm -f "$config_temp"

  echo "Prepared a write-scoped backup key for $REMOTE."
  echo 'Add this public key to that private repository as a write-enabled deploy key:'
  cat "$PUBLIC_KEY"
  exit 0
fi

[[ -s "$SSH_KEY" && -s "$PUBLIC_KEY" && -s "$KNOWN_HOSTS" ]] || die 'run prepare mode and add the public key to the repository before enabling backups.'
[[ -r "$CONFIG_FILE" ]] || die "backup configuration not found: $CONFIG_FILE"
set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
set +a
[[ "${SWARTZIT_GITHUB_BACKUP_REMOTE:-}" == "$REMOTE" ]] || die 'the requested remote does not match the prepared backup configuration.'

install -m 0644 "$APP_DIR/deploy/systemd/swartzit-github-backup.service" /etc/systemd/system/swartzit-github-backup.service
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-github-backup.timer" /etc/systemd/system/swartzit-github-backup.timer
systemctl daemon-reload
systemctl start swartzit-github-backup.service
systemctl enable --now swartzit-github-backup.timer
echo "Initial backup succeeded and the 14-day daily timer is enabled for $REMOTE."
