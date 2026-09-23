# Swartzit architecture

The prototype is a server-rendered, text-first discussion service. Public
reading does not require an account. Accounts, posting, voting, uploads, and
moderation operate behind explicit policies for pseudonyms, replication, and
migration; federation remains future work.

## Runtime

- Rust and Axum HTTP API
- PostgreSQL for durable data and search
- SvelteKit + TypeScript web client (next integration)
- Tor onion service as an optional local companion
- Incus Linux container or VM as the preferred host

The application should bind to loopback inside a host. Caddy or Tor forwards to
it. Onion-only installations do not need a public DNS name or inbound port.

`GET /api/export` emits the bounded `swartzit-public-v1` JSON format. It is
intended as a portable public-data snapshot and accepts `?community=slug` for a
single community. Private account credentials and moderation records will not
be included in this public export format.

## Portability

Backups contain PostgreSQL data, media manifests, and signing keys. A host can
restore them into another instance without depending on a vendor account. Media
records will store content hashes and available replicas so HTTP, IPFS, and
WebTorrent delivery can evolve independently.
