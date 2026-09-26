# Changelog

## 0.1.46-20260926T09

- Admins can now correct a post's content rating from the post page. The
  endpoint shipped in 0.1.43 with no way to reach it from the site; this adds
  the control. It renders nothing at all for a signed-out reader or a non-admin,
  takes an optional reason into the audit log, and updates the rating badge
  from the server's response rather than the local guess.
- Adds a mature-only feed: "Only R and X-rated" in the Content filter asks for
  the R and X posts instead of removing anything from the general feed. It
  composes with the existing filters, so combining it with "Hide R-rated" gives
  the X-only feed.
- The mature filter is opt-in and defaults off, and the shared public feed cache
  keys on it so a reader asking for the mature feed is never served the general
  one from cache.
- The mature view is carried across sorting, pagination, community links, and
  the following feed, so navigating does not silently drop the filter.

## 0.1.45-20260926T08

- Applies rustfmt to the rating-correction and viewer-vote changes so
  `cargo fmt --check` passes in CI. No behaviour change.

## 0.1.44-20260926T08

- Fixes "e is not a function" beside every bookmark star. The coalescing
  bookmark-status batcher resolved its waiters by iterating the entries and
  calling each one, but an entry is a `{resolve, reject}` pair, so calling it
  threw a `TypeError` that rejected every bookmark on the page. In a production
  build the minified name is what surfaced, which is why the error read "e" and
  not "resolve". Present since 0.1.14.

## 0.1.43-20260926T06

- Admins can correct a post's content rating after the fact. Content arrives
  rated by the uploader or the automatic classifier, and both get it wrong
  often enough that a mistaken upload needs undoing without waiting for the
  person who made it. `POST /api/admin/posts/{id}/content-rating` takes
  `general`, `r`, or `x` and an optional reason.
- The rating is what the feed's `hide_r` and `hide_x` filters read, so a
  correction is what actually stops a post being served to readers who asked
  not to see it.
- A correction is recorded as `moderator` provenance with an audit log entry
  naming the actor, the previous value, and the new one, so it stays visible
  that a human changed it, when, and why. It never alters publication status.

## 0.1.42-20260926T05

- Vote buttons are now a true toggle. Clicking the direction you already hold
  removes that vote, and clicking the other direction moves it, so the two are
  mutually exclusive from the reader's side as well as the database's. The
  separate "Clear vote" control is gone.
- The buttons show which vote is held, via colour and `aria-pressed`, and
  update the score optimistically. A rejected request now rolls the button and
  the score back instead of leaving the page claiming a vote that was not
  recorded.
- Post responses carry the viewer's own vote as `your_vote`. The public feed is
  cached without viewer state, so it is stamped on per request after the cache
  lookup and never stored in the shared cache.
- The post page and the post list share one vote component, removing a second
  divergent copy of the controls.

## 0.1.41-20260926T00

- Runs the production deploy on a self-hosted runner on the host instead of a
  GitHub-hosted runner over SSH. The public address is CGNAT and only ports 80
  and 443 are forwarded, so an external runner cannot reach port 22 and the
  SSH design could never have connected.
- The deploy step is now a single local `sudo -n` invocation of the installer
  that already lives in the deployment directory, which removes the deploy
  private key, the pinned known_hosts, the deploy secrets, and any inbound
  port. The release being deployed can no longer rewrite the code that installs
  it.
- The deploy account is unprivileged and reaches root through a single
  sudoers grant naming one script path and the receipt file.
- The deploy waits for `release.yml` to publish the assets before installing,
  because both workflows trigger on the same tag push.

## 0.1.40-20260925T20

- The unattended entry point no longer reports "Production is now on <tag>" after
  a dry run. A verification pass records a distinct `checked` receipt and says
  that nothing was changed, so a dry run cannot be mistaken for an install.

## 0.1.39-20260925T20

- Makes every PostgreSQL client in the backup and rehearsal scripts
  non-interactive with `--no-password` and a connect timeout. An unattended
  upgrade that blocked on a `Password for user postgres:` prompt held its
  release lock and presented as a hang rather than a failure, which is far
  harder to diagnose and recover from.

