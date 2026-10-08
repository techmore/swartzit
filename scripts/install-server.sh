#!/usr/bin/env bash
set -euo pipefail

# Install a tagged Swartzit checkout on a fresh Ubuntu VPS. Run as root with
# REPO_URL and database/scheduler values supplied out of band.
[[ $EUID -eq 0 ]] || { echo 'Run this installer as root.' >&2; exit 1; }
APP_DIR=${APP_DIR:-/var/lib/swartzit}
REPO_URL=${REPO_URL:-https://github.com/techmore/swartzit.git}
REF=${REF:-main}
ORIGIN=${ORIGIN:-}
DATABASE_URL=${DATABASE_URL:-sqlite:$APP_DIR/state/swartzit.sqlite}
SCHEDULER_HANDLE=${SCHEDULER_HANDLE:-}
SCHEDULER_PASSWORD=${SCHEDULER_PASSWORD:-}
X_BEARER_TOKEN=${X_BEARER_TOKEN:-}
WEB_HOST=${WEB_HOST:-${SWARTZIT_WEB_HOST:-127.0.0.1}}
WIREGUARD_INTERFACE=${WIREGUARD_INTERFACE:-}
CADDY_UPSTREAM=${CADDY_UPSTREAM:-$WEB_HOST:4173}
SWARTZIT_AUTO_UPDATE=${SWARTZIT_AUTO_UPDATE:-0}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git openssh-client build-essential pkg-config libssl-dev rustc cargo python3 sqlite3 nodejs npm caddy
id swartzit >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --create-home --shell /usr/sbin/nologin swartzit
mkdir -p "$APP_DIR" /etc/swartzit
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone --branch "$REF" --depth 1 "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch --depth 1 origin "$REF"
  git -C "$APP_DIR" checkout -q FETCH_HEAD
fi
chown -R swartzit:swartzit "$APP_DIR"
runuser -u swartzit -- bash -lc "cd '$APP_DIR' && cargo build --release --locked && npm ci --omit=dev && npm --prefix apps/web ci && npm --prefix apps/web run build"
# Playwright is an optional worker capability, but installing the pinned
# Chromium runtime here keeps a fresh Ubuntu source install ready for the
# dedicated read-only X runner. The browser profile itself is created later
# under the worker state directory after an administrator signs into X.
PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/.cache/ms-playwright" npx --prefix "$APP_DIR" playwright install --with-deps chromium
chown -R swartzit:swartzit "$APP_DIR/.cache"
# Services can write their runtime directories, but never replace root tools.
python3 "$APP_DIR/scripts/swartzit-protect-code.py" "$APP_DIR"
install -o root -g root -m 0755 "$APP_DIR/target/release/swartzit-server" /usr/local/bin/swartzit-server

if [[ -z "$SCHEDULER_HANDLE" || -z "$SCHEDULER_PASSWORD" || -z "$ORIGIN" ]]; then
  cat >&2 <<'EOF'
Build complete. Before starting services, set these values and rerun:
  ORIGIN=https://your-hostname
  SCHEDULER_HANDLE=...
  SCHEDULER_PASSWORD=...
EOF
  exit 0
fi
[[ "$DATABASE_URL" == sqlite:* ]] || { echo "Import PostgreSQL data before installing this SQLite release." >&2; exit 1; }
install -d -o swartzit -g swartzit -m 0700 "$APP_DIR/state"
cat > /etc/swartzit/server.env <<EOF
DATABASE_URL=$DATABASE_URL
BIND_ADDR=127.0.0.1:18080
SWARTZIT_STATE_DIR=$APP_DIR/state
SWARTZIT_MEDIA_ROOT=$APP_DIR/state/media
EOF
cat > /etc/swartzit/web.env <<EOF
API_URL=http://127.0.0.1:18080
HOST=$WEB_HOST
PORT=4173
ORIGIN=$ORIGIN
EOF
cat > /etc/swartzit/worker.env <<EOF
API_URL=http://127.0.0.1:18080
SCHEDULER_HANDLE=$SCHEDULER_HANDLE
SCHEDULER_PASSWORD=$SCHEDULER_PASSWORD
X_BEARER_TOKEN=$X_BEARER_TOKEN
EOF
chmod 600 /etc/swartzit/*.env
install -m 0644 "$APP_DIR/deploy/systemd/swartzit.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-web.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-worker.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-worker.timer" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-upgrade-check.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-upgrade-check.timer" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-update.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-update.timer" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-github-backup.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/swartzit-github-backup.timer" /etc/systemd/system/
install -d -o root -g root -m 0755 /usr/local/libexec/swartzit/scripts /usr/local/libexec/swartzit/crates/server/sqlite-migrations
cp -a "$APP_DIR/scripts/." /usr/local/libexec/swartzit/scripts/
cp -a "$APP_DIR/crates/server/sqlite-migrations/." /usr/local/libexec/swartzit/crates/server/sqlite-migrations/
chown -R root:root /usr/local/libexec/swartzit
chmod -R go-w /usr/local/libexec/swartzit
find /usr/local/libexec/swartzit/scripts -maxdepth 1 -name '*.sh' -exec chmod 0755 {} +

if [[ -n "$WIREGUARD_INTERFACE" ]]; then
  [[ "$WIREGUARD_INTERFACE" == wg0 ]] || { echo 'WIREGUARD_INTERFACE currently supports only wg0.' >&2; exit 1; }
  install -d -m 0755 /etc/systemd/system/swartzit-web.service.d
  install -m 0644 "$APP_DIR/deploy/systemd/swartzit-web-wireguard-wg0.conf" \
    /etc/systemd/system/swartzit-web.service.d/10-wireguard.conf
  install -d -m 0755 /etc/systemd/system/caddy.service.d
  install -m 0644 "$APP_DIR/deploy/systemd/swartzit-caddy-wireguard-wg0.conf" \
    /etc/systemd/system/caddy.service.d/10-wireguard.conf
  systemctl enable wg-quick@wg0
fi
systemctl daemon-reload
if [[ -n "${CADDY_DOMAIN:-}" ]]; then
  cat > /etc/caddy/Caddyfile <<EOF
$CADDY_DOMAIN {
  encode gzip zstd
  reverse_proxy $CADDY_UPSTREAM
}
EOF
  systemctl enable --now caddy
fi
systemctl enable --now swartzit swartzit-web swartzit-worker.timer swartzit-upgrade-check.timer
if [[ "$SWARTZIT_AUTO_UPDATE" == 1 ]]; then
  cat > /etc/swartzit/update.env <<EOF
SWARTZIT_UPDATE_REF=${SWARTZIT_UPDATE_REF:-main}
SWARTZIT_UPDATE_PUBLIC_URL=${SWARTZIT_UPDATE_PUBLIC_URL:-$ORIGIN}
SWARTZIT_UPDATE_ERROR_URL=${SWARTZIT_UPDATE_ERROR_URL:-}
EOF
  chmod 600 /etc/swartzit/update.env
  systemctl enable --now swartzit-update.timer
  echo "Enabled swartzit-update.timer; configure /etc/swartzit/update.env before production use."
fi
echo "Swartzit installed. Check: systemctl status swartzit swartzit-web swartzit-worker.timer"
