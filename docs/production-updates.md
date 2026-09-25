# Prototype, backup, and production updates

Swartzit uses the Mac as the change-and-recovery environment and the Ubuntu
host as the always-on production environment. A production update is allowed
to change the application checkout and compiled assets, but it must not rewrite
`/etc/swartzit/server.env` or `/etc/swartzit/web.env`; that keeps the deployment
bind, WireGuard address, database URL, and origin operator-owned.

## 1. Prototype on the Mac or in an Apple VM

Use the Mac checkout, an Incus macOS/Linux VM, or another disposable runtime
that has the same PostgreSQL and Node versions as production. The VM should
mount its own persistent state directory; never mount the live production
database directory into a prototype.

Before testing an upgrade, make a real backup and verify that it can be
restored into a disposable database container:

```sh
swartzit backup
swartzit restore-verify \
  "$HOME/Library/Application Support/Swartzit/backups/<timestamp>/swartzit-<timestamp>-backup.tgz"
```

Then run the local checks and upgrade path:

```sh
scripts/release-preflight.sh
swartzit update --yes
swartzit status --json
```

`swartzit update --yes` now verifies the backup archive before stopping the
local services. Set `SWARTZIT_VERIFY_BACKUP=0` only for a deliberately faster
disposable test where the backup was already verified separately.

The native macOS menu companion consumes the update receipt and status file.
It reports backup, install, health-check, and failure phases without storing
application data. Set `SWARTZIT_UPDATE_ERROR_URL` (and, when required,
`SWARTZIT_UPDATE_ERROR_TOKEN`) to send an opt-in JSON failure notification to
an operator-owned endpoint. No telemetry endpoint is enabled by default.

## 2. Commit and push the tested release

Keep the normal review boundary between the prototype and production:

```sh
git switch -c codex/your-change
git diff --check
git status --short
git add .
git commit -m "Describe the tested change"
git push -u origin codex/your-change
```

Merge to `main` only after CI and the disposable restore check pass. The
production workflow deploys the `main` checkout, so a merge is the explicit
promotion event.

## 3. Opt the Ubuntu host into push-to-production updates

The repository includes a guarded GitHub Actions workflow at
`.github/workflows/deploy-production.yml`. It does nothing until the repository
variable `SWARTZIT_DEPLOY_ENABLED=true` is set. Configure these production
secrets in the `production` environment:

| Secret | Purpose |
| --- | --- |
| `SWARTZIT_DEPLOY_HOST` | SSH host or WireGuard-reachable address |
| `SWARTZIT_DEPLOY_USER` | Restricted deploy user |
| `SWARTZIT_DEPLOY_SSH_KEY` | Deploy-only private key |
| `SWARTZIT_DEPLOY_KNOWN_HOSTS` | Pinned SSH host-key lines |
| `SWARTZIT_DEPLOY_PORT` | Optional SSH port; defaults to 22 |

The deploy user needs a narrowly scoped `sudoers` rule for the updater:

```text
deploy ALL=(root) NOPASSWD: /var/lib/swartzit/scripts/swartzit-linux-update.sh --yes, /bin/cat /var/lib/swartzit/state/update-receipt.json
```

Install the updater units without enabling automatic polling:

```sh
sudo install -m 0755 scripts/swartzit-linux-update.sh /var/lib/swartzit/scripts/
sudo install -m 0644 deploy/systemd/swartzit-update.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/swartzit-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

The updater performs this sequence:

1. Refuses a dirty production checkout.
2. Dumps PostgreSQL in custom format using the native `pg_dump` client.
3. Writes row counts, SHA256 sums, and a rolling archive under the configured
   state backup directory.
4. Validates the checksum and `pg_restore --list` before stopping anything.
5. Stops the API, web, and worker timer, fetches `main`, builds the Rust and
   SvelteKit releases, and installs the systemd unit files.
6. Restarts services using the existing environment files, so the current
   WireGuard/web bind is preserved.
7. Requires API, web, and optional public URL health checks to pass.
8. On a build/start/health failure, switches the code checkout back to the
   previous commit and retries the health gate. It never restores the database
   automatically; the verified pre-update backup is recorded in
   `/var/lib/swartzit/state/update-receipt.json` for an operator-controlled
   data rollback.

For hosts that should poll GitHub without Actions, create
`/etc/swartzit/update.env` and enable the timer explicitly:

```sh
SWARTZIT_UPDATE_REF=main
SWARTZIT_UPDATE_PUBLIC_URL=https://stoverparc.org
# Optional, operator-owned JSON failure receiver:
# SWARTZIT_UPDATE_ERROR_URL=https://ops.example/update-events
```

```sh
sudo chmod 600 /etc/swartzit/update.env
sudo systemctl enable --now swartzit-update.timer
```

The timer runs during the maintenance window with a randomized delay. Use
either the timer or GitHub Actions as the production authority, not both.
