# Changelog

## 0.1.7-20260923T14

- Fixes the macOS menu LaunchAgent environment so version, network, uptime, and
  component health no longer fall back to `unknown`.
- Adds locked, rotating PostgreSQL backups with a macOS LaunchAgent scheduler
  and configurable interval, retention, state, and backup locations.
- Keeps the update path backup-first and documents the safe upgrade workflow.

## 0.1.6-20260923T14

- Keeps the native macOS menu companion synchronized with Homebrew upgrades.
- Adds the installed package version to status output and the menu item.
- Refreshes the persistent menu binary, icon, and LaunchAgent after updates.

## 0.1.5-20260923T13

- Adds public user profiles with editable metadata and recent activity views.
- Adds deterministic moderation signals, review actions, audit history, and
  timed suspensions while keeping threat detection advisory for humans.
- Adds uptime pulse recording, configurable public checks, richer local health
  status, and a native macOS menu-bar indicator with network details.
- Expands the Homebrew package with the monitor, pulse, Orchard integration,
  and persistent update/recovery tooling.

## 0.1.4-20260923T12

- Makes rollback startup resilient to normal web-server startup latency by
  starting once and polling health instead of repeatedly restarting services.

## 0.1.3-20260923T12

- Aligns the release archive with the audited Homebrew formula: the installed
  version file lives in `libexec`, and the launcher reads it from there.
- Uses Homebrew’s standard Cargo install path and leaves only executables in
  the formula’s `bin` directory.

## 0.1.2-20260923T12

- Fixed the Homebrew launcher to resolve its keg path when invoked through the
  `/opt/homebrew/bin/swartzit` symlink, so installed status, start, update, and
  rollback commands use the persistent application layout.

## 0.1.1-20260923T12

- Added explicit, confirmation-gated database rollback with a preserved
  pre-rollback backup, archive, checksum validation, and recovery manifest.
- Fixed installed Homebrew state, backup, status, and update paths, including
  macOS `Application Support` paths containing spaces.
- Fixed status exit codes and JSON argument forwarding so the native menu item
  and automated health checks can reliably detect an unhealthy instance.
- Removed the remaining web accessibility and unused-CSS diagnostics and made
  CI enforce the same check and Clippy gates used for release preflight.

## 0.1.0-20260923T12

- Added a native macOS menu-bar status app with rolling activity summaries.
- Added Homebrew packaging for the Rust API, SvelteKit web app, and status binary.
- Added backup-first update handling, persistent runtime state, and recovery manifests.
- Added verified PostgreSQL backup/restore tooling and release preflight checks.
- Added reproducible API performance smoke benchmarks and an initial M1 Pro baseline.
- Added source-aware imports, public export, reading history, bookmarks, media handling,
  threaded discussions, voting, subscriptions, reports, crawler jobs, and admin health.

## Unreleased

The current prototype includes public server-rendered reading, communities,
search, RSS, public export, pseudonymous accounts, expiring sessions, session
revocation, text posts, threaded comments, voting, subscriptions, reports, and
content-addressed media manifests.

Still being designed: ActivityPub federation, account migration and import, byte
upload processing, peer-assisted media delivery, and a polished browser
comment/vote experience.
