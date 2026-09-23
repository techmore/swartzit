# Changelog

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

Still being designed: ActivityPub federation, moderator roles and queues,
account migration and import, byte upload processing, peer-assisted media
delivery, and a polished browser comment/vote experience.
