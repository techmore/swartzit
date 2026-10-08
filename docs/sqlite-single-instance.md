# SQLite single-instance deployment

Swartzit runs in one Linux container or VM: the Rust API owns an embedded
SQLite database, the Svelte website proxies to that API, and Node workers use
HTTP rather than database connections. No database VM or Redis service is
required. Public responses use the existing bounded in-process cache (32 entries,
5-second default TTL); account-specific state is applied after cache lookup.

## Storage and concurrency

`DATABASE_URL=sqlite:/var/lib/swartzit/state/swartzit.sqlite` places the database
in the persistent state directory. Keep it on local SSD storage, not NFS/SMB.
SQLite WAL permits concurrent readers and one writer. Connections enforce
foreign keys, FULL synchronous durability and a 10-second busy timeout.
Read-before-write workflows reserve the writer with `BEGIN IMMEDIATE`; job
claims commit before provider requests or external worker execution. Existing
runner leases, retry limits and maintenance remain intact. Search uses FTS5
with Porter stemming and weighted title/body relevance.

The database, canonical filesystem media, worker state and environment files
are persistent. Code and release tools are root-owned. The public `/api/export`
endpoint omits private data and is not a full recovery backup.

## PostgreSQL import

The one-time importer preserves all 37 application tables through PostgreSQL
migration 0056: accounts/password hashes, sessions, posts/comments, bookmarks,
moderation history, jobs, settings, legacy media blobs and ID high-water marks.
It exports one repeatable-read snapshot and refuses an existing destination.
It compares normalized content fingerprints for every table, checks foreign
keys and integrity, rebuilds FTS, and records a private migration receipt.
Timestamp normalization retains the instant and microsecond precision.

Keep credentials out of command arguments:

```sh
# Supply the source URL through a protected environment, never a shell history.
python3 scripts/sqlite-db.py migrate-postgres env:SWARTZIT_POSTGRES_SOURCE_URL \
  /path/to/new/swartzit.sqlite
```

An import while the old service runs is a rehearsal. Stop API and workers before
creating the final import so new writes cannot be left in PostgreSQL. Preserve
its dump, original environment and previous release until the new deployment
and off-host backup are confirmed. Use the root-only
`scripts/swartzit-sqlite-cutover.sh --tag vX.Y.Z --yes` for a Linux deployment;
it performs that stop/import/environment/checked-release sequence and restores
the PostgreSQL environment if activation fails. It does not delete the old
PostgreSQL database or its VM.

## Backups and updates

`scripts/db-backup.sh` selects SQLite from `DATABASE_URL` and uses SQLite's
online backup API. Row counts come from the completed snapshot itself. Archives
retain the familiar `swartzit.dump` filename; the file header identifies the
format. The archive includes checksums, counts and optional canonical media.
`scripts/db-restore-verify-postgres.sh` verifies SQLite copies and supports
retained PostgreSQL dumps when PostgreSQL client tools are available.

Release preflight starts the candidate against a disposable snapshot, with
maintenance disabled and isolated media/cache directories. It never points the
candidate at the production file. Release activation keeps binary/web recovery
assets and does not automatically reverse database migrations.

The daily private GitHub backup accepts SQLite snapshots and retains older
PostgreSQL snapshots. On SER8 its URL refers to the host's bind-mounted state
file. Install the committed helper and SQLite schema alongside the root-owned
release tools; application releases cannot replace those privileged tools.

The [SER8 production cutover receipt](sqlite-cutover-2026-10-08.md) records the
active release, preserved data, backup confirmation and retained recovery paths.
