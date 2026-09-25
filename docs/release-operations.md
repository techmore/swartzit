# Safe release operations

Swartzit releases are designed to be upgraded from a tagged GitHub release with a verified database backup and an automatic rollback path.

## Release contract

A release tag such as `v0.3.0` publishes:

```text
swartzit-server-linux-amd64
swartzit-server-linux-amd64.sha256
swartzit-web-linux-amd64.tar.gz
swartzit-web-linux-amd64.tar.gz.sha256
```

The web archive contains the built SvelteKit `build/` directory. The server binary is built with Cargo from the same tagged commit.

The GitHub Actions release workflow builds, tests, packages, checksums, and publishes these assets. The updater refuses an asset without a matching SHA-256 file.

## Local Mac test release

Use the existing Mac workflow for a safe rehearsal:

```sh
cd /path/to/swartzit
bash scripts/release-preflight.sh
bash scripts/db-backup.sh
bash scripts/db-restore-verify.sh .local/backups/<archive>.tgz
```

For a container-backed local database, `db-backup.sh` and `db-restore-verify.sh` use the configured `swartzit-db` container. The production Ubuntu scripts use native PostgreSQL through `db-backup-postgres.sh` and `db-restore-verify-postgres.sh`.

## Production release update

On the Ubuntu host, as root:

```sh
cd /var/lib/swartzit
bash scripts/swartzit-release-update.sh --tag v0.3.0 --dry-run
bash scripts/swartzit-release-update.sh --tag v0.3.0 --yes
```

The updater performs these steps in order:

1. Takes a filesystem and process lock.
2. Verifies the checkout has no tracked modifications.
3. Downloads the tagged GitHub release assets.
4. Verifies SHA-256 checksums.
5. Creates a native PostgreSQL custom-format backup, row counts, media archive, and checksums.
6. Restores the dump into a temporary PostgreSQL database.
7. Starts the new server against that temporary database to test migrations and `/health`.
8. Records the previous binary, web build, version, and commit.
9. Fetches and checks out the exact release tag.
10. Stops the web/API services.
11. Installs the new binary and swaps the web build directory.
12. Starts the services and checks API and web health.
13. Writes a release manifest and recovery bundle path.
14. Rolls back the binary/web build if health checks fail.

The production database is not automatically overwritten during rollback. The verified backup is retained for an explicit, reviewed database restore.

## Scheduled checking

The installer enables `swartzit-upgrade-check.timer`, which runs daily with a randomized delay. It is check-only by default.

Create `/etc/swartzit/upgrade.env` to pin an approved release:

```text
SWARTZIT_RELEASE_TAG=v0.3.0
```

To allow unattended installation, add:

```text
SWARTZIT_AUTO_UPDATE=true
```

Only enable unattended mode after a successful manual `--yes` run and a restore rehearsal. The updater still requires a valid backup, restore verification, release checksums, and a successful health check.

Inspect the timer and log with:

```sh
systemctl status swartzit-upgrade-check.timer
journalctl -u swartzit-upgrade-check.service
cat /var/log/swartzit-upgrade.log
```

## Rollback

Every update stores a recovery bundle under:

```text
/var/backups/swartzit/releases/<timestamp>/
```

It contains:

```text
backup.txt
previous-commit
previous-version
swartzit.dump
swartzit-server.previous
web-build.tgz
```

The automatic rollback restores the binary and web build only. For a database rollback, stop the services, restore the verified dump, and run the post-restore health checks before reopening traffic.
