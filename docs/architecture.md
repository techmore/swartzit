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

Backups contain PostgreSQL data, media manifests, and the configured canonical
filesystem media archive when one exists. IPFS-backed restores retain their
CIDs and require the configured IPFS node or gateway to remain available. A
host can restore them into another instance without depending on a vendor
account. Media records store content
hashes and available replicas so filesystem, S3-compatible, IPFS, and optional
external-share delivery can evolve independently. A configured secondary is
queued as durable background work, retried after partner failures, and used for
checksum-verified read fallback once ready. Catbox.moe remains share/export
only. The local cache is excluded from durability guarantees and can always be
cleared or rebuilt.
