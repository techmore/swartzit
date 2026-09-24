# Changelog

## 0.1.26-20260924T13

- Shows the exact build version beside the Swartzit logo across the web app,
  sourced from the repository version file during each web build.

## 0.1.25-20260924T13

- Aligns the backup warning threshold exactly 500 MiB below the 5 GiB archive
  budget.

## 0.1.24-20260924T13

- Adds an Admin → Server backup panel showing recent archive, database dump,
  and media sizes, SHA-256 manifest presence, retention count, and the 4.5/5
  GiB archive-budget state.

## 0.1.23-20260924T13

- Makes backup checksum manifests portable by recording paths relative to the
  extracted backup directory, so recovery verification works across macOS and
  Linux hosts.

## 0.1.22-20260924T13

- Adds the optional content-package extension surface with bounded JSONL
  progress, checkpoints, cooperative pause/cancel controls, and article-unit
  publishing for long-running local story workflows.
- Publishes each generated story day as an independent post while preserving
  the full article, generated media, and sequential series navigation on the
  detail page.
- Makes the fixed timeline window and compact long-post preview a general
  Swartzit UI rule for articles, generated content, imported posts, and normal
  discussions over the timeline threshold.
- Adds the migration, admin controls, worker adapter, documentation, and test
  coverage needed to keep the extension disabled and isolated unless enabled.

## 0.1.21-20260924T11

- Adds YouTube support to regular discussions: valid video links in post bodies
  render as privacy-enhanced embeds without downloading or replicating video.
- Makes the signed-in composer explain both normal-post embedding and the
  dedicated X/Reddit/YouTube source-sharing flow.
- Keeps X-rated content out of feeds by default until the viewer opts in.

## 0.1.20-20260923T18

- Keeps the update health gate strict for API, web, database, and public HTTPS
  while allowing the persisted uptime pulse to be stale during startup before
  the refreshed monitor performs its first check.

## 0.1.19-20260923T18

- Waits for macOS LaunchAgent services to converge after an upgrade instead of
  treating a short web startup window as a failed release.

## 0.1.18-20260923T18

- Makes macOS `start`, `restart`, and `stop` understand the existing API and
  web LaunchAgents, preventing duplicate processes and making interface changes
  restart the actual managed services.
- Repairs stale Caddy LaunchAgents that still point at a removed Homebrew keg
  before refreshing the public HTTPS proxy.
- Keeps all runner worker scripts in the Homebrew tap so packaged Draw Things
  and cross-post runners are available after installation.

## 0.1.17-20260923T18

- Makes runner duplication explicit: copied definitions open at the editor,
  scroll into view, receive a collision-safe draft name, and remain disabled
  until saved and tested.
- Shows the actual latest runner failure directly on the card with a targeted
  retry action and operator guidance for common host and upload failures.
- Adds a bounded binary Draw Things media-upload endpoint, keeps the legacy
  hex endpoint for rolling upgrades, and records upstream error details instead
  of reducing upload failures to an opaque HTTP status.

## 0.1.16-20260923T17

- Adds the content-runner release surface for X cross-posting and Draw Things,
  including reusable disabled starters, dynamic prompts, LoRA configuration,
  source metadata, and live progress/ETA reporting in the admin console.
- Adds media replica and migration foundations so canonical local storage,
  disposable cache data, and optional external sharing can evolve independently.
- Adds draw-generation feedback capture and compact, organized runner details
  so administrators can see the model, prompt, destination, schedule, and run
  state without expanding every card.
- Completes the profile/timeline presentation and desktop posting/search
  affordances while keeping the native macOS status companion aligned with the
  application release and recovery workflow.
- Includes the database migrations, runner tests, web checks, and backup-first
  upgrade tooling required for this release line.

## 0.1.15-20260923T16

- Rebinds Caddy whenever the macOS menu changes Swartzit's web interface, so
  the reverse-proxy upstream follows Wi-Fi, Ethernet, loopback, and WireGuard.
- Verifies that the Caddy LaunchAgent is actually serving HTTPS after a reload
  and reports a visible failure instead of leaving a stale public route.
- Reports LaunchAgent-managed Caddy as running in local status output.

## 0.1.14-20260923T15

- Refreshes the native macOS menu companion with the shared Swartzit icon,
  compact SF Symbol rows, clearer up/down/pulse states, and a less crowded
  action layout.
- Keeps network binding choices visible by type and address, including
  loopback, Wi-Fi/LAN, Ethernet, VPN, and WireGuard interfaces.
- Adds the measured read-path optimization work: lightweight readiness,
  targeted indexes, batched lookups, bounded aggregate caching, telemetry, and
  reproducible 10k/100k-post benchmark tooling.

## 0.1.13-20260923T14

- Keeps Caddy on a non-privileged wildcard listener while binding Swartzit's
  web server to the selected WireGuard, Wi-Fi, or Ethernet address.
- Prevents macOS permission failures when Caddy serves HTTPS on port 443.

## 0.1.12-20260923T14

- Keeps the public Caddy reverse proxy synchronized with the selected Swartzit
  web interface and upstream address.
- Adds a persistent macOS Caddy LaunchAgent for WireGuard-backed HTTPS exposure.
- Supports `stoverparc.org` on `192.168.3.250:443` while keeping the API on
  loopback and preserving hot interface switching.

## 0.1.11-20260923T14

- Shows each active WireGuard/VPN tunnel and USB/Thunderbolt Ethernet adapter
  as a distinct menu binding choice.
- Uses macOS hardware-port names for dongled and hardline adapters and supports
  multi-digit interface names such as `en15` and `utun10`.

## 0.1.10-20260923T14

- Adds a native menu submenu for selecting an active web-binding interface.
- Hot-reloads Swartzit on loopback, Wi-Fi/LAN, Ethernet, VPN, or a concrete
  macOS interface while keeping the API loopback-only by default.
- Preserves runtime API, origin, pulse, and port settings during menu restarts.

## 0.1.9-20260923T14

- Makes macOS LaunchAgent refreshes reliable across package replacement by
  waiting for the previous agent to exit before bootstrapping the new path.

## 0.1.8-20260923T14

- Refreshes the backup and uptime-monitor LaunchAgents during Homebrew updates,
  preserving their configured settings as Cellar paths change.
- Preserves the configured menu open URL when refreshing the native companion.

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
