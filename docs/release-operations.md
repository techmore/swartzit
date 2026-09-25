# Safe release operations

A Swartzit release is upgraded from a tagged GitHub release, never from a source
build on the live host. Every upgrade takes a verified database backup,
rehearses the candidate release against a restored copy of the production data,
and rolls the service back automatically if the new release does not become
healthy.

## Release contract

Pushing a `v*` tag publishes a release with:

```text
swartzit-server-linux-amd64          the Rust API/worker server
swartzit-web-linux-amd64.tar.gz      the built SvelteKit build/ directory
VERSION                              the release version, no leading v
SHA256SUMS                           checksums for all three files
```

The release workflow runs the same fmt, clippy, test, web check, web build, and
Node test gates as CI, then verifies the checksums and the archive layout before
uploading. The updater refuses a release that is missing any of these files or
whose checksums do not match.

## Local Mac rehearsal

The whole upgrade path can be rehearsed on the Mac against a real PostgreSQL
cluster, with no container runtime and no production host involved:

```sh
# A local cluster (Homebrew is shown here; any PostgreSQL 16 works).
brew install postgresql@16
brew services start postgresql@16

# Point the scripts at a scratch database.
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
export SWARTZIT_DB_USER="$(id -un)"
export SWARTZIT_DB_NAME=swartzit_rehearsal
export SWARTZIT_DB_HOST=127.0.0.1
export SWARTZIT_DB_PORT=5432
export SWARTZIT_DATABASE_URL="postgres://$(id -un)@127.0.0.1:5432/swartzit_rehearsal"
export SWARTZIT_BACKUP_DIR="$PWD/.local/backups"

bash scripts/db-backup-postgres.sh
bash scripts/db-restore-verify-postgres.sh .local/backups/<archive>.tgz
bash scripts/preflight-release.sh ./target/release/swartzit-server .local/backups/<stamp>/swartzit.dump
```

`preflight-release.sh` is the database-compatibility gate. It restores the
backup into a throwaway database, starts the candidate binary against that copy,
and waits for `/health`. A migration that cannot apply to the current data fails
here with a non-zero exit, before any live service is touched.

The rehearsal role and database are always removed, including on failure. A
crashed candidate can leave a session attached, so teardown terminates leftover
backends and retries before warning.

For the container-backed local database, the original `scripts/db-backup.sh` and
`scripts/db-restore-verify.sh` remain in place and are driven by
`bash scripts/run-local.sh`.

## Production upgrade

On the Ubuntu host that serves the real instance, as root:

```sh
cd /var/lib/swartzit
bash scripts/swartzit-release-update.sh --tag v0.1.31-20260925T16 --dry-run
bash scripts/swartzit-release-update.sh --tag v0.1.31-20260925T16 --yes
```

The updater performs these steps in order:

1. Takes an exclusive filesystem lock.
2. Confirms the checkout has no tracked modifications.
3. Downloads the tagged release assets, including `VERSION` and `SHA256SUMS`.
4. Verifies every checksum and refuses a partial release.
5. Dumps PostgreSQL in custom format with row counts, a media archive, and a
   checksum manifest.
6. Restores the dump into a throwaway database owned by a disposable role.
7. Starts the candidate server on that restored copy and waits for `/health`,
   which is what proves the migrations are compatible.
8. Records the previous binary, web build, version, and commit.
9. Fetches and checks out the exact release tag.
10. Stops the crawler worker timer so no job is claimed mid-swap.
11. Stops the API and web services.
12. Installs the new binary by rename, so no process sees a partial file, and
    swaps the web build directory.
13. Starts the services and checks API and web health.
14. Writes a release manifest and reports the recovery bundle path.
15. Restores the previous binary, web build, and commit if any health check
    fails.

The production database is never overwritten by an automatic rollback. The
verified backup is retained for an explicit, reviewed database restore.

Service endpoints are configurable if the layout changes:

```text
SWARTZIT_API_URL   defaults to http://127.0.0.1:18080
SWARTZIT_WEB_URL   defaults to http://127.0.0.1:3000
```

The public Caddy listener is WireGuard-bound, so the loopback web port is the
reliable post-swap health target.

## Upgrading a host whose checkout is still on an old commit

The updater records the currently checked-out commit before it advances the
checkout, so it is best run from a copy of the tools staged outside the
deployment directory. That keeps the old commit available for rollback even
though the run itself checks out the new tag.

```sh
TAG=v0.1.32-20260925T18
sudo git -C /var/lib/swartzit fetch origin "refs/tags/$TAG:refs/tags/$TAG"
sudo rm -rf "/var/tmp/swartzit-tools-$TAG"
sudo mkdir -p "/var/tmp/swartzit-tools-$TAG"
sudo git -C /var/lib/swartzit archive "$TAG" scripts | sudo tar -x -C "/var/tmp/swartzit-tools-$TAG"
sudo bash "/var/tmp/swartzit-tools-$TAG/scripts/swartzit-release-update.sh" --tag "$TAG" --dry-run
sudo bash "/var/tmp/swartzit-tools-$TAG/scripts/swartzit-release-update.sh" --tag "$TAG" --yes
sudo bash /var/lib/swartzit/scripts/install-release-automation.sh
```

## Installing the automation on an existing host

`install-server.sh` wires up the release tooling on a fresh install. An existing
host gets the same scripts and timer without touching the database or the
running release:

```sh
sudo bash /var/lib/swartzit/scripts/install-release-automation.sh
```

## Scheduled checking

The installer enables `swartzit-upgrade-check.timer`, which runs daily with a
randomized delay. It is check-only by default and does nothing until a release
tag is pinned.

Create `/etc/swartzit/upgrade.env` to pin an approved release:

```text
SWARTZIT_RELEASE_TAG=v0.1.31-20260925T16
```

To allow unattended installation, add:

```text
SWARTZIT_AUTO_UPDATE=true
```

Only enable unattended mode after a successful manual `--yes` run and a
restore rehearsal. Unattended mode still requires a valid backup, a successful
restore rehearsal, matching release checksums, and a passing health check, so a
bad release cannot install itself.

Inspect the timer and log with:

```sh
systemctl status swartzit-upgrade-check.timer
journalctl -u swartzit-upgrade-check.service
cat /var/log/swartzit-upgrade.log
```

## Recovery

Every update stores a recovery bundle under:

```text
/var/backups/swartzit/releases/<timestamp>/
```

containing `backup.txt`, `previous-commit`, `previous-version`,
`swartzit.dump`, `swartzit-server.previous`, and `web-build.tgz`. The applied
release is recorded in `/var/lib/swartzit/state/current-release.json`.

The automatic rollback restores the binary and web build only. To roll back a
database as well, stop the services, restore the verified dump, and re-run the
restore rehearsal and health checks before reopening traffic.
