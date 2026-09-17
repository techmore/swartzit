# Swartzit

> Read freely. Participate under a pseudonym. Take your community with you.

Swartzit is an open, self-hostable discussion network. The repository currently
contains the first server foundation: public read APIs for communities, posts,
threaded comments, and PostgreSQL full-text search.

## Development

Requirements: Rust stable and PostgreSQL 14+.

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
  -d '{"handle":"river","password":"a long passphrase"}'

# Start a 30-day session
curl -X POST http://127.0.0.1:8080/api/sessions \
  -H 'content-type: application/json' \
  -d '{"handle":"river","password":"a long passphrase"}'

# Use the returned token to publish
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
# Export public data for migration or backup
curl http://127.0.0.1:8080/api/export > swartzit-export.json
```

The API binds to localhost by default. Set `BIND_ADDR=0.0.0.0:8080` only when
placing it behind a trusted reverse proxy or Tor onion service.

## Deployment direction

The supported production shape is a Linux system container or VM managed with
Incus, with PostgreSQL on a private network and the server supervised by
systemd. OCI images remain an optional interoperability format for Apple
`container` on macOS and other runtimes; Docker is not required.

See [`deploy/incus/README.md`](deploy/incus/README.md) for the first-run host
setup.

The first release deliberately keeps uploads and federation out of the public
API while their privacy, moderation, migration, and onion behavior are being
specified.