## 0.1.38-20260925T19

- Fixes the migration rehearsal connecting for administrative work over TCP,
  where the postgres account has no password. Administrative work now uses the
  local socket and peer authentication; only the disposable rehearsal role, which
  carries a generated password, connects over TCP.
- Resolves the administrative identity to the account local authentication maps
  to, and falls back to loopback when the configured socket directory does not
  exist, so a Homebrew rehearsal no longer fails on a missing socket.

## 0.1.37-20260925T19

- Fixes an undefined `BUNDLE` reference in the release updater that aborted a
  production upgrade partway through, before any service was stopped.
- Adds a test that fails when the release updater reads a variable it never
  assigns, so a `set -u` abort cannot ship again.

## 0.1.36-20260925T19

- Merges the guarded production update workflow: an opt-in push-to-production
  deploy gated on a repository variable and the `production` environment, a
  lock-guarded Linux updater, and operator-configurable error notifications.
- Keeps the release-based upgrade path as the mechanism that actually changes a
  host: the deploy workflow installs SHA-256-verified release assets rather than
  building from source on production, so the production host needs no Rust or
  Node toolchain and every deploy is a reproducible artifact.
- Gates every upgrade on a migration rehearsal: the backup is restored into a
  throwaway database owned by a disposable role and the candidate server is
  started against that copy, so an incompatible migration fails before any live
  service is touched.
- Gates every upgrade on a real restore rehearsal that restores the archive and
  compares per-table row counts, comparing content tables strictly and
  reporting operational tables that are expected to move.
- Fixes the checkout-cleanliness gate to ignore untracked files, so operational
  state in the deployment directory no longer blocks an upgrade.

## 0.1.31-20260925T16

- Adds a tagged GitHub release workflow that publishes the Linux server binary,
  the SvelteKit web build, the release version, and a `SHA256SUMS` manifest after
  running the same gates as CI.
- Adds a safe Ubuntu release updater that verifies release checksums, takes a
  native PostgreSQL backup, rehearses the candidate release against a restored
  copy of the production data, swaps the binary and web build atomically, checks
  API and web health, and rolls back on failure.
- Adds native PostgreSQL backup and restore-rehearsal scripts for the Ubuntu
  deployment, with per-table row-count manifests and a media archive, usable as a
  full local rehearsal on the Mac.
- Adds a migration preflight that restores the backup into a throwaway database
  owned by a disposable role and refuses a release whose migrations cannot apply
  to the current data.
- Adds a daily `swartzit-upgrade-check` systemd timer that stays check-only
  unless a release tag is pinned and unattended updates are explicitly enabled.

## 0.1.30-20260924T14

- Adds a bounded, read-only Playwright Chromium runner for X Recommended on
  Ubuntu, with a persistent dedicated profile and the same seen-source state as
  the Ego Lite runner.
- Packages the pinned Playwright dependency and Chromium install step into the
  source server installer without changing the configured web bind.

## 0.1.29-20260924T14

- Makes the Node crawler/content worker cross-platform by resolving scripts and
  runtime state from explicit paths rather than the current working directory.
- Adds launchd and systemd worker installers, a portable worker launcher, and
  packaged worker modules for the Homebrew/macOS install.
- Ensures the Linux worker unit has stable root/state paths and the server
  installer reloads systemd before starting drop-in-dependent services.

## 0.1.28-20260924T14

- Makes the Ubuntu Caddy edge WireGuard-aware so it waits for `wg0`, follows
  tunnel restarts, and can terminate HTTPS directly on the deployed tunnel
  address before proxying to Swartzit's `:4173` listener.

## 0.1.27-20260924T13

- Adds an optional Ubuntu `wg0` systemd drop-in so the web service starts after
  WireGuard and follows its restart lifecycle.
- Lets the source installer set the web bind with `WEB_HOST`, enable the
  `wg-quick@wg0` boot service with `WIREGUARD_INTERFACE=wg0`, and point an
  installed Caddy instance at the selected web address.

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
