# HTTP API contract

All JSON endpoints return an `error` string for invalid requests. Public read
endpoints require no account:

- `GET /api/communities`
- `GET /api/communities/:slug`
- `GET /api/posts` (`community`, `q`, and bounded `page` query parameters)
- `GET /api/posts/:id`
- `GET /api/export` (`community` optional)
- `GET /feed.xml`

Participation endpoints use `Authorization: Bearer <token>`:

- `POST /api/accounts` — create a handle and Argon2 password hash
- `POST /api/sessions` — receive a 30-day session token
- `GET /api/me` — resolve the current handle
- `DELETE /api/sessions` — revoke the presented token
- `POST /api/posts` — create a text post
- `POST /api/posts/:id/comments` — create a top-level or child comment
- `POST /api/posts/:id/vote` — set `value` to `-1`, `0`, or `1`

Tokens are returned once at login and stored only as SHA-256 hashes server-side.
Clients should keep them in a protected credential store and send them only to
the same Swartzit origin.
