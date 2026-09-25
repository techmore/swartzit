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

Merge to `main` only after CI and the disposable restore check pass. Merging
does **not** change a live host. Promotion is a separate, explicit step: cut a
release tag, and the deploy workflow installs that published release.

```sh
git tag -a v0.1.36-20260925T19 -m "Swartzit 0.1.36-20260925T19"
git push origin v0.1.36-20260925T19
```

`release.yml` builds and publishes the checksummed assets for the tag, and
`deploy-production.yml` then installs them on the host. A tag can also be
deployed by hand with `workflow_dispatch` and the `tag` input.

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
deploy ALL=(root) NOPASSWD: /var/lib/swartzit/scripts/swartzit-linux-update.sh --tag v*, --yes, /bin/cat /var/lib/swartzit/state/update-receipt.json
```

`swartzit-linux-update.sh` holds no update logic. It delegates to
`scripts/swartzit-release-update.sh`, so the sudoers grant stays scoped to a
stable path while the gates it runs live in one reviewed place. Because the
grant accepts any `v*` tag, require a reviewer on the `production` environment
so no tag can deploy unattended.

Install the updater units without enabling automatic polling:

```sh
sudo install -m 0755 scripts/swartzit-linux-update.sh /var/lib/swartzit/scripts/
sudo install -m 0644 deploy/systemd/swartzit-update.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/swartzit-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

The updater performs this sequence:

1. Refuses a checkout with tracked modifications. Untracked operational state in
   the deployment directory is ignored, so `state/` and caches do not make a
   host unupgradeable.
2. Downloads the tagged release assets and verifies every SHA-256 before
   anything is installed, so a truncated or tampered asset cannot be applied.
3. Dumps PostgreSQL in custom format using the service's own credentials, and
   writes row counts, a media archive, and checksums.
4. **Restore rehearsal:** restores that archive into a throwaway database and
   compares per-table row counts. Content tables must match exactly;
   operational tables that are expected to move are reported with their delta.
5. **Migration rehearsal:** restores the dump again into a disposable role's
   database and starts the *candidate* binary against that copy, waiting for
   `/health`. An incompatible migration fails here, before any live service is
   touched.
6. Stops the API, web, and worker timer, then installs the verified binary and
   swaps the web build directory by atomic rename.
7. Restarts services using the existing environment files, so the current
   WireGuard/web bind is preserved.
8. Requires `/ready`, `/health`, the web root, and an optional public URL to
   pass. `/ready` proves startup finished and `/health` proves the database
   answers.
9. On a start or health failure, restores the previous binary, web build, and
   commit, then re-checks health. It never restores the database
   automatically; the verified pre-update backup is recorded in
   `/var/lib/swartzit/state/update-receipt.json` and in the recovery bundle
   under `/var/backups/swartzit/releases/` for an operator-controlled data
   rollback.

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
