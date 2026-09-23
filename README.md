# Swartzit

Swartzit is a self-hosted discussion commons: a public, readable timeline with
communities, pseudonymous accounts, local voting and comments, source-aware
imports, media metadata, bookmarks, reading history, and a small admin surface.
It is designed to run on a Mac or a small server that you control, with the
database and public web address kept separate from the application process.

![Swartzit timeline](docs/screenshots/home.png)

## What the app includes

![Browse communities](docs/screenshots/communities.png)

Browse communities without an account, follow topics when signed in, open a
discussion with source attribution, and export public data. Imported posts keep
their original source link and metrics distinct from Swartzit’s local score,
views, and comments.

![Discussion view](docs/screenshots/discussion.png)

The About page explains the public-first model and the app also includes sign-in,
signup, bookmarks, reading history, dark mode, media controls, and admin tools
for crawler jobs, reports, logs, users, and runtime health.

![About Swartzit](docs/screenshots/about.png)

## Homebrew installation

The repository includes a formula at `Formula/swartzit.rb`. The pinned release
formula installs the tagged archive:

```sh
brew tap techmore/swartzit
brew install swartzit
swartzit start
swartzit status
```

For development builds from `main`, use `brew install --HEAD techmore/swartzit/swartzit`.

### Performance smoke benchmark

For repeatable release comparisons, run the dependency-free benchmark against a running API:

```bash
make perf-smoke PERF_REQUESTS=500 PERF_CONCURRENCY=8
```

It emits JSON with completion count, errors, elapsed time, p50, p95, maximum latency, and response size. Keep results with the hardware profile and database fixture; do not compare numbers across machines without recording both.

### macOS menu-bar status

On macOS, install the small native status companion so end users can see at a glance whether Swartzit is running. It refreshes every 30 seconds and provides Open, Check Now, Start, and Stop actions:

```bash
bash scripts/install-mac-status.sh
```

The status item checks the API, web UI, database, optional Caddy/public URL, and worker state using the same `swartzit status --json` command exposed to scripts and Homebrew. It runs as a per-user LaunchAgent and does not store application data in the menu-bar app.

For a public tap, publish this repository with a version tag and replace the
formula’s release URL and SHA256 with that tagged archive. Then users can run:

```sh
brew tap techmore/swartzit
brew install swartzit
```

The formula builds the Rust API and SvelteKit web app. PostgreSQL remains an
external dependency so its data directory can be upgraded, backed up, and
restored independently.

## Database backup and recovery

Use the PostgreSQL custom-format backup rather than treating the public JSON
export as a disaster-recovery backup:

```sh
scripts/db-backup.sh
scripts/db-restore-verify.sh \
  .local/backups/<timestamp>/swartzit.dump
```

The backup command writes a dump, SHA256 checksum, table row counts, and a gzip
archive under `.local/backups/`. The verification command creates a temporary
second PostgreSQL container, restores the dump, compares every application table
against the source counts, and removes only that temporary verification instance.
Keep at least one dump and one `.tgz` archive off the Mac as well; the local
artifacts are intentionally ignored by Git because they contain private data.

To restore a verified dump into the active instance, stop the app, make a fresh
pre-rollback backup, restore the dump, and restart with health checks:

```sh
swartzit rollback --backup \
  "$HOME/Library/Application Support/Swartzit/backups/<timestamp>/swartzit.dump" \
  --yes
```

The command records `last-rollback.json` and preserves the pre-rollback dump
and archive. It requires `--yes` because PostgreSQL objects are replaced. Add
`--leave-stopped` when the database should be restored without restarting the
application.

> Read freely. Participate under a pseudonym. Take your community with you.

## Instance administration

Run `bash scripts/bootstrap-admin.sh` after starting PostgreSQL. It creates or
promotes `u/techmore` (override with `ADMIN_HANDLE`). New accounts receive a random
password printed once; existing accounts keep their password. Sign in at `/login`
and open `/admin`. The API checks the database admin role on every request.

