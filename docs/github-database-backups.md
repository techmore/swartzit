# Rolling GitHub database backups

The Ubuntu Ser8 host can publish a daily PostgreSQL snapshot to a dedicated
private GitHub repository. Each snapshot contains `swartzit.dump`, its SHA256
checksum, table row counts, and a creation manifest. It does not include media
files or `/etc/swartzit` environment files. The GitHub branch shows only the
latest 14 calendar days of snapshots. Each run replaces the branch tip with a
snapshot tree without retaining prior Git commits, so ordinary branch history
does not grow past the rolling set.

Before publishing, the job checks that the dump is non-empty and readable by
`pg_restore`, verifies the checksum, and compares the dump size and public table
row counts with the previous snapshot. It stops if a dump is smaller or any
table's row count decreased. This leaves the last good GitHub backup in place
when the live database is unexpectedly reset or truncated. For a deliberate
data deletion or database compaction, inspect the new database and run one
manual backup with `SWARTZIT_GITHUB_BACKUP_ALLOW_SHRINK=1` in the service's
environment; remove that override afterward.

## Configure the private repository

Create an empty **private** repository named `techmore/ser8-database-backups`.
Do not reuse the application repository. Keep its `main` branch unprotected so
the job can replace the snapshot tree after pruning old dates.

Use **Actions → Deploy production → Run workflow** on `main`:

1. Choose `prepare-github-backup`. The host creates a dedicated SSH key for
   `swartzit`, verifies GitHub's published Ed25519 host-key fingerprint, writes
   the private key outside the application checkout, and prints only the public
   key in the run log.
2. Add the printed key to the private repository as a deploy key with write
   access. This key can push only to this backup repository.
3. Dispatch `enable-github-backup`. It runs the first backup and enables the
   daily timer only after that push succeeds.

Both operations use the default SSH remote
`git@github.com:techmore/ser8-database-backups.git`; the workflow input can
override it for another private repository.

The backup contains the complete PostgreSQL database configured by
`DATABASE_URL`, including account data and password hashes. Keep the GitHub
repository private and limit access to the operators who need database recovery.

## Enable and inspect the job

The timer runs daily at 03:30 UTC with a randomized delay of up to 15 minutes.
`Persistent=true` runs a missed backup after the host comes back online. Local
backup files and the temporary Git workspace live under
`/var/lib/swartzit-github-backup`; the local backup copy also retains 14 dumps.

## Restore

Clone the backup repository and select a date under `snapshots/`. Run the
project's `scripts/db-restore-verify-postgres.sh` against that snapshot's
`swartzit.dump` on a machine with PostgreSQL client tools installed.
For native PostgreSQL on Ser8, use the usual maintenance procedure, stop the
app services, and restore the selected dump with:

```sh
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner \
  --exit-on-error swartzit.dump
```

Start the services and check their health after the restore.
