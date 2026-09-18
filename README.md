# Swartzit

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
container with a persistent named volume, seeds sample discussions only on an
empty instance, and starts the Rust API and standalone SvelteKit website.
Create your own account through **Create account**; the seeded authors are
display-only identities without passwords. The local database password is a
development credential and must not be reused for public hosting.

The website uses port 4173, the API 18080, and PostgreSQL 54329, all on loopback.
Ctrl-C stops the website and API. Stop PostgreSQL separately with
`container stop swartzit-db`; its named volume retains the data.

This is a local prototype. Federation, full community migration/import, media
transfer, and moderator workflows are not implemented yet.


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
`source_reposts`, `source_replies`, `media` (image URL array), and `attribution`.
Unknown metrics are null, not zero. Every refresh replaces the complete source
snapshot; omitted metrics become unknown. Older snapshots cannot overwrite
newer ones. Canonical source URLs prevent duplicate posts, including concurrent
imports and X/Twitter URL aliases. Reimports preserve local votes, views,
comments, and community placement.

Readers can sort discussions by local activity or X snapshot counts, copy a
discussion link, and sort local comments oldest/newest. Source images require
an explicit click and then load directly from their original CDN; this is not
torrent storage or an offline media mirror. Source counts are timestamped
snapshots, not live counters. The existing Hermes archive does not contain
engagement counts, so those show as unknown unless supplied by a collector.
X reply bodies, video downloads, fresh Brave collection, and scheduled imports
are not implemented by this adapter. Existing Signal jobs are unchanged.

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
