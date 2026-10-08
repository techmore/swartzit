# SER8 SQLite cutover — 2026-10-08

## Current release

The final deployment is `v0.1.95-20261008T2345`, built from
`04c6b56e44a3f633aef7434a9ebec2c3ac29e0a1`. Its
[main CI](https://github.com/techmore/swartzit/actions/runs/37861177518) and
[release checks](https://github.com/techmore/swartzit/actions/runs/37861194770)
passed. It packages the backup fixes described below. The standard updater
verified a fresh SQLite/media backup, rehearsed its restore and started the
candidate on a disposable snapshot before activation. API/web health checks
passed. This update took 8.7 seconds; most work preceded service replacement.
Its recovery bundle is `/var/backups/swartzit/releases/20261008T234959Z` inside
the app container. Trusted host/container release tools match this tag.

## Initial conversion

- Site: <https://swartzit.stoverparc.org>.
- Release: `v0.1.94-20261008T2333`.
- Application build commit: `496eb6c219d04c547d4a37ff5c328c59df790795`.
- Main CI: [37859943911](https://github.com/techmore/swartzit/actions/runs/37859943911).
- Release checks and assets: [37860152706](https://github.com/techmore/swartzit/actions/runs/37860152706).
- One active application container: `swartzit`, API, web and scheduled worker.
- Database: `sqlite:/var/lib/swartzit/state/swartzit.sqlite`, persistent local
  SSD state bind-mounted from SER8. WAL, FULL synchronous durability, foreign
  keys and a 10-second busy timeout are enabled by the API.
- Public response caching remains in process; no Redis service is needed.

The root cutover completed at approximately `2026-10-08T23:38:46Z`, in 11.4
seconds. API and workers were stopped before the final export. All 37
application tables and 5,758 rows were imported; every normalized table content
fingerprint matched. SQLite integrity and foreign-key checks passed. The
release candidate started successfully against a disposable restored snapshot
before activation.

After activation, the API, web service and worker timer were active. Existing
scheduler credentials authenticated successfully. Public feeds, recommended and
score ordering, full-text search, activity, communities, RSS, admin overview,
uptime, storage, analytics, settings, crawler jobs and content runners returned
HTTP 200. The temporary admin session was removed. Those requests also passed
after PostgreSQL was stopped.

## Backup and retained recovery

- Final PostgreSQL dump, media and original protected environment:
  `/var/backups/swartzit-sqlite-cutover.cWDmE0LK` inside the app container.
- Previous binary/web assets and checked SQLite snapshot:
  `/var/backups/swartzit/releases/20261008T233838Z` inside the app container.
- Host backup configuration recovery:
  `/var/backups/swartzit-sqlite-host.0cQaH6om` on SER8.
- First SQLite daily database snapshot:
  `/var/lib/swartzit-github-backup/local-backups/20261008T233920Z/swartzit.dump`.
- Private database backup repository: `techmore/ser8-database-backups`.
  Commit `a3d624f4f762399200f90dc3aa2fadf3cfada8d7` was published at
  `2026-10-08T23:39:27Z`; the backup service exited successfully.

Daily GitHub snapshots contain the complete database and retain 14 days. Media
is included in the local cutover/release recovery archives; the existing daily
GitHub job excludes media. Trusted backup/import/release tools and the SQLite
schema are installed root-owned under `/usr/local/libexec/swartzit` on the host
and inside the app container. The database, WAL and shared-memory files are
mode 0600, owned by the app/backup account with matching host/container IDs.

The dedicated `swartzit-db` VM is **stopped**, with `boot.autostart=false`.
Its original database and recovery files remain available. New writes go to
SQLite, so an eventual PostgreSQL rollback requires deliberate data
reconciliation; restarting the retained VM alone does not move new data back.

## Backup follow-up

The first SQLite snapshot was complete, but opening its WAL-mode header during
validation left empty WAL/shared-memory metadata in the temporary Git checkout.
The next job correctly rejected those extra files. Backup tools were updated in
`cf7571f95ce39db5f576725ecb97d12d8fa3ce9d` to close connections explicitly,
store standalone snapshots in DELETE journal mode, and validate frozen copies
outside the snapshot tree against their saved table counts. The repair only
removes metadata after verifying the standalone database; a nonempty WAL is
rejected.

The corrected GitHub jobs completed at `2026-10-08T23:44:50Z` and
`2026-10-08T23:45:33Z`, with PostgreSQL still stopped. The current snapshot tree
contains only the database, checksums and manifests. Public website and API
requests returned HTTP 200 after those jobs.

See [SQLite deployment and recovery](sqlite-single-instance.md) for future
installation, snapshots and restore procedures.
