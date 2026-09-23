# HTTP API contract

All JSON endpoints return an `error` string for invalid requests. Public read
endpoints require no account:

- `GET /api/communities`
- `GET /api/communities/:slug`
- `GET /api/posts` (`community`, `q`, and bounded `page` query parameters)
- `GET /api/posts/:id`
- `GET /api/home` — recent posts from followed communities (authentication required)
- `GET /api/export` (`community` optional)
- `GET /feed.xml`
- `GET /.well-known/nodeinfo` — public instance metadata

Participation endpoints use `Authorization: Bearer <token>`:

- `POST /api/accounts` — create a handle and Argon2 password hash
- `POST /api/sessions` — receive a 30-day session token
- `GET /api/me` — resolve the current handle
- `DELETE /api/sessions` — revoke the presented token
- `POST /api/communities` — create a community
- `POST /api/communities/:slug/subscription` — follow a community
- `DELETE /api/communities/:slug/subscription` — unfollow a community
- `GET /api/communities/:slug/subscription` — inspect follow status
- `POST /api/posts` — create a text post
- `POST /api/posts/:id/comments` — create a top-level or child comment
- `POST /api/posts/:id/vote` — set `value` to `-1`, `0`, or `1`
- `POST /api/reports` — report exactly one post or comment with a reason
- `POST /api/media` — register a content hash and optional magnet URI
- `POST /api/media/upload` — authenticated hex upload for an image, video, audio, or application file; returns stable media URLs (5 MiB images, 50 MiB audio, 100 MiB video, 24 MiB other files)
- `POST /api/posts/:id/media` — attach a registered asset to its author’s post
- `GET /api/media/:id` — resolve public media metadata

Tokens are returned once at login and stored only as SHA-256 hashes server-side.
Clients should keep them in a protected credential store and send them only to
the same Swartzit origin.

Media storage is intentionally separate from posts. Migration `0007_media_assets`
stores content hashes, media types, sizes, and optional magnet URIs; migration
`0034_media_storage` adds the canonical provider, object key, variants, cache
settings, and replica verification records; `0037_media_ipfs_secondary` adds
IPFS and the optional secondary provider; `0039_media_replication_jobs` adds
durable asynchronous secondary replication. Posts reference asset IDs rather
than provider URLs.

The public delivery endpoints are:

- `GET /media/:id` — original variant (legacy-compatible alias)
- `GET /media/:id/original` — canonical original
- `GET /media/:id/thumbnail` — generated image thumbnail when available

Administrator settings are returned from `GET /api/admin/settings` under
`media`, and can be changed with `POST /api/admin/settings` using
`media_primary`, `media_secondary`, `media_cache_enabled`,
`media_cache_max_bytes`, and `media_share`. Primary and secondary may be
`filesystem`, `s3`, or `ipfs`; the secondary may also be `disabled`. The admin
storage accounting is returned from `GET /api/admin/storage`, including
database/project footprint, logical content totals, local media/cache bytes,
and replica/job state. The admin
maintenance actions are `POST /api/admin/media/test`,
`/migrate`, `/verify`, `/cache/clear`, and
`/api/admin/media/:id/share` with `{ "variant": "original" }`.

Catbox.moe is an explicit share/export adapter only. IPFS uses a Kubo RPC
endpoint, pins uploaded variants, and can be selected as either the primary or
secondary durable provider. New secondary writes are queued and retried outside
the request path. Reads verify the checksum and fall back to the secondary
before repopulating the disposable local cache.
