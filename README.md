# Swartzit

> Read freely. Participate under a pseudonym. Take your community with you.

Swartzit is an open, self-hostable discussion network. The repository currently
contains the first server foundation: public read APIs for communities, posts,
threaded comments, and PostgreSQL full-text search.

## Development

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

Requirements: Rust stable and PostgreSQL 14+.

Copy `.env.example` to a private environment file and change the database
credentials before starting the server.

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
  -d '{"handle":"river","password":"a long passphrase"}'

# Start a 30-day session
curl -X POST http://127.0.0.1:8080/api/sessions \
  -H 'content-type: application/json' \
  -d '{"handle":"river","password":"a long passphrase"}'

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