On the current development instance, `u/techmore` is already an administrator.
Use your existing password at [Sign in](http://127.0.0.1:4173/login), then open
[Admin](http://127.0.0.1:4173/admin) or use the Admin navigation link.

```sh
# Default admin: techmore
bash scripts/bootstrap-admin.sh
# Another instance administrator
ADMIN_HANDLE=your_handle bash scripts/bootstrap-admin.sh
# Explicit password recovery; revokes this account's existing sessions
RESET_ADMIN_PASSWORD=1 ADMIN_HANDLE=techmore bash scripts/bootstrap-admin.sh
```

The script requires Cargo and direct database access. Export `DATABASE_URL` for
a non-default database. Keep the generated password in your password manager.

For password recovery, run `RESET_ADMIN_PASSWORD=1 bash scripts/bootstrap-admin.sh`.
With `ADMIN_PASSWORD` unset, this generates a new password and revokes existing sessions for that account.
`ADMIN_PASSWORD` may supply a password through the environment instead of generating
one. Do not put passwords in source control or command history.

The dashboard shows registered account totals (excluding demo-only identities),
content totals, unexpired sessions, database size and pool usage, host load, and
runtime API rate/latency/errors. Page loads count JavaScript-enabled navigations,
including repeats, with no visitor identifier. Runtime counters reset on restart.
The host load is for the entire Mac/Linux host, not just Swartzit.

The admin workspace has Overview, Users, Content, Reports, Server, Analytics,
and Logs tabs. Users includes handle search, roles, activity counts, and session
revocation (self-revocation is blocked; use Sign out). Content provides searchable
posts, comments, and communities with text inspection and links to discussions.
Reports can be marked resolved; resolution does not remove the reported content.
Management actions are recorded in the circular log. Role changes and password
recovery still use the host-side bootstrap command; suspension and content removal
are not implemented.

Analytics includes 14 days of daily registrations, posts, and comments using UTC
dates. Traffic metrics remain runtime-only. Logs support severity filters, text
search, expandable structured details, and older/newer pages through retained
events. Search covers only the bounded retained history. Pause live updates while
investigating; all views also have manual refresh and error/retry states.

Operational request/startup/bootstrap events persist in a 1,000-slot PostgreSQL
ring, replacing the oldest slots. The dashboard displays the newest 100. Logs omit
IP addresses, headers, request bodies, tokens, query strings, and raw paths.
Admin polling and page-view events are excluded from the request log. This ring
does not manage external process-manager/stdout logs or PostgreSQL WAL retention.

Swartzit is a self-hosted discussion prototype with public reading, pseudonymous
accounts, communities, posts, threaded comments, voting, subscriptions, search,
public exports, and an admin dashboard.

## Development

### Post views and engagement

Posts expose separate counters for opens, engaged views (10 seconds), and deeper
reads (30 seconds). Post pages and Admin → Content show all three; feed cards
show opens. JavaScript counts time only while the document is visible and the
post article intersects the viewport. Time spent hidden or away from the article
does not count, and long timer gaps from sleep/throttling are ignored.

Each page visit gets a random in-memory ID scoped to that post. No cookie, IP,
account ID, or cross-post visitor identifier is stored for this measurement.
Repeated requests for the same visit do not increment a milestone twice.
Refreshing/revisiting creates another visit: these are not unique-reader counts.
Non-JavaScript reads remain accessible but are not counted.

The API accepts POST /api/posts/{id}/views with a 64-character hexadecimal
visit_id and visible_seconds of 0, 10, or 30. Open must be recorded first.
The server checks elapsed wall time and atomically counts each milestone once;
it cannot prove that a human was reading. These analytics can be spoofed and
do not currently gate votes, likes, or reputation.

Aggregate counters persist. Deduplication records expire after one hour; expired
rows are cleaned in batches on subsequent view requests (idle instances may keep
expired rows until traffic resumes). View events are excluded from circular
request logs. Visibility milestones are a starting policy for future experiments,
not a configured voting requirement.

### Communities and optional post-install setup

The public [community directory](http://127.0.0.1:4173/communities) supports
search, paging, and links to each community's discussions. The Communities link
is in the main navigation. Signed-in users can create communities from that page.
The existing API also supports community subscriptions; ownership/moderator roles
are not assigned by community creation yet.

To prepopulate an instance with 20 familiar discussion topics:

```sh
bash scripts/post-install.sh
```

Run it from a checkout with Cargo and PostgreSQL available. Export DATABASE_URL
for a non-default database. It applies migrations and adds empty communities such
as technology, science, programming, books, cooking, gaming, privacy, and space.
These are independent communities with original descriptions, not a Reddit
import, affiliation, or current popularity ranking. No users or posts are copied.
Rerunning is safe: matching slugs and their descriptions remain unchanged.
This is optional and separate from demo seeding and administrator bootstrap.
Edit crates/server/starter-communities.sql to customize the starter list.

Signup uses named username/password fields, new-password autocomplete, and a
normal POST/redirect flow to help password managers recognize account creation.
Native suggestions depend on browser/password-manager settings and may not appear
in embedded browsers. “Suggest a strong password” generates a 24-character random
password locally using Web Crypto; save it before submitting. Account creation
also works without JavaScript, while the suggestion button requires JavaScript.

### Run on this Mac

With Apple `container`, Rust, and Node.js installed:

```sh
bash scripts/run-local.sh
```

Open http://127.0.0.1:4173. The script runs PostgreSQL in an Apple Linux
container with a persistent named volume and starts the Rust API and standalone
SvelteKit website. Startup is idempotent: it reuses healthy listeners, waits
for PostgreSQL/API/web readiness, and skips rebuilds when artifacts already
exist, so a reboot does not trigger a full install/build cycle. The web server
binds to all local interfaces for Wi-Fi/LAN access; the API and database stay
on loopback.
Create your own account through **Create account**; the seeded authors are
display-only identities without passwords. The local database password is a
development credential and must not be reused for public hosting.

The website uses port 4173, the API 18080, and PostgreSQL 54329. The API and
PostgreSQL remain loopback-only; the website is reachable from the current LAN
address printed by the launcher. Stop application services with
`bash scripts/stop-local.sh`; stop PostgreSQL separately with
`container stop swartzit-db`; its named volume retains the data.

For a direct HTTPS domain from the Mac, configure the router to forward TCP
80 and 443 to this Mac, then start the optional Caddy terminator:

```sh
SWARTZIT_DOMAIN=stoverparc.org SWARTZIT_CADDY=1 bash scripts/run-local.sh
```

Caddy obtains and renews the certificate automatically once DNS points to the
router and both forwards are active. If the Mac changes Wi-Fi networks, use
the new LAN address printed by the launcher or reserve a DHCP lease in the
router; the public DNS record does not change.

The launcher accepts a network mode or a concrete macOS interface so you do
not need to hand-edit bind addresses:

```sh
bash scripts/run-local.sh local                 # this Mac only
bash scripts/run-local.sh lan                   # Wi-Fi/LAN; prints the URL
bash scripts/run-local.sh ethernet              # Ethernet (en1 by default)
bash scripts/run-local.sh en0                  # bind to this exact interface
bash scripts/run-local.sh vpn                   # Tailscale or utun VPN URL
SWARTZIT_ORIGIN=https://your-hostname \
  bash scripts/run-local.sh public              # localhost + Caddy/HTTPS
bash scripts/network-status.sh                  # list detected addresses
bash scripts/status-local.sh                   # all local components
bash scripts/status-local.sh --json             # machine-readable status
```

`lan` is the default and keeps the API/database private. VPN mode prefers a
Tailscale IPv4 address and otherwise reports the first macOS `utun` address;
use `SWARTZIT_ORIGIN` when a VPN DNS name is the address people should use.
The public mode requires an explicit origin and only exposes the web server
through Caddy.

For `stoverparc.org`, a typical public setup is:

```sh
SWARTZIT_ORIGIN=https://stoverparc.org \
  SWARTZIT_CHECK_URL=https://stoverparc.org/ \
  SWARTZIT_CADDY=1 bash scripts/run-local.sh public
SWARTZIT_CHECK_URL=https://stoverparc.org/ \
  SWARTZIT_CHECK_INTERVAL=300 bash scripts/swartzit-monitor.sh --once
```

The monitor can run continuously, or as a native macOS LaunchAgent that starts
when you log in:

```sh
SWARTZIT_CHECK_URL=https://stoverparc.org/ \
  SWARTZIT_CHECK_INTERVAL=300 bash scripts/install-mac-monitor.sh
```

`status-local.sh` reports API, web, PostgreSQL, Caddy, worker, and (when
configured) public URL state. The API defaults to loopback even when the web
interface is bound to Wi-Fi or Ethernet; set `SWARTZIT_API_INTERFACE` only when
you intentionally want the API exposed on another interface.

This is a local prototype. Federation, full community migration/import, media
transfer, and moderator workflows are not implemented yet.

## Production VPS deployment

For an always-on instance, use a small Linux VPS rather than keeping the Mac
running. The practical minimum for the complete stack (PostgreSQL, Rust API,
SvelteKit web server, Caddy, and the scheduler) is a 2 GiB / 1-2 vCPU machine
with about 50 GiB of disk. A 512 MiB / $4 proxy-only machine is not enough for
the database and workers; a 2 GiB DigitalOcean Basic Droplet is roughly
$12/month before optional backups and taxes. The current price list is at
[DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets).

The repository includes a repeatable Ubuntu installer. It builds a pinned
checkout, installs the API and web systemd services, and enables the crawler
timer. Supply secrets out of band; never commit them:

```sh
sudo REPO_URL=https://github.com/techmore/swartzit.git \
  REF=main \
  DATABASE_URL='postgres://swartzit:change-me@127.0.0.1:5432/swartzit' \
  ORIGIN=https://swartzit.example.org \
  SCHEDULER_HANDLE=techmore \
  SCHEDULER_PASSWORD='use-a-password-manager-value' \
  CADDY_DOMAIN=swartzit.example.org \
  bash scripts/install-server.sh
```

The installer expects PostgreSQL to be installed and the database/user to
already exist. It keeps the API on `127.0.0.1:18080`, the web server on
`127.0.0.1:4173`, and exposes only Caddy. Check the services with:

```sh
systemctl status swartzit swartzit-web swartzit-worker.timer
journalctl -u swartzit-worker.service
```

The admin **Crawler Jobs** tab stores provider, source, destination community,
interval, maximum items, moderation mode, and run status. The worker runs once
per minute and claims due jobs without overlapping runs. The Commons/Daddario
adapter uses the existing bounded publisher. Reddit uses its public JSON feed
and RSS accepts public HTTPS feeds; X uses the official API and requires
`X_BEARER_TOKEN` in the worker environment. An X job can use either an
`@handle`/profile URL or a search source such as
`search:("Alexandra Daddario" OR Daddario) has:media -is:retweet -is:reply`.
Search jobs expand public authors and attachments, skip protected authors, and
preserve the original status URL and metric snapshot. Provider errors are
recorded as failed; the worker never scrapes a browser login or reports a
fabricated success. Provider credentials belong in the worker environment, not
in the job record or repository.

Swartzit stores external media metadata and source URLs rather than silently
mirroring every image or video. Public assets may be loaded from the provider
CDN and can later use a bounded LRU cache. Do not cache sessions, admin pages,
or authenticated responses. A future media cache must support purge/takedown,
refresh expiring provider URLs, and respect the source license. Torrent or
IPFS distribution is an optional backend for media that is explicitly
redistributable; it is not enabled by default.

## Optional JEV finance bridge

The planned JEV/Ego Lite finance bridge is a separate, local, read-only
component for user-approved balance snapshots, transaction review, and draft
bill planning. Bank credentials, cookies, MFA codes, screenshots, and raw
transaction feeds must stay outside Swartzit. See
[docs/jev-finance-bridge.md](docs/jev-finance-bridge.md) for the tool boundary,
redaction, retention, and browser handoff requirements.

For deployment that should survive a home-network outage, point the domain at
the VPS and run the full stack there. A VPS acting only as a Caddy/WireGuard
proxy is useful for keeping the Mac private, but it does not run Swartzit when
the Mac is offline.


## Sharing with other people

Run Swartzit first with `bash scripts/run-local.sh`. Localhost URLs only work
on your own computer. Both sharing methods below forward to the **website on
port 4173**, which proxies API calls internally. Keep PostgreSQL and the API on
loopback. Your Mac must stay awake and the app must remain running.

### Temporary HTTPS link with Cloudflare

In a second terminal:

```sh
brew install cloudflared # Only if not already installed
cloudflared tunnel --url http://127.0.0.1:4173
```

Share the generated `https://…trycloudflare.com` URL. Visitors can read in an
ordinary browser, create accounts, and sign in. Admins use the same URL with
`/admin`. Sign in again when changing from localhost to a public URL because
browser sessions are stored per origin.

For signup form submissions through the tunnel, restart the app with its public
origin (leave the tunnel running; replace the example with your generated URL):

```sh
ORIGIN=https://your-generated-name.trycloudflare.com bash scripts/run-local.sh
```

Use that public URL for signup. Restart with the new ORIGIN if the tunnel URL
changes. Without this, the framework rejects cross-origin form submissions.

Quick Tunnels require no Cloudflare account, purchased domain, or router port
forwarding. They expose the site publicly through Cloudflare and are intended
for testing. Ctrl-C in the tunnel terminal stops sharing; restarting produces
a new URL. Limits include 200 concurrent requests and no SSE support. Existing
`.cloudflared/config.yaml` configuration may prevent Quick Tunnels from working;
consult the documentation without overwriting another tunnel's configuration.

For a stable hostname, configure a named tunnel with your domain and an HTTP
service pointing to `http://127.0.0.1:4173`. Supervise the tunnel for continuous
hosting. See [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
and [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/).

### Onion address with Tor

Leave the app running. From the repository root in another terminal:

```sh
brew install tor # macOS; on Linux use your distribution's Tor package
mkdir -p .local/tor-data .local/tor-service
chmod 700 .local/tor-data .local/tor-service
tor --SocksPort 0 \
  --DataDirectory "$PWD/.local/tor-data" \
  --HiddenServiceDir "$PWD/.local/tor-service" \
  --HiddenServicePort "80 127.0.0.1:4173"
```

Wait for Tor to bootstrap. In another terminal, from the same repository root:

```sh
cat .local/tor-service/hostname
```

Share `http://<the-generated-address>.onion` and open it in Tor Browser.
Admins can sign in there and visit `/admin`. No purchased domain, public inbound
port, or router forwarding is required. Outbound Tor connectivity is necessary.

For onion signup, restart the app with
`ORIGIN=http://your-generated-address.onion bash scripts/run-local.sh` and use
that onion URL. Form submissions require the configured public origin; switching
between localhost, a tunnel, and an onion URL requires updating ORIGIN.

Ctrl-C stops the onion service. Repeat the same command with the same directories
to resume at the same address. Back up `.local/tor-service` privately: it contains
the keys controlling that onion identity. Only share the hostname. `.local/`
is excluded from Git. If you previously used `.tor-service`, preserve those keys
to keep your existing address rather than creating a new identity.

This command runs a dedicated Tor process, not a supervised system service.
See [Tor deployment notes](deploy/tor/README.md) and the
[Tor Project setup guide](https://community.torproject.org/onion-services/setup/).

### Manual API development

Requirements: Rust stable, Node.js/npm, and PostgreSQL 14+.

The Rust API reads exported environment variables; copying `.env.example`
alone does not load them. Use your own database credentials. The example below
starts the API only on its default port 8080.

Common checks are also available through `make check`, `make test`, `make fmt`,
and `make web-build`.

```sh
createdb swartzit
export DATABASE_URL=postgres://localhost/swartzit
cargo run -p swartzit-server -- --seed-demo
cargo run -p swartzit-server
curl http://127.0.0.1:8080/api/posts
# Subscribe without an account or JavaScript
curl http://127.0.0.1:8080/feed.xml

# Create a pseudonymous account (passwords are stored as Argon2 hashes)
curl -X POST http://127.0.0.1:8080/api/accounts \
  -H 'content-type: application/json' \
  -d '{"handle":"new_reader","password":"a long passphrase"}'

# Start a 30-day session
curl -X POST http://127.0.0.1:8080/api/sessions \
  -H 'content-type: application/json' \
  -d '{"handle":"new_reader","password":"a long passphrase"}'

# Use the returned token to publish
curl -X POST http://127.0.0.1:8080/api/communities \
  -H 'authorization: Bearer TOKEN' -H 'content-type: application/json' \
  -d '{"slug":"localnet","name":"Local Net","description":"A community with its own home."}'

curl -X POST http://127.0.0.1:8080/api/posts \
  -H 'authorization: Bearer TOKEN' -H 'content-type: application/json' \
  -d '{"community":"commons","title":"A new thought","body":"Hello, commons."}'

# Reply to a post (parent_id is optional for a top-level comment)
curl -X POST http://127.0.0.1:8080/api/posts/1/comments \
  -H 'authorization: Bearer TOKEN' -H 'content-type: application/json' \
  -d '{"body":"A thoughtful reply.","parent_id":null}'

# Upvote (+1), downvote (-1), or clear a vote (0)
curl -X POST http://127.0.0.1:8080/api/posts/1/vote \
  -H 'authorization: Bearer TOKEN' -H 'content-type: application/json' \
  -d '{"value":1}'

# Inspect or revoke the current session
curl http://127.0.0.1:8080/api/me -H 'authorization: Bearer TOKEN'
curl -X DELETE http://127.0.0.1:8080/api/sessions -H 'authorization: Bearer TOKEN'
# Export public discussion data (not a complete database backup)
curl http://127.0.0.1:8080/api/export > swartzit-export.json
```

To run the website against this manually started API, use a second terminal:

```sh
npm --prefix apps/web ci
npm --prefix apps/web run build
HOST=127.0.0.1 PORT=4173 ORIGIN=http://127.0.0.1:4173 \
  API_URL=http://127.0.0.1:8080 node apps/web/build
```

For a permanent site, set `ORIGIN` to its public URL. Match `API_URL` to the
API's `BIND_ADDR`: the local startup script uses 18080, while the standalone
API defaults to 8080. Keep both processes on loopback when the reverse proxy or
Tor runs on the same host. RSS currently lives on the Rust API only; the website
proxies `/api/*`. Public exports omit account credentials and do not replace
PostgreSQL backups.

## Importing public X posts and photo-library sources

Admins can open **Admin → Imports**, select a prepared JSON file, review the
batch, and publish it. A migration creates `c/x_imports` and the independent fan
community `c/alexandra_daddario`. Use `--community SLUG` to route a batch into
another existing community.

Prepare a batch from the existing Hermes X mirror archive (no Signal delivery):

```sh
node scripts/prepare-import.mjs --archive /path/to/hermes-signal-cli-x-mirror/archive/posts --limit 20 > x-import.json
```

Add `--author techmore_edu` to include only that author's archived posts
(case-insensitive, optional leading `@`). This does not select their home feed
or fetch new posts. The limit applies after filtering; no matches produces an
empty batch rather than substituting unrelated content.

### Protestant-first X discovery runner

For a focused faith link runner, use the X API and Reddit's public JSON search
with three bounded searches each. Protestant and Presbyterian terms are weighted
above broader biblical and Christian terms; duplicate links are collapsed before
publishing.

```sh
node scripts/x-faith-runner.mjs \
  --community x_imports --limit 10 --per-query 20 \
  --output .local/import-previews/protestant-x.json
node scripts/scheduled-imports.mjs \
  --job x --batch .local/import-previews/protestant-x.json --limit 10
```

The runner looks for Presbyterian, Reformed, confessional, Westminster,
`sola scriptura`, `sola fide`, biblical, expository, gospel, theology, and
general Christian terms in descending priority. It imports only public results
returned by X or Reddit, preserves each source link and observed metrics, and
leaves moderation to the existing import workflow.

### Running collection through Hermes locally

Hermes can be the local collector while Swartzit remains the publisher. Give
Hermes access to a signed-in browser session for public Following/For You
collection, or an authorized X API connector for unattended collection. Hermes
must write a fresh normalized JSON array using the same record shape accepted by
`POST /api/admin/imports`, including the real `source_url`, `source_author`,
`observed_at`, and any observed media and metrics. It must never copy cookies,
read DMs, bypass visibility controls, or invent missing values.

Publish one Hermes batch from the repository root:

```sh
node scripts/hermes-content-sync.mjs \
  --job feed --batch .local/hermes/inbox/following-2026-09-22.json --limit 10
```

For a hands-off local loop, have Hermes atomically place completed batches in an
inbox directory and invoke:

```sh
node scripts/hermes-content-sync.mjs --job feed --inbox .local/hermes/inbox --limit 10
```

Successful files move to `.local/hermes/archive` and receive a receipt in
`.local/hermes/receipts`; failed files stay in the inbox for inspection and
retry. The wrapper calls `scheduled-imports.mjs`, so canonical URL deduplication,
media enrichment, attribution checks, admin authentication, and session cleanup
remain in one place. A Commons photo run can be scheduled locally with
`node scripts/hermes-content-sync.mjs --job ddario --limit 3 --due-hours 24`.
This is a local handoff contract, not a new Signal integration.

Prepare reusable Commons photos from the Alexandra Daddario library manifest:

```sh
node scripts/prepare-import.mjs --manifest /path/to/alexandra-daddario/manifest.json --limit 10 > photo-import.json
```

The photo adapter reads source URLs, fetches Commons credit/license metadata,
and skips unsupported licenses and other image hosts. It does not transfer
local photo files, private ratings, or library comments. Review the original
file's terms and attribution before publishing.

`POST /api/admin/imports` accepts one normalized record with a Bearer admin
session. Required fields are `community`, `provider` (`x` or `commons`),
`source_url`, `source_author`, `title`, `body`, and ISO-8601 `observed_at`.
Optional fields: `published_at`, `source_views`, `source_likes`,
`source_reposts`, `source_replies`, `media`, and `attribution`. Media accepts
legacy image URL strings or objects: `{ "kind": "image" | "video", "src":
"https://...", "poster": "https://...", "alt": "..." }`. Poster and alt are
optional. Up to eight attachments allow a post plus its quoted-post media.
X photos/posters must use pbs.twimg.com; videos must be MP4s on video.twimg.com.
Unknown metrics are null, not zero. Every refresh replaces the complete source
snapshot; omitted metrics become unknown. Older snapshots cannot overwrite
newer ones. Canonical source URLs prevent duplicate posts, including concurrent
imports and X/Twitter URL aliases. Reimports preserve local votes, views,
comments, and community placement.

Readers can sort discussions by local activity or X snapshot counts, copy a
discussion link, and sort local comments oldest/newest. Source images load
automatically and directly from their original CDN; this is not
torrent storage or an offline media mirror. Source counts are timestamped
snapshots, not live counters. The existing Hermes archive does not contain
engagement counts, so those show as unknown unless supplied by a collector.
X imports are automatically enriched with public photos, animated-GIF MP4s,
videos, and quoted-post attachments where X exposes them. Videos play inline
with controls and no autoplay. Legacy image-only records remain compatible.
Source reply bodies and permanent video downloads are not implemented.
Media stays on X's CDN and can become unavailable if X removes or blocks it.
Backfill existing X cross-posts with `node scripts/backfill-x-media.mjs`;
this preserves their captured engagement timestamps and local discussions.
Existing Signal jobs are unchanged.

### Recurring sync on this Mac

The **Swartzit content sync** Codex heartbeat is scheduled hourly. It reads
public posts from the signed-in `@techmore_edu` account's Following and For You
feeds (up to ten posts total), then publishes through the runner. It also checks
the Daddario library each run, publishing up to three eligible Commons sources
when 24 hours have elapsed since its last successful photo run.

This requires the Mac/Codex, the local server, and an accessible signed-in Brave
session. It is an agent-operated collector, not an independent Linux service.
Scheduled execution has been enabled; future unattended browser runs may still
encounter login or user-control blocks. The photo task posts from the existing
manifest and reports exhaustion; it does not discover new photos automatically.

See [the run procedure](docs/content-sync.md) for collection limits and recovery.
See [the runner map](docs/runners.md) for the ownership and startup rules for
local, Hermes, hosted, and heartbeat jobs.
The publisher accepts only fresh X batches, exits nonzero on failures, revokes
its session, prevents overlapping publishers, and checkpoints successful photos
individually. The latest 100 receipts are retained per job in
`.local/sync-x.json` and `.local/sync-ddario.json`. Credentials stay in the
gitignored `.local/import-scheduler.env`; never commit or print them.

```sh
node scripts/scheduled-imports.mjs --job x --batch .local/import-previews/scheduled-x.json --limit 10
node scripts/scheduled-imports.mjs --job ddario --limit 3 --due-hours 24
node --test scripts/scheduled-imports.test.mjs
```

Adjust or pause **Swartzit content sync** in Codex automations. Source URLs
deduplicate across both feeds; local votes and comments survive refreshes.

## Deployment direction

The intended deployment shape is a Linux system container or VM managed with
Incus, with PostgreSQL on a private network and the server supervised by
systemd. OCI images remain an optional interoperability format for Apple
`container` on macOS and other runtimes; Docker is not required.

See [`deploy/incus/README.md`](deploy/incus/README.md) for the first-run host
setup sketch. It is not a complete, tested production installer: hosting also
requires the Node website, database backups, and supervision for both app
processes. Forward public traffic to the website on 4173.

The first release deliberately keeps uploads and federation out of the public
API while their privacy, moderation, migration, and onion behavior are being
specified.

### Private bookmarks and folders

Signed-in users can choose **Bookmark** on feed cards or discussion pages.
**Save to folder** saves or moves a post into a folder; posts can also remain
**Unfiled**. Open **Bookmarks** in the account navigation (`/bookmarks`) to
browse saved posts, create or rename folders, move bookmarks, or remove them.
Deleting a folder moves its bookmarks to Unfiled without unsaving the posts.
Each post can be saved once per account, in one folder at a time.

Bookmarks and folders belong to the signed-in account and are excluded from
public feeds and community exports. Their API routes require a bearer session:
`GET /api/bookmarks` (optional `folder_id`, `unfiled=true`, and `page`),
`GET/POST /api/bookmark-folders`, `POST/DELETE /api/bookmark-folders/{id}`,
and `GET/POST/DELETE /api/posts/{id}/bookmark`. Folder writes accept `{ "name":
"Reading" }`; bookmark writes accept `{ "folder_id": null }` or a folder ID.
Migration `0013_bookmarks.sql` runs automatically when the server starts.

The bookmark isolation/lifecycle integration test uses a disposable database:
`DATABASE_URL=... cargo test --locked private_bookmarks_and_folder_lifecycle -- --ignored`.
The database role must have permission to create test databases.

### Appearance

Use the **Dark mode / Light mode** toggle at the bottom-right of any page.
The site follows the operating system's theme until you choose a mode, then
remembers that choice in this browser (`swartzit_theme` in local storage).
The preference applies to public pages, forms, bookmarks, and the admin panel;
it does not require an account.

### Admin security

The **Security** tab shows recent proxy-derived request activity and reversible
address blocks. Swartzit stores a keyed one-way hash of each address, not the
raw IP, and keeps activity for seven days. To enable this
behind Caddy or another trusted reverse proxy, set both variables for the API:

```sh
TRUST_PROXY=true
IP_HASH_SECRET='a-long-random-secret'
```

Only enable `TRUST_PROXY` when every request reaching the API comes through
that proxy; otherwise clients can forge forwarding headers. Blocks can be
temporary or indefinite and can be removed from the same tab. Migration
`0018_ip_security.sql` creates the activity and block tables.

Imported X video playback uses the site's `no-referrer` policy: X's CDN can
reject video requests with a third-party Referer (HTTP 403). Keep the referrer
meta tag in `apps/web/src/app.html` when customizing the layout. This also keeps
private page addresses out of outbound requests. Videos still stream directly
from X, with byte-range support for seeking; Swartzit does not proxy or store them.

### Profile image cache

Imported X posts record the public `pbs.twimg.com/profile_images` URL returned
by the source API or syndication endpoint. Profile images can be copied into a
small local cache and served from Swartzit so the reader is not dependent on X
for every avatar request:

```sh
API_URL=http://127.0.0.1:18080 \
PROFILE_IMAGE_CACHE_DIR=/var/lib/swartzit/profile-cache \
node scripts/cache-profile-images.mjs
```

The cache job follows only HTTPS X profile-image URLs, refuses redirects, and
skips files over 1 MiB or with a non-image content type. It deduplicates
downloads by the source image URL, then links one local cached file to every
post that uses that avatar. The API serves cached files at
`/profile-images/:post_id`; the web app uses only that local route, so a cache
miss does not trigger a browser request back to X. Run the job from a timer
after imports, and make `PROFILE_IMAGE_CACHE_DIR` writable by the service
account. This cache is intentionally limited to profile avatars; post photos
and videos remain source-hosted or torrent-backed.
