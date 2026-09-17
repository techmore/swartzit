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
- `POST /api/posts/:id/media` — attach a registered asset to its author’s post
- `GET /api/media/:id` — resolve public media metadata

Tokens are returned once at login and stored only as SHA-256 hashes server-side.
Clients should keep them in a protected credential store and send them only to
the same Swartzit origin.

Media storage is intentionally separate from posts. Migration `0007_media_assets`
stores content hashes, media types, sizes, and optional magnet URIs in a
provider-neutral manifest for future HTTP, IPFS, and WebTorrent delivery.
